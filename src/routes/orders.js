const express = require('express');
const router = express.Router();
const pool = require('../db');
const verificarToken = require('../middleware/auth');
const multer = require('multer');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const crypto = require('crypto');
const { Resend } = require('resend'); // <-- SDK oficial de Resend

// Inicializar Resend con tu API Key
const resend = new Resend(process.env.RESEND_API_KEY);

const upload = multer({ 
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB para comprobantes
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('Solo se permiten imágenes (JPG, PNG).'), false);
        }
    }
});

const s3Client = new S3Client({
    region: process.env.AWS_REGION,
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    }
});

const isValidId = (id) => /^\d+$/.test(id) && parseInt(id) > 0;
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev';

// =====================================================
// CLIENTE: Crear pedido y subir comprobante
// =====================================================
router.post('/create', upload.single('receipt'), async (req, res) => {
    try {
        const { event_id, customer_email, customer_name, order_type, photo_ids } = req.body;
        const receiptImage = req.file;

        if (!event_id || !customer_email || !order_type) {
            return res.status(400).json({ error: 'Faltan datos requeridos.' });
        }

        if (!receiptImage) {
            return res.status(400).json({ error: 'Debe subir el comprobante de pago.' });
        }

        const eventResult = await pool.query(
            'SELECT * FROM events WHERE id = $1 AND sales_enabled = true',
            [event_id]
        );

        if (eventResult.rows.length === 0) {
            return res.status(404).json({ error: 'Evento no encontrado o ventas desactivadas.' });
        }

        const event = eventResult.rows[0];
        let amount = 0;
        let finalPhotoIds = [];
        
        if (order_type === 'gallery') {
            amount = parseFloat(event.price_full_gallery) || 0;
            const photosResult = await pool.query('SELECT id FROM photos WHERE event_id = $1', [event_id]);
            finalPhotoIds = photosResult.rows.map(p => p.id);
        } else if (order_type === 'single') {
            const pricePerPhoto = parseFloat(event.price_per_photo) || 0;
            const selectedPhotos = photo_ids ? JSON.parse(photo_ids) : [];
            if (selectedPhotos.length === 0) {
                return res.status(400).json({ error: 'Debe seleccionar al menos una foto.' });
            }
            amount = pricePerPhoto * selectedPhotos.length;
            finalPhotoIds = selectedPhotos;
        }

        if (amount <= 0) {
            return res.status(400).json({ error: 'El monto del pedido es inválido.' });
        }

        const receiptFileName = `receipts/${event_id}/${Date.now()}_${crypto.randomBytes(8).toString('hex')}.${receiptImage.mimetype.split('/')[1]}`;
        await s3Client.send(new PutObjectCommand({
            Bucket: process.env.AWS_BUCKET_NAME,
            Key: receiptFileName,
            Body: receiptImage.buffer,
            ContentType: receiptImage.mimetype
        }));

        const receiptUrl = `https://${process.env.AWS_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${receiptFileName}`;
        const commissionAmount = amount * 0.10;
        const photographerNet = amount * 0.90;

        const newOrder = await pool.query(`
            INSERT INTO orders (
                event_id, customer_email, customer_name, order_type, photo_ids,
                amount, currency, status, receipt_url, receipt_image_url,
                commission_amount, photographer_net
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $8, $9, $10, $11)
            RETURNING *
        `, [
            event_id, customer_email, customer_name || '', order_type,
            `{${finalPhotoIds.join(',')}}`, amount, event.currency || 'COP',
            receiptUrl, receiptFileName, commissionAmount, photographerNet
        ]);

        const orderData = newOrder.rows[0];

        // 📧 NOTIFICAR AL FOTÓGRAFO DEL NUEVO PEDIDO
        try {
            const photographer = await pool.query('SELECT email, name FROM users WHERE id = $1', [event.photographer_id]);
            if (photographer.rows.length > 0) {
                await resend.emails.send({
                    from: FROM_EMAIL,
                    to: photographer.rows[0].email,
                    subject: `🔔 Nuevo pedido pendiente: ${event.title}`,
                    html: `
                        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                            <h2 style="color: #0f172a;">¡Tienes un nuevo pedido!</h2>
                            <p><strong>Cliente:</strong> ${orderData.customer_name || orderData.customer_email}</p>
                            <p><strong>Evento:</strong> ${event.title}</p>
                            <p><strong>Monto:</strong> $${Number(orderData.amount).toLocaleString('es-CO')}</p>
                            <p><strong>Tu ganancia estimada:</strong> $${Number(orderData.photographer_net).toLocaleString('es-CO')}</p>
                            <br>
                            <a href="${process.env.FRONTEND_URL || 'https://globalfoto.onrender.com'}" style="background: #2563eb; color: white; padding: 10px 20px; text-decoration: none; border-radius: 6px; display: inline-block;">
                                Revisar comprobante en el Panel
                            </a>
                        </div>
                    `
                });
                console.log('✅ [EMAIL] Notificación enviada al fotógrafo.');
            }
        } catch (emailErr) {
            console.error('⚠️ [EMAIL] No se pudo notificar al fotógrafo:', emailErr.message);
        }

        res.status(201).json({
            mensaje: 'Pedido creado exitosamente. El fotógrafo revisará tu comprobante.',
            order: orderData
        });

    } catch (error) {
        console.error('Error al crear pedido:', error);
        res.status(500).json({ error: 'Error interno al crear el pedido.' });
    }
});

