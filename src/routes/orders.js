const express = require('express');
const router = express.Router();
const pool = require('../db');
const multer = require('multer');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const archiver = require('archiver');
const axios = require('axios');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { Resend } = require('resend');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

const s3Client = new S3Client({
    region: process.env.AWS_REGION,
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    }
});

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'notificaciones@globalfotoapp.com';
const JWT_SECRET = process.env.JWT_SECRET || 'globalfoto_secret_key_2024';
const BASE_URL = process.env.FRONTEND_URL || 'https://www.globalfotoapp.com';

const isValidId = (id) => /^\d+$/.test(id) && parseInt(id) > 0;

function getUserFromToken(req) {
    const authHeader = req.headers.authorization;
    if (!authHeader) return null;
    try {
        return jwt.verify(authHeader.split(' ')[1], JWT_SECRET);
    } catch (e) {
        return null;
    }
}

// Layout de correo con la marca (header degradado + cuerpo blanco)
function emailLayout(innerHtml) {
    return `
    <div style="font-family: 'Inter', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background: #f8fafc;">
        <div style="background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%); padding: 30px; border-radius: 16px 16px 0 0; text-align: center;">
            <h1 style="color: white; margin: 0; font-size: 28px;">📸 GlobalFoto</h1>
            <p style="color: #94a3b8; margin: 8px 0 0; font-size: 14px;">Tu plataforma profesional de fotografía</p>
        </div>
        <div style="background: white; padding: 30px; border-radius: 0 0 16px 16px; border: 1px solid #e2e8f0; border-top: none;">
            ${innerHtml}
            <p style="color: #64748b; font-size: 13px; text-align: center; margin: 24px 0 0; padding-top: 20px; border-top: 1px solid #e2e8f0;">
                GlobalFoto - Tu plataforma profesional de fotografía
            </p>
        </div>
    </div>`;
}

