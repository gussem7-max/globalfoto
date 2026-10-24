const express = require('express');
const router = express.Router();
const pool = require('../db');
const multer = require('multer');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { Resend } = require('resend');
const crypto = require('crypto');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
const s3Client = new S3Client({
    region: process.env.AWS_REGION,
    credentials: { accessKeyId: process.env.AWS_ACCESS_KEY_ID, secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY }
});
const resend = new Resend(process.env.RESEND_API_KEY);
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'notificaciones@globalfotoapp.com';

const isValidId = (id) => /^\d+$/.test(id) && parseInt(id) > 0;

// CREAR PEDIDO (Soporta Fotos Sueltas y Paquetes)
router.post('/create', upload.single('receipt'), async (req, res) => {
    try {
        const { event_id, customer_email, customer_name, order_type, photo_ids, package_id } = req.body;
        const receiptFile = req.file;

        if (!event_id || !customer_email || !customer_name || !receiptFile) {
            return res.status(400).json({ error: 'Faltan datos obligatorios o comprobante.' });
        }

        const eventResult = await pool.query('SELECT * FROM events WHERE id = $1', [event_id]);
        if (eventResult.rows.length === 0) return res.status(404).json({ error: 'Evento no encontrado.' });
        const event = eventResult.rows[0];

        if (event.status !== 'published') return res.status(400).json({ error: 'Esta galería no está disponible.' });

        let amount = 0;
        let photographer_net = 0;
        let commission_amount = 0;
        let final_photo_ids = [];
        let package_info = null;

        if (order_type === 'package') {
            if (!package_id) return res.status(400).json({ error: 'Paquete no especificado.' });
            const pkgResult = await pool.query('SELECT * FROM packages WHERE id = $1 AND event_id = $2 AND is_active = true', [package_id, event_id]);
            if (pkgResult.rows.length === 0) return res.status(404).json({ error: 'Paquete no válido.' });
            
            package_info = pkgResult.rows[0];
            amount = parseFloat(package_info.price);
            final_photo_ids = []; // El cliente elegirá las fotos después de aprobar
            
        } else {
            // Compra de fotos sueltas
            let selectedIds = [];
            try { selectedIds = JSON.parse(photo_ids || '[]'); } catch (e) { selectedIds = []; }
            if (selectedIds.length === 0) return res.status(400).json({ error: 'No has seleccionado fotos.' });

            const pricePerPhoto = parseFloat(event.price_per_photo) || 0;
            if (pricePerPhoto <= 0) return res.status(400).json({ error: 'Precio por foto no configurado.' });

            amount = pricePerPhoto * selectedIds.length;
            final_photo_ids = selectedIds;
        }

        if (amount <= 0) return res.status(400).json({ error: 'Monto inválido.' });

        // Subir comprobante a S3
        const receiptKey = `receipts/${event_id}/${crypto.randomBytes(16).toString('hex')}.${receiptFile.mimetype.split('/')[1]}`;
        await s3Client.send(new PutObjectCommand({
            Bucket: process.env.AWS_BUCKET_NAME, Key: receiptKey, Body: receiptFile.buffer, ContentType: receiptFile.mimetype
        }));
        const receiptUrl = `https://${process.env.AWS_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${receiptKey}`;

        // Calcular comisión (10% plataforma, 90% fotógrafo)
        commission_amount = amount * 0.10;
        photographer_net = amount - commission_amount;

        const newOrder = await pool.query(`
            INSERT INTO orders (event_id, customer_email, customer_name, order_type, photo_ids, package_id, amount, photographer_net, commission_amount, receipt_url, status)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pending') RETURNING *
        `, [event_id, customer_email, customer_name, order_type, JSON.stringify(final_photo_ids), package_id ? parseInt(package_id) : null, amount, photographer_net, commission_amount, receiptUrl]);

        // Notificar al fotógrafo
        try {
            const photographer = await pool.query('SELECT email, name FROM users WHERE id = $1', [event.photographer_id]);
            if (photographer.rows.length > 0) {
                await resend.emails.send({
                    from: FROM_EMAIL, to: photographer.rows[0].email,
                    subject: ` Nuevo Pedido: ${customer_name} - $${amount.toLocaleString('es-CO')}`,
                    html: `<div style="font-family: sans-serif; padding: 20px;">
                        <h3>Nuevo pedido en "${event.title}"</h3>
                        <p><strong>Cliente:</strong> ${customer_name} (${customer_email})</p>
                        <p><strong>Tipo:</strong> ${order_type === 'package' ? `Paquete: ${package_info.name}` : `${final_photo_ids.length} fotos sueltas`}</p>
                        <p><strong>Monto:</strong> $${amount.toLocaleString('es-CO')}</p>
                        <p>Entra a tu panel para aprobar el pago.</p>
                    </div>`
                });
            }
        } catch (err) { console.error('Error notificando fotógrafo:', err); }

        res.status(201).json({ mensaje: 'Pedido enviado correctamente.', order: newOrder.rows[0] });
    } catch (error) {
        console.error('Error creando pedido:', error);
        res.status(500).json({ error: 'Error interno al crear el pedido.' });
    }
});