// =====================================================
// FOTÓGRAFO: Listar pedidos de sus eventos
// =====================================================
router.get('/photographer', verificarToken, async (req, res) => {
    try {
        const photographer_id = req.user.id;
        const { status, event_id } = req.query;

        const eventsResult = await pool.query('SELECT id FROM events WHERE photographer_id = $1', [photographer_id]);
        const eventIds = eventsResult.rows.map(e => e.id);

        if (eventIds.length === 0) return res.json({ orders: [] });

        let query = `
            SELECT o.*, e.title as event_title, e.photographer_id
            FROM orders o
            JOIN events e ON o.event_id = e.id
            WHERE e.photographer_id = $1
        `;
        const queryParams = [photographer_id];
        let paramIndex = 2;

        if (status) {
            query += ` AND o.status = $${paramIndex}`;
            queryParams.push(status);
            paramIndex++;
        }
        if (event_id && isValidId(event_id)) {
            query += ` AND o.event_id = $${paramIndex}`;
            queryParams.push(event_id);
            paramIndex++;
        }
        query += ' ORDER BY o.created_at DESC';

        const ordersResult = await pool.query(query, queryParams);
        res.json({ orders: ordersResult.rows });
    } catch (error) {
        console.error('Error al listar pedidos:', error);
        res.status(500).json({ error: 'Error interno al cargar pedidos.' });
    }
});

// =====================================================
// FOTÓGRAFO: Aprobar pedido
// =====================================================
router.put('/:id/approve', verificarToken, async (req, res) => {
    try {
        const { id } = req.params;
        const photographer_id = req.user.id;

        if (!isValidId(id)) return res.status(400).json({ error: 'ID de pedido inválido.' });

        const orderCheck = await pool.query(`
            SELECT o.*, e.photographer_id
            FROM orders o JOIN events e ON o.event_id = e.id
            WHERE o.id = $1 AND e.photographer_id = $2
        `, [id, photographer_id]);

        if (orderCheck.rows.length === 0) return res.status(404).json({ error: 'Pedido no encontrado o sin permisos.' });

        const order = orderCheck.rows[0];
        if (order.status !== 'pending') return res.status(400).json({ error: 'El pedido ya fue procesado.' });

        const downloadToken = crypto.randomBytes(32).toString('hex');
        const downloadExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 horas

        await pool.query(`
            UPDATE orders SET status = 'approved', download_token = $1, download_expires_at = $2, approved_at = NOW(), updated_at = NOW()
            WHERE id = $3
        `, [downloadToken, downloadExpiresAt, id]);

        let downloadUrls = [];
        let eventTitle = '';

        if (order.order_type === 'gallery') {
            const photosResult = await pool.query('SELECT url FROM photos WHERE event_id = $1 ORDER BY created_at', [order.event_id]);
            downloadUrls = photosResult.rows.map(p => p.url);
            const eventResult = await pool.query('SELECT title FROM events WHERE id = $1', [order.event_id]);
            eventTitle = eventResult.rows[0]?.title || 'Galería';
        } else {
            const photosResult = await pool.query('SELECT url FROM photos WHERE id = ANY($1)', [order.photo_ids]);
            downloadUrls = photosResult.rows.map(p => p.url);
            eventTitle = 'Fotos seleccionadas';
        }

        const downloadLinksHtml = downloadUrls.map((url, index) => `
            <div style="margin: 10px 0; padding: 10px; background: #f0f9ff; border-left: 4px solid #0ea5e9; border-radius: 4px;">
                <a href="${url}" style="color: #0ea5e9; text-decoration: none; font-weight: 600;" target="_blank">📥 Descargar foto ${index + 1}</a>
                <p style="margin: 5px 0 0 0; font-size: 12px; color: #64748b;"><em>Enlace de alta calidad (sin marca de agua)</em></p>
            </div>
        `).join('');

        // 📧 ENVIAR EMAIL AL CLIENTE CON LA API DE RESEND (Sin timeouts)
        console.log('📧 [EMAIL] Enviando al cliente:', order.customer_email);
        try {
            await resend.emails.send({
                from: FROM_EMAIL,
                to: order.customer_email,
                subject: `✅ Pago aprobado - ${eventTitle} | GlobalFoto`,
                html: `
                    <div style="font-family: 'Inter', sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                        <h1 style="color: #0f172a; margin-bottom: 20px;">¡Tu pago fue aprobado!</h1>
                        <p style="color: #334155; font-size: 16px; line-height: 1.6;">
                            Hola ${order.customer_name || 'cliente'},<br><br>
                            Tu comprobante de pago ha sido verificado. A continuación encontrarás los enlaces para descargar tus fotos:
                        </p>
                        <div style="background: #f8fafc; padding: 20px; border-radius: 8px; margin: 20px 0;">
                            <h2 style="color: #0f172a; font-size: 18px; margin-bottom: 15px;">📦 Tus fotos están listas</h2>
                            ${downloadLinksHtml}
                        </div>
                        <div style="background: #fef3c7; padding: 15px; border-radius: 8px; margin: 20px 0;">
                            <p style="color: #92400e; font-size: 14px; margin: 0;">
                                <strong>⚠️ Importante:</strong> Estos enlaces expiran en <strong>24 horas</strong>. Descárgalas antes de ese tiempo.
                            </p>
                        </div>
                        <p style="color: #64748b; font-size: 14px; margin-top: 30px; padding-top: 20px; border-top: 1px solid #e2e8f0;">
                            Gracias por confiar en GlobalFoto
                        </p>
                    </div>
                `
            });
            console.log('✅ [EMAIL] Enviado exitosamente al cliente.');
        } catch (emailError) {
            console.error('❌ [EMAIL] Error al enviar al cliente:', emailError.message);
        }

        res.json({
            mensaje: 'Pedido aprobado y correo enviado al cliente.',
            order: { ...order, status: 'approved', download_token: downloadToken }
        });

    } catch (error) {
        console.error('Error al aprobar pedido:', error);
        res.status(500).json({ error: 'Error interno al aprobar el pedido.' });
    }
});

