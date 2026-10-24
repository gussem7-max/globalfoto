const express = require('express');
const router = express.Router();
const pool = require('../db');
const verificarToken = require('../middleware/auth');
const archiver = require('archiver');
const { S3Client, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const axios = require('axios');
const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'notificaciones@globalfotoapp.com';

const s3Client = new S3Client({
    region: process.env.AWS_REGION,
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    }
});

const isValidId = (id) => /^\d+$/.test(id) && parseInt(id) > 0;

// =====================================================
// CREAR EVENTO
// =====================================================
router.post('/', verificarToken, async (req, res) => {
    try {
        const { title, event_date, location, description, status, expires_at } = req.body;
        const photographer_id = req.user.id;

        if (!title) return res.status(400).json({ error: 'El título es requerido.' });

        const newEvent = await pool.query(`
            INSERT INTO events (photographer_id, title, event_date, location, description, status, expires_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING *
        `, [photographer_id, title, event_date || null, location || '', description || '', status || 'published', expires_at || null]);

        const event = newEvent.rows[0];

        // Correo de confirmación
        try {
            const photographer = await pool.query('SELECT name, email FROM users WHERE id = $1', [photographer_id]);
            if (photographer.rows.length > 0) {
                const publicUrl = `${process.env.FRONTEND_URL || 'https://www.globalfotoapp.com'}/?galeria=${event.id}`;
                await resend.emails.send({
                    from: FROM_EMAIL,
                    to: photographer.rows[0].email,
                    subject: ` Evento creado: ${event.title}`,
                    html: `<div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                        <h2 style="color: #0f172a;">¡Evento creado exitosamente!</h2>
                        <p>Hola ${photographer.rows[0].name}, tu evento <strong>${event.title}</strong> está listo.</p>
                        <p>Estado: <strong>${event.status}</strong></p>
                        <a href="${publicUrl}" style="background: #2563eb; color: white; padding: 10px 20px; text-decoration: none; border-radius: 8px; display: inline-block;">Ver Galería</a>
                    </div>`
                });
            }
        } catch (emailErr) { console.error('Error email:', emailErr.message); }

        res.status(201).json({ mensaje: 'Evento creado exitosamente.', event });
    } catch (error) {
        console.error('Error al crear evento:', error);
        res.status(500).json({ error: 'Error interno al crear el evento.' });
    }
});

// =====================================================
// ACTUALIZAR EVENTO (Incluye Estado y Expiración)
// =====================================================
router.put('/:id', verificarToken, async (req, res) => {
    try {
        const { id } = req.params;
        const { title, event_date, location, description, status, expires_at } = req.body;
        const photographer_id = req.user.id;

        const eventCheck = await pool.query('SELECT id FROM events WHERE id = $1 AND photographer_id = $2', [id, photographer_id]);
        if (eventCheck.rows.length === 0) return res.status(404).json({ error: 'Evento no encontrado.' });

        const updated = await pool.query(`
            UPDATE events SET title = $1, event_date = $2, location = $3, description = $4, status = $5, expires_at = $6
            WHERE id = $7 RETURNING *
        `, [title, event_date, location, description, status, expires_at, id]);

        res.json({ mensaje: 'Evento actualizado.', event: updated.rows[0] });
    } catch (error) {
        res.status(500).json({ error: 'Error al actualizar evento.' });
    }
});

// =====================================================
// LISTAR EVENTOS
// =====================================================
router.get('/', verificarToken, async (req, res) => {
    try {
        const photographer_id = req.user.id;
        const allEvents = await pool.query(`
            SELECT e.*, COUNT(p.id) as "photosCount"
            FROM events e LEFT JOIN photos p ON e.id = p.event_id
            WHERE e.photographer_id = $1 GROUP BY e.id ORDER BY e.created_at DESC;
        `, [photographer_id]);
        
        res.json(allEvents.rows.map(ev => ({ ...ev, photosCount: parseInt(ev.photosCount, 10) || 0 })));
    } catch (error) {
        res.status(500).json({ error: 'Error al listar eventos.' });
    }
});

// =====================================================
// GALERÍA PÚBLICA (Con validación de Estado y Expiración)
// =====================================================
router.get('/:id/public', async (req, res) => {
    try {
        const { id } = req.params;
        if (!isValidId(id)) return res.status(400).json({ error: 'ID inválido.' });

        const eventResult = await pool.query('SELECT * FROM events WHERE id = $1', [id]);
        if (eventResult.rows.length === 0) return res.status(404).json({ error: 'Evento no existe.' });

        const event = eventResult.rows[0];

        // 🔒 Validación de Estado y Expiración
        if (event.status !== 'published') {
            return res.status(404).json({ error: 'Esta galería no está disponible en este momento.' });
        }
        if (event.expires_at && new Date(event.expires_at) < new Date()) {
            return res.status(404).json({ error: 'Esta galería ha expirado.' });
        }

        const photosResult = await pool.query('SELECT id, preview_url, created_at FROM photos WHERE event_id = $1 ORDER BY created_at DESC', [id]);
        const protectedPhotos = photosResult.rows.map(p => ({ id: p.id, url: p.preview_url, created_at: p.created_at }));

        // Obtener paquetes activos
        const packagesResult = await pool.query('SELECT * FROM packages WHERE event_id = $1 AND is_active = true ORDER BY price ASC', [id]);

        res.json({ event, photos: protectedPhotos, packages: packagesResult.rows });
    } catch (error) {
        res.status(500).json({ error: 'Error al cargar la galería.' });
    }
});