// =====================================================
// CREAR PEDIDO (Cliente, sin token)
// =====================================================
router.post('/create', upload.single('receipt'), async (req, res) => {
    try {
        const { event_id, customer_email, customer_name, order_type, photo_ids, package_id } = req.body;
        const receiptFile = req.file;

        if (!event_id || !customer_email || !customer_name || !receiptFile) {
            return res.status(400).json({ error: 'Faltan datos obligatorios o el comprobante de pago.' });
        }

        const eventResult = await pool.query('SELECT * FROM events WHERE id = $1', [event_id]);
        if (eventResult.rows.length === 0) return res.status(404).json({ error: 'Evento no encontrado.' });
        const event = eventResult.rows[0];

        if (event.status !== 'published') return res.status(400).json({ error: 'Esta galería no está disponible.' });

        let amount = 0;
        let final_photo_ids = [];
        let package_info = null;

        if (order_type === 'package') {
            if (!package_id) return res.status(400).json({ error: 'Paquete no especificado.' });
            const pkgResult = await pool.query('SELECT * FROM packages WHERE id = $1 AND event_id = $2 AND is_active = true', [package_id, event_id]);
            if (pkgResult.rows.length === 0) return res.status(404).json({ error: 'Paquete no válido.' });
            package_info = pkgResult.rows[0];
            amount = parseFloat(package_info.price);
            let ids = [];
            try { ids = JSON.parse(photo_ids || '[]'); } catch (e) { ids = []; }
            final_photo_ids = ids.slice(0, package_info.photo_limit);
        } else if (order_type === 'gallery') {
            amount = parseFloat(event.price_full_gallery) || 0;
            final_photo_ids = [];
        } else {
            let ids = [];
            try { ids = JSON.parse(photo_ids || '[]'); } catch (e) { ids = []; }
            if (ids.length === 0) return res.status(400).json({ error: 'No has seleccionado fotos.' });
            const pricePerPhoto = parseFloat(event.price_per_photo) || 0;
            if (pricePerPhoto <= 0) return res.status(400).json({ error: 'Precio por foto no configurado.' });
            amount = pricePerPhoto * ids.length;
            final_photo_ids = ids;
        }

        if (amount <= 0) return res.status(400).json({ error: 'Monto inválido.' });

        // Subir comprobante a S3
        const ext = receiptFile.mimetype.split('/')[1] || 'png';
        const receiptKey = `receipts/${event_id}/${crypto.randomBytes(16).toString('hex')}.${ext}`;
        await s3Client.send(new PutObjectCommand({
            Bucket: process.env.AWS_BUCKET_NAME,
            Key: receiptKey,
            Body: receiptFile.buffer,
            ContentType: receiptFile.mimetype,
            ServerSideEncryption: 'AES256'
        }));
        const receiptUrl = `https://${process.env.AWS_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${receiptKey}`;

        const commission_amount = amount * 0.10;
        const photographer_net = amount - commission_amount;

        const newOrder = await pool.query(`
            INSERT INTO orders (event_id, customer_email, customer_name, order_type, photo_ids, package_id, amount, photographer_net, commission_amount, receipt_url, status)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pending') RETURNING *
        `, [event_id, customer_email, customer_name, order_type, JSON.stringify(final_photo_ids), package_id ? parseInt(package_id) : null, amount, photographer_net, commission_amount, receiptUrl]);

        const order = newOrder.rows[0];

        // 📧 Correo espectacular al FOTÓGRAFO
        try {
            const photographer = await pool.query('SELECT name, email FROM users WHERE id = $1', [event.photographer_id]);
            if (photographer.rows.length > 0) {
                const tipoTexto = order_type === 'gallery' ? 'Galería completa' : (order_type === 'package' ? `Paquete: ${package_info.name}` : `${final_photo_ids.length} foto(s)`);
                await resend.emails.send({
                    from: FROM_EMAIL,
                    to: photographer.rows[0].email,
                    subject: `🛒 Nuevo pedido: ${customer_name} - $${Number(amount).toLocaleString('es-CO')}`,
                    html: emailLayout(`
                        <h2 style="color: #0f172a; margin: 0 0 16px; font-size: 22px;">¡Tienes un nuevo pedido! 🎉</h2>
                        <p style="color: #475569; font-size: 15px; line-height: 1.6; margin: 0 0 20px;">
                            Hola <strong>${photographer.rows[0].name}</strong>, un cliente acaba de enviar un comprobante de pago.
                        </p>
                        <div style="background: #f8fafc; padding: 20px; border-radius: 10px; margin: 0 0 20px; border-left: 4px solid #2563eb;">
                            <h3 style="color: #0f172a; margin: 0 0 12px; font-size: 16px;">🧾 Resumen del pedido</h3>
                            <p style="color: #475569; font-size: 14px; margin: 8px 0;"><strong>Cliente:</strong> ${customer_name} (${customer_email})</p>
                            <p style="color: #475569; font-size: 14px; margin: 8px 0;"><strong>Evento:</strong> ${event.title}</p>
                            <p style="color: #475569; font-size: 14px; margin: 8px 0;"><strong>Tipo:</strong> ${tipoTexto}</p>
                            <p style="color: #475569; font-size: 14px; margin: 8px 0;"><strong>Monto:</strong> $${Number(amount).toLocaleString('es-CO')}</p>
                            <p style="color: #065f46; font-size: 14px; margin: 8px 0;"><strong>Tu ganancia (90%):</strong> $${Number(photographer_net).toLocaleString('es-CO')}</p>
                        </div>
                        <div style="background: #fffbeb; padding: 16px; border-radius: 10px; border-left: 4px solid #f59e0b; margin: 0 0 20px;">
                            <p style="color: #92400e; font-size: 13px; margin: 0;"><strong>⏳ Acción requerida:</strong> Revisa el comprobante en tu panel y aprueba o rechaza el pedido. Al aprobarlo, el cliente recibirá sus fotos automáticamente.</p>
                        </div>
                        <div style="text-align: center; margin: 24px 0;">
                            <a href="${BASE_URL}" style="background: #2563eb; color: white; padding: 14px 32px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 15px; display: inline-block;">Revisar pedido en mi panel</a>
                        </div>
                    `)
                });
                console.log('✅ [EMAIL] Nuevo pedido notificado a:', photographer.rows[0].email);
            }
        } catch (emailErr) {
            console.error('⚠️ [EMAIL] No se pudo notificar al fotógrafo:', emailErr.message);
        }

        res.status(201).json({ mensaje: 'Pedido enviado correctamente.', order });
    } catch (error) {
        console.error('Error creando pedido:', error);
        res.status(500).json({ error: 'Error interno al crear el pedido.' });
    }
});

// =====================================================
// LISTAR PEDIDOS DEL FOTÓGRAFO
// =====================================================
router.get('/photographer', async (req, res) => {
    try {
        const user = getUserFromToken(req);
        if (!user) return res.status(401).json({ error: 'No autorizado.' });

        const orders = await pool.query(`
            SELECT o.*, e.title as event_title 
            FROM orders o JOIN events e ON o.event_id = e.id 
            WHERE e.photographer_id = $1 ORDER BY o.created_at DESC
        `, [user.id]);
        res.json({ orders: orders.rows });
    } catch (error) {
        console.error('Error al cargar pedidos:', error);
        res.status(500).json({ error: 'Error al cargar pedidos.' });
    }
});