// =====================================================
// FOTÓGRAFO: Rechazar pedido
// =====================================================
router.put('/:id/reject', verificarToken, async (req, res) => {
    try {
        const { id } = req.params;
        const { reason } = req.body;
        const photographer_id = req.user.id;

        if (!isValidId(id)) return res.status(400).json({ error: 'ID de pedido inválido.' });

        const orderCheck = await pool.query(`
            SELECT o.*, e.photographer_id FROM orders o JOIN events e ON o.event_id = e.id
            WHERE o.id = $1 AND e.photographer_id = $2
        `, [id, photographer_id]);

        if (orderCheck.rows.length === 0) return res.status(404).json({ error: 'Pedido no encontrado o sin permisos.' });

        const order = orderCheck.rows[0];
        if (order.status !== 'pending') return res.status(400).json({ error: 'El pedido ya fue procesado.' });

        await pool.query(`
            UPDATE orders SET status = 'rejected', rejection_reason = $1, rejected_at = NOW(), updated_at = NOW()
            WHERE id = $2
        `, [reason || 'Sin motivo especificado', id]);

        try {
            await resend.emails.send({
                from: FROM_EMAIL,
                to: order.customer_email,
                subject: `❌ Pedido rechazado - GlobalFoto`,
                html: `
                    <div style="font-family: 'Inter', sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                        <h1 style="color: #0f172a; margin-bottom: 20px;">Información sobre tu pedido</h1>
                        <p style="color: #334155; font-size: 16px; line-height: 1.6;">
                            Hola ${order.customer_name || 'cliente'},<br><br>
                            Lamentamos informarte que tu pedido no pudo ser aprobado.
                        </p>
                        ${reason ? `<div style="background: #fee2e2; padding: 15px; border-radius: 8px; margin: 20px 0;"><p style="color: #991b1b; margin: 0;"><strong>Motivo:</strong> ${reason}</p></div>` : ''}
                        <p style="color: #334155; font-size: 16px; line-height: 1.6; margin-top: 20px;">
                            Por favor, verifica tu comprobante de pago y vuelve a intentarlo.
                        </p>
                    </div>
                `
            });
            console.log('✅ [EMAIL RECHAZO] Enviado exitosamente.');
        } catch (emailError) {
            console.error('❌ [EMAIL RECHAZO] Error:', emailError.message);
        }

        res.json({ mensaje: 'Pedido rechazado y cliente notificado.', order: { ...order, status: 'rejected' } });
    } catch (error) {
        console.error('Error al rechazar pedido:', error);
        res.status(500).json({ error: 'Error interno al rechazar el pedido.' });
    }
});

module.exports = router;