// LISTAR PEDIDOS (Fotógrafo)
router.get('/photographer', async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader) return res.status(401).json({ error: 'No autorizado.' });
        const jwt = require('jsonwebtoken');
        const decoded = jwt.verify(authHeader.split(' ')[1], process.env.JWT_SECRET || 'globalfoto_secret_key_2024');
        
        const orders = await pool.query(`
            SELECT o.*, e.title as event_title 
            FROM orders o JOIN events e ON o.event_id = e.id 
            WHERE e.photographer_id = $1 ORDER BY o.created_at DESC
        `, [decoded.id]);
        res.json({ orders: orders.rows });
    } catch (error) { res.status(500).json({ error: 'Error al cargar pedidos.' }); }
});

// APROBAR PEDIDO
router.put('/:id/approve', async (req, res) => {
    try {
        const { id } = req.params;
        const authHeader = req.headers.authorization;
        if (!authHeader) return res.status(401).json({ error: 'No autorizado.' });
        const jwt = require('jsonwebtoken');
        const decoded = jwt.verify(authHeader.split(' ')[1], process.env.JWT_SECRET || 'globalfoto_secret_key_2024');

        const orderCheck = await pool.query(`
            SELECT o.*, e.photographer_id, e.title as event_title 
            FROM orders o JOIN events e ON o.event_id = e.id WHERE o.id = $1
        `, [id]);
        if (orderCheck.rows.length === 0 || orderCheck.rows[0].photographer_id !== decoded.id) {
            return res.status(404).json({ error: 'Pedido no encontrado.' });
        }
        const order = orderCheck.rows[0];
        if (order.status !== 'pending') return res.status(400).json({ error: 'Pedido ya procesado.' });

        const downloadToken = crypto.randomBytes(32).toString('hex');
        const downloadExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

        await pool.query(`
            UPDATE orders SET status = 'approved', download_token = $1, download_expires_at = $2, approved_at = NOW() WHERE id = $3
        `, [downloadToken, downloadExpiresAt, id]);

        // Enviar correo al cliente con los links
        try {
            let downloadLinksHtml = '';
            const baseUrl = process.env.FRONTEND_URL || 'https://www.globalfotoapp.com';
            
            if (order.order_type === 'package') {
                downloadLinksHtml = `<p>Has comprado el paquete <strong>${order.package_id ? 'Seleccionado' : 'Premium'}</strong>. El fotógrafo te enviará las fotos seleccionadas pronto, o puedes descargar las disponibles aquí:</p>
                <a href="${baseUrl}/api/orders/${id}/download?token=${downloadToken}" style="background: #2563eb; color: white; padding: 10px 20px; text-decoration: none; border-radius: 8px;">Descargar Fotos</a>`;
            } else {
                const photoIds = JSON.parse(order.photo_ids || '[]');
                downloadLinksHtml = `<p>Tus fotos están listas para descargar:</p><ul>`;
                photoIds.forEach(pid => {
                    downloadLinksHtml += `<li><a href="${baseUrl}/api/photos/${pid}/download?token=${downloadToken}">Descargar Foto #${pid}</a></li>`;
                });
                downloadLinksHtml += `</ul>`;
            }

            await resend.emails.send({
                from: FROM_EMAIL, to: order.customer_email,
                subject: `✅ Pago aprobado - ${order.event_title} | GlobalFoto`,
                html: `<div style="font-family: sans-serif; padding: 20px;">
                    <h2>¡Hola ${order.customer_name}!</h2>
                    <p>Tu pago ha sido aprobado. Gracias por confiar en GlobalFoto.</p>
                    ${downloadLinksHtml}
                    <p style="margin-top: 20px; font-size: 12px; color: #666;">Estos enlaces expiran en 24 horas.</p>
                </div>`
            });
        } catch (err) { console.error('Error enviando email de aprobación:', err); }

        res.json({ mensaje: 'Pedido aprobado y notificado al cliente.' });
    } catch (error) { res.status(500).json({ error: 'Error al aprobar pedido.' }); }
});

// RECHAZAR PEDIDO
router.put('/:id/reject', async (req, res) => {
    try {
        const { id } = req.params;
        const { reason } = req.body;
        const authHeader = req.headers.authorization;
        if (!authHeader) return res.status(401).json({ error: 'No autorizado.' });
        const jwt = require('jsonwebtoken');
        const decoded = jwt.verify(authHeader.split(' ')[1], process.env.JWT_SECRET || 'globalfoto_secret_key_2024');

        const orderCheck = await pool.query(`SELECT o.*, e.photographer_id FROM orders o JOIN events e ON o.event_id = e.id WHERE o.id = $1`, [id]);
        if (orderCheck.rows.length === 0 || orderCheck.rows[0].photographer_id !== decoded.id) return res.status(404).json({ error: 'Pedido no encontrado.' });

        await pool.query("UPDATE orders SET status = 'rejected', rejection_reason = $1 WHERE id = $2", [reason || 'Sin motivo', id]);
        res.json({ mensaje: 'Pedido rechazado.' });
    } catch (error) { res.status(500).json({ error: 'Error al rechazar pedido.' }); }
});

module.exports = router;