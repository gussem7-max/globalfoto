const express = require('express');
const router = express.Router();
const pool = require('../db');
const verificarToken = require('../middleware/auth');
const multer = require('multer');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const crypto = require('crypto');
const nodemailer = require('nodemailer');

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

// Configurar transporter de Resend (vía SMTP)
const transporter = nodemailer.createTransport({
    host: 'smtp.resend.com',
    port: 465,
    secure: true,
    auth: {
        user: 'resend',
        pass: process.env.RESEND_API_KEY
    }
});

const isValidId = (id) => /^\d+$/.test(id) && parseInt(id) > 0;

// CLIENTE: Crear pedido y subir comprobante
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

        // Verificar que el evento existe y tiene ventas activas
        const eventResult = await pool.query(
            'SELECT * FROM events WHERE id = $1 AND sales_enabled = true',
            [event_id]
        );

        if (eventResult.rows.length === 0) {
            return res.status(404).json({ error: 'Evento no encontrado o ventas desactivadas.' });
        }

        const event = eventResult.rows[0];

        // Calcular monto
        let amount = 0;
        let finalPhotoIds = [];
        
        if (order_type === 'gallery') {
            amount = parseFloat(event.price_full_gallery) || 0;
            // Obtener todas las fotos del evento
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

        // Subir comprobante a S3
        const receiptFileName = `receipts/${event_id}/${Date.now()}_${crypto.randomBytes(8).toString('hex')}.${receiptImage.mimetype.split('/')[1]}`;
        await s3Client.send(new PutObjectCommand({
            Bucket: process.env.AWS_BUCKET_NAME,
            Key: receiptFileName,
            Body: receiptImage.buffer,
            ContentType: receiptImage.mimetype
        }));

        const receiptUrl = `https://${process.env.AWS_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${receiptFileName}`;

        // Calcular comisión (10%) y neto para fotógrafo (90%)
        const commissionAmount = amount * 0.10;
        const photographerNet = amount * 0.90;

        // Crear pedido
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

        res.status(201).json({
            mensaje: 'Pedido creado exitosamente. El fotógrafo revisará tu comprobante.',
            order: newOrder.rows[0]
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

        // Obtener todos los eventos del fotógrafo
        const eventsResult = await pool.query(
            'SELECT id FROM events WHERE photographer_id = $1',
            [photographer_id]
        );

        const eventIds = eventsResult.rows.map(e => e.id);

        if (eventIds.length === 0) {
            return res.json({ orders: [] });
        }

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

        if (!isValidId(id)) {
            return res.status(400).json({ error: 'ID de pedido inválido.' });
        }

        // Verificar que el pedido existe y pertenece al fotógrafo
        const orderCheck = await pool.query(`
            SELECT o.*, e.photographer_id
            FROM orders o
            JOIN events e ON o.event_id = e.id
            WHERE o.id = $1 AND e.photographer_id = $2
        `, [id, photographer_id]);

        if (orderCheck.rows.length === 0) {
            return res.status(404).json({ error: 'Pedido no encontrado o sin permisos.' });
        }

        const order = orderCheck.rows[0];

        if (order.status !== 'pending') {
            return res.status(400).json({ error: 'El pedido ya fue procesado.' });
        }

        // Generar token de descarga único
        const downloadToken = crypto.randomBytes(32).toString('hex');
        const downloadExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 horas

        // Actualizar pedido
        await pool.query(`
            UPDATE orders SET
                status = 'approved',
                download_token = $1,
                download_expires_at = $2,
                approved_at = NOW(),
                updated_at = NOW()
            WHERE id = $3
        `, [downloadToken, downloadExpiresAt, id]);

        // Obtener URLs de descarga
        let downloadUrls = [];
        let eventTitle = '';

        if (order.order_type === 'gallery') {
            const photosResult = await pool.query(
                'SELECT url FROM photos WHERE event_id = $1 ORDER BY created_at',
                [order.event_id]
            );
            downloadUrls = photosResult.rows.map(p => p.url);
            
            const eventResult = await pool.query('SELECT title FROM events WHERE id = $1', [order.event_id]);
            eventTitle = eventResult.rows[0]?.title || 'Galería';
        } else {
            const photosResult = await pool.query(
                'SELECT url FROM photos WHERE id = ANY($1)',
                [order.photo_ids]
            );
            downloadUrls = photosResult.rows.map(p => p.url);
            eventTitle = 'Fotos seleccionadas';
        }

        // Enviar email al cliente con links de descarga
        const downloadLinksHtml = downloadUrls.map(url => `
            <div style="margin: 10px 0; padding: 10px; background: #f0f9ff; border-left: 4px solid #0ea5e9; border-radius: 4px;">
                <a href="${url}" style="color: #0ea5e9; text-decoration: none; font-weight: 600;" target="_blank">
                    📥 Descargar foto ${downloadUrls.indexOf(url) + 1}
                </a>
                <p style="margin: 5px 0 0 0; font-size: 12px; color: #64748b;">
                    <em>Este enlace expira en 24 horas</em>
                </p>
            </div>
        `).join('');

        await transporter.sendMail({
            from: process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev',
            to: order.customer_email,
            subject: `✅ Pago aprobado - ${eventTitle} | GlobalFoto`,
            html: `
                <div style="font-family: 'Inter', sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                    <h1 style="color: #0f172a; margin-bottom: 20px;">¡Tu pago fue aprobado! </h1>
                    
                    <p style="color: #334155; font-size: 16px; line-height: 1.6;">
                        Hola ${order.customer_name || 'cliente'},<br><br>
                        Tu comprobante de pago ha sido verificado y aprobado. 
                        A continuación encontrarás los enlaces para descargar tus fotos:
                    </p>

                    <div style="background: #f8fafc; padding: 20px; border-radius: 8px; margin: 20px 0;">
                        <h2 style="color: #0f172a; font-size: 18px; margin-bottom: 15px;">
                            📦 Tus fotos están listas
                        </h2>
                        ${downloadLinksHtml}
                    </div>

                    <div style="background: #fef3c7; padding: 15px; border-radius: 8px; margin: 20px 0;">
                        <p style="color: #92400e; font-size: 14px; margin: 0;">
                            <strong>⚠️ Importante:</strong> Estos enlaces expiran en <strong>24 horas</strong>. 
                            Te recomendamos descargar todas tus fotos antes de ese tiempo.
                        </p>
                    </div>

                    <p style="color: #64748b; font-size: 14px; margin-top: 30px; padding-top: 20px; border-top: 1px solid #e2e8f0;">
                        Gracias por confiar en GlobalFoto<br>
                        <em>Si tienes alguna duda, responde a este correo.</em>
                    </p>
                </div>
            `
        });

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

        if (!isValidId(id)) {
            return res.status(400).json({ error: 'ID de pedido inválido.' });
        }

        const orderCheck = await pool.query(`
            SELECT o.*, e.photographer_id
            FROM orders o
            JOIN events e ON o.event_id = e.id
            WHERE o.id = $1 AND e.photographer_id = $2
        `, [id, photographer_id]);

        if (orderCheck.rows.length === 0) {
            return res.status(404).json({ error: 'Pedido no encontrado o sin permisos.' });
        }

        const order = orderCheck.rows[0];

        if (order.status !== 'pending') {
            return res.status(400).json({ error: 'El pedido ya fue procesado.' });
        }

        await pool.query(`
            UPDATE orders SET
                status = 'rejected',
                rejection_reason = $1,
                rejected_at = NOW(),
                updated_at = NOW()
            WHERE id = $2
        `, [reason || 'Sin motivo especificado', id]);

        // Enviar email de rechazo al cliente
        await transporter.sendMail({
            from: process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev',
            to: order.customer_email,
            subject: `❌ Pedido rechazado - GlobalFoto`,
            html: `
                <div style="font-family: 'Inter', sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                    <h1 style="color: #0f172a; margin-bottom: 20px;">Información sobre tu pedido</h1>
                    
                    <p style="color: #334155; font-size: 16px; line-height: 1.6;">
                        Hola ${order.customer_name || 'cliente'},<br><br>
                        Lamentamos informarte que tu pedido no pudo ser aprobado.
                    </p>

                    ${reason ? `
                        <div style="background: #fee2e2; padding: 15px; border-radius: 8px; margin: 20px 0;">
                            <p style="color: #991b1b; margin: 0;">
                                <strong>Motivo:</strong> ${reason}
                            </p>
                        </div>
                    ` : ''}

                    <p style="color: #334155; font-size: 16px; line-height: 1.6; margin-top: 20px;">
                        Por favor, verifica tu comprobante de pago y vuelve a intentarlo. 
                        Si crees que esto es un error, contáctanos respondiendo a este correo.
                    </p>

                    <p style="color: #64748b; font-size: 14px; margin-top: 30px; padding-top: 20px; border-top: 1px solid #e2e8f0;">
                        Equipo GlobalFoto
                    </p>
                </div>
            `
        });

        res.json({
            mensaje: 'Pedido rechazado y cliente notificado.',
            order: { ...order, status: 'rejected' }
        });

    } catch (error) {
        console.error('Error al rechazar pedido:', error);
        res.status(500).json({ error: 'Error interno al rechazar el pedido.' });
    }
});

// =====================================================
// CLIENTE: Verificar estado de pedido
// =====================================================
router.get('/status/:token', async (req, res) => {
    try {
        const { token } = req.params;

        const orderResult = await pool.query(`
            SELECT o.*, e.title as event_title
            FROM orders o
            JOIN events e ON o.event_id = e.id
            WHERE o.download_token = $1
        `, [token]);

        if (orderResult.rows.length === 0) {
            return res.status(404).json({ error: 'Pedido no encontrado.' });
        }

        const order = orderResult.rows[0];

        // Verificar si expiró
        if (order.download_expires_at && new Date(order.download_expires_at) < new Date()) {
            return res.status(410).json({ 
                error: 'El enlace de descarga ha expirado.',
                expired: true
            });
        }

        res.json({
            status: order.status,
            event_title: order.event_title,
            amount: order.amount,
            created_at: order.created_at
        });

    } catch (error) {
        console.error('Error al verificar estado:', error);
        res.status(500).json({ error: 'Error interno.' });
    }
});

module.exports = router;