// =====================================================
// APROBAR PEDIDO (+ correo espectacular al cliente con descarga)
// =====================================================
router.put('/:id/approve', async (req, res) => {
    try {
        const { id } = req.params;
        const user = getUserFromToken(req);
        if (!user) return res.status(401).json({ error: 'No autorizado.' });

        const orderCheck = await pool.query(`
            SELECT o.*, e.photographer_id, e.title as event_title 
            FROM orders o JOIN events e ON o.event_id = e.id WHERE o.id = $1
        `, [id]);
        if (orderCheck.rows.length === 0 || orderCheck.rows[0].photographer_id !== user.id) {
            return res.status(404).json({ error: 'Pedido no encontrado.' });
        }
        const order = orderCheck.rows[0];
        if (order.status !== 'pending') return res.status(400).json({ error: 'Este pedido ya fue procesado.' });

        const downloadToken = crypto.randomBytes(32).toString('hex');
        const downloadExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

        await pool.query(`
            UPDATE orders SET status = 'approved', download_token = $1, download_expires_at = $2, approved_at = NOW()
            WHERE id = $3
        `, [downloadToken, downloadExpiresAt, id]);

        const downloadUrl = `${BASE_URL}/api/orders/${order.id}/download?token=${downloadToken}`;
        const tipoTexto = order.order_type === 'gallery' ? 'la galería completa' : (order.order_type === 'package' ? 'tu paquete de fotos' : `${(JSON.parse(order.photo_ids || '[]')).length} foto(s)`);

        // 📧 Correo espectacular al CLIENTE
        try {
            await resend.emails.send({
                from: FROM_EMAIL,
                to: order.customer_email,
                subject: `✅ ¡Pago aprobado! Tus fotos de "${order.event_title}" están listas`,
                html: emailLayout(`
                    <h2 style="color: #0f172a; margin: 0 0 16px; font-size: 22px;">¡Hola ${order.customer_name}! 🎉</h2>
                    <p style="color: #475569; font-size: 15px; line-height: 1.6; margin: 0 0 20px;">
                        Tu pago fue <strong style="color: #065f46;">aprobado</strong> por el fotógrafo. Ya puedes descargar ${tipoTexto} de <strong>${order.event_title}</strong>.
                    </p>
                    <div style="background: #d1fae5; padding: 20px; border-radius: 10px; margin: 0 0 20px; border-left: 4px solid #10b981;">
                        <h3 style="color: #065f46; margin: 0 0 8px; font-size: 16px;">📥 Tu descarga está lista</h3>
                        <p style="color: #065f46; font-size: 13px; margin: 0;">Presiona el botón para descargar un archivo .ZIP con tus fotos en alta calidad (sin marca de agua).</p>
                    </div>
                    <div style="text-align: center; margin: 24px 0;">
                        <a href="${downloadUrl}" style="background: #10b981; color: white; padding: 14px 32px; text-decoration: none; border-radius: 8px; font-weight: 700; font-size: 16px; display: inline-block;">️ Descargar mis fotos</a>
                    </div>
                    <div style="background: #fffbeb; padding: 16px; border-radius: 10px; border-left: 4px solid #f59e0b;">
                        <p style="color: #92400e; font-size: 13px; margin: 0;"><strong>⏰ Importante:</strong> Este enlace de descarga expira en <strong>24 horas</strong>. Te recomendamos descargar tus fotos lo antes posible y guardarlas en un lugar seguro.</p>
                    </div>
                    <p style="color: #64748b; font-size: 13px; margin: 20px 0 0;">Gracias por comprar a través de GlobalFoto. 💙</p>
                `)
            });
            console.log('✅ [EMAIL] Aprobación enviada a:', order.customer_email);
        } catch (emailErr) {
            console.error('⚠️ [EMAIL] No se pudo enviar aprobación:', emailErr.message);
        }

        res.json({ mensaje: 'Pedido aprobado y cliente notificado.' });
    } catch (error) {
        console.error('Error al aprobar:', error);
        res.status(500).json({ error: 'Error al aprobar el pedido.' });
    }
});

// =====================================================
// RECHAZAR PEDIDO (+ correo al cliente con el motivo)
// =====================================================
router.put('/:id/reject', async (req, res) => {
    try {
        const { id } = req.params;
        const { reason } = req.body;
        const user = getUserFromToken(req);
        if (!user) return res.status(401).json({ error: 'No autorizado.' });

        const orderCheck = await pool.query(`
            SELECT o.*, e.photographer_id, e.title as event_title 
            FROM orders o JOIN events e ON o.event_id = e.id WHERE o.id = $1
        `, [id]);
        if (orderCheck.rows.length === 0 || orderCheck.rows[0].photographer_id !== user.id) {
            return res.status(404).json({ error: 'Pedido no encontrado.' });
        }
        const order = orderCheck.rows[0];
        if (order.status !== 'pending') return res.status(400).json({ error: 'Este pedido ya fue procesado.' });

        const motivo = reason || 'El comprobante no pudo ser validado.';
        await pool.query(`UPDATE orders SET status = 'rejected', rejection_reason = $1 WHERE id = $2`, [motivo, id]);

        // 📧 Correo al CLIENTE
        try {
            await resend.emails.send({
                from: FROM_EMAIL,
                to: order.customer_email,
                subject: `❌ Información sobre tu pedido en "${order.event_title}"`,
                html: emailLayout(`
                    <h2 style="color: #0f172a; margin: 0 0 16px; font-size: 22px;">Hola ${order.customer_name},</h2>
                    <p style="color: #475569; font-size: 15px; line-height: 1.6; margin: 0 0 20px;">
                        Lamentablemente el fotógrafo <strong>no pudo aprobar</strong> tu pedido para el evento <strong>${order.event_title}</strong>.
                    </p>
                    <div style="background: #fee2e2; padding: 20px; border-radius: 10px; margin: 0 0 20px; border-left: 4px solid #ef4444;">
                        <h3 style="color: #991b1b; margin: 0 0 8px; font-size: 16px;">Motivo del rechazo</h3>
                        <p style="color: #991b1b; font-size: 14px; margin: 0;">${motivo}</p>
                    </div>
                    <div style="background: #eff6ff; padding: 16px; border-radius: 10px; border-left: 4px solid #2563eb;">
                        <p style="color: #1e40af; font-size: 13px; margin: 0;"><strong>💡 ¿Qué puedes hacer?</strong> Verifica que el comprobante corresponda al monto exacto y vuelva a intentar la compra, o contacta directamente al fotógrafo para resolver cualquier duda.</p>
                    </div>
                    <p style="color: #64748b; font-size: 13px; margin: 20px 0 0;">Si crees que se trata de un error, responde a este correo y te ayudaremos. 💙</p>
                `)
            });
            console.log('✅ [EMAIL] Rechazo notificado a:', order.customer_email);
        } catch (emailErr) {
            console.error('⚠️ [EMAIL] No se pudo notificar rechazo:', emailErr.message);
        }

        res.json({ mensaje: 'Pedido rechazado y cliente notificado.' });
    } catch (error) {
        console.error('Error al rechazar:', error);
        res.status(500).json({ error: 'Error al rechazar el pedido.' });
    }
});

// =====================================================
// DESCARGA ZIP (Cliente con token válido)
// =====================================================
router.get('/:id/download', async (req, res) => {
    try {
        const { id } = req.params;
        const token = req.query.token;

        const orderResult = await pool.query('SELECT * FROM orders WHERE id = $1', [id]);
        if (orderResult.rows.length === 0) return res.status(404).json({ error: 'Pedido no encontrado.' });
        const order = orderResult.rows[0];

        if (order.status !== 'approved') return res.status(403).json({ error: 'Este pedido no está aprobado.' });
        if (!token || token !== order.download_token) return res.status(403).json({ error: 'Enlace de descarga inválido.' });
        if (order.download_expires_at && new Date(order.download_expires_at) < new Date()) {
            return res.status(410).json({ error: 'Este enlace de descarga ha expirado. Contacta al fotógrafo.' });
        }

        let photos;
        if (order.order_type === 'gallery') {
            photos = (await pool.query('SELECT * FROM photos WHERE event_id = $1', [order.event_id])).rows;
        } else {
            const ids = JSON.parse(order.photo_ids || '[]');
            if (ids.length === 0) {
                photos = (await pool.query('SELECT * FROM photos WHERE event_id = $1', [order.event_id])).rows;
            } else {
                photos = (await pool.query('SELECT * FROM photos WHERE id = ANY($1::int[])', [ids])).rows;
            }
        }

        if (photos.length === 0) return res.status(400).json({ error: 'No hay fotos para descargar.' });

        const eventResult = await pool.query('SELECT title FROM events WHERE id = $1', [order.event_id]);
        const zipName = `${(eventResult.rows[0]?.title || 'GlobalFoto').replace(/[^a-zA-Z0-9]/g, '_')}_fotos.zip`;
        res.attachment(zipName);

        const archive = archiver('zip', { zlib: { level: 9 } });
        archive.on('error', (err) => {
            console.error('Error ZIP:', err);
            if (!res.headersSent) res.status(500).json({ error: 'Error al generar el ZIP.' });
        });
        archive.pipe(res);

        for (const photo of photos) {
            try {
                const response = await axios.get(photo.url, { responseType: 'stream' });
                const name = photo.filename.split('/').pop() || 'foto.jpg';
                archive.append(response.data, { name });
            } catch (err) {
                console.error(`No se pudo incluir foto ${photo.id}:`, err.message);
            }
        }
        await archive.finalize();
    } catch (error) {
        console.error('Error en descarga:', error);
        if (!res.headersSent) res.status(500).json({ error: 'Error interno al descargar.' });
    }
});

module.exports = router;