// =====================================================
// GESTIÓN DE PAQUETES
// =====================================================
router.get('/:id/packages', verificarToken, async (req, res) => {
    try {
        const { id } = req.params;
        const photographer_id = req.user.id;
        const eventCheck = await pool.query('SELECT id FROM events WHERE id = $1 AND photographer_id = $2', [id, photographer_id]);
        if (eventCheck.rows.length === 0) return res.status(404).json({ error: 'Evento no encontrado.' });

        const packages = await pool.query('SELECT * FROM packages WHERE event_id = $1 ORDER BY price ASC', [id]);
        res.json(packages.rows);
    } catch (error) { res.status(500).json({ error: 'Error al cargar paquetes.' }); }
});

router.post('/:id/packages', verificarToken, async (req, res) => {
    try {
        const { id } = req.params;
        const { name, photo_limit, price } = req.body;
        const photographer_id = req.user.id;

        const eventCheck = await pool.query('SELECT id FROM events WHERE id = $1 AND photographer_id = $2', [id, photographer_id]);
        if (eventCheck.rows.length === 0) return res.status(404).json({ error: 'Evento no encontrado.' });

        const newPackage = await pool.query(
            'INSERT INTO packages (event_id, name, photo_limit, price) VALUES ($1, $2, $3, $4) RETURNING *',
            [id, name, photo_limit, price]
        );
        res.status(201).json({ mensaje: 'Paquete creado.', package: newPackage.rows[0] });
    } catch (error) { res.status(500).json({ error: 'Error al crear paquete.' }); }
});

router.delete('/packages/:packageId', verificarToken, async (req, res) => {
    try {
        const { packageId } = req.params;
        const photographer_id = req.user.id;

        const pkgCheck = await pool.query(`
            SELECT p.id FROM packages p JOIN events e ON p.event_id = e.id 
            WHERE p.id = $1 AND e.photographer_id = $2`, [packageId, photographer_id]
        );
        if (pkgCheck.rows.length === 0) return res.status(404).json({ error: 'Paquete no encontrado.' });

        await pool.query('DELETE FROM packages WHERE id = $1', [packageId]);
        res.json({ mensaje: 'Paquete eliminado.' });
    } catch (error) { res.status(500).json({ error: 'Error al eliminar paquete.' }); }
});

// =====================================================
// ELIMINAR EVENTO
// =====================================================
router.delete('/:id', verificarToken, async (req, res) => {
    try {
        const { id } = req.params;
        const photographer_id = req.user.id;
        const eventCheck = await pool.query('SELECT id FROM events WHERE id = $1 AND photographer_id = $2', [id, photographer_id]);
        if (eventCheck.rows.length === 0) return res.status(404).json({ error: 'Evento no encontrado.' });

        const photosResult = await pool.query('SELECT filename FROM photos WHERE event_id = $1', [id]);
        for (const photo of photosResult.rows) {
            try { await s3Client.send(new DeleteObjectCommand({ Bucket: process.env.AWS_BUCKET_NAME, Key: photo.filename })); } 
            catch (s3Error) { console.error('Error S3:', s3Error); }
        }
        await pool.query('DELETE FROM events WHERE id = $1', [id]);
        res.json({ mensaje: 'Evento eliminado.' });
    } catch (error) { res.status(500).json({ error: 'Error al eliminar evento.' }); }
});

// =====================================================
// LISTAR FOTOS (Protegido)
// =====================================================
router.get('/:id/photos', verificarToken, async (req, res) => {
    try {
        const { id } = req.params;
        const photographer_id = req.user.id;
        const eventCheck = await pool.query('SELECT id FROM events WHERE id = $1 AND photographer_id = $2', [id, photographer_id]);
        if (eventCheck.rows.length === 0) return res.status(404).json({ error: 'Evento no encontrado.' });

        const photosResult = await pool.query('SELECT id, url, filename, preview_url, created_at FROM photos WHERE event_id = $1 ORDER BY created_at DESC', [id]);
        res.json({ photos: photosResult.rows });
    } catch (error) { res.status(500).json({ error: 'Error al cargar fotos.' }); }
});

module.exports = router;