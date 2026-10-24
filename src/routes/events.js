const express = require('express');
const router = express.Router();
const pool = require('../db');
const verificarToken = require('../middleware/auth');
const archiver = require('archiver');
const { S3Client, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const axios = require('axios');
const { Resend } = require('resend'); // <-- IMPORTANTE: Agregado

// Inicializar Resend
const resend = new Resend(process.env.RESEND_API_KEY);
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'notificaciones@globalfotoapp.com'; // <-- IMPORTANTE: Agregado

const s3Client = new S3Client({
    region: process.env.AWS_REGION,
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    }
});

// Validar que un ID sea número entero positivo
const isValidId = (id) => /^\d+$/.test(id) && parseInt(id) > 0;

// =====================================================
// CREAR EVENTO (CON CORREO DE CONFIRMACIÓN)
// =====================================================
router.post('/', verificarToken, async (req, res) => {
    try {
        const { title, event_date, location, description } = req.body;
        const photographer_id = req.user.id;

        if (!title) {
            return res.status(400).json({ error: 'El título del evento es requerido.' });
        }

        const newEvent = await pool.query(`
            INSERT INTO events (photographer_id, title, event_date, location, description)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING *
        `, [photographer_id, title, event_date || null, location || '', description || '']);

        const event = newEvent.rows[0];

        // 📧 ENVIAR CORREO DE CONFIRMACIÓN AL FOTÓGRAFO
        try {
            const photographer = await pool.query('SELECT name, email FROM users WHERE id = $1', [photographer_id]);
            if (photographer.rows.length > 0) {
                const publicUrl = `${process.env.FRONTEND_URL || 'https://www.globalfotoapp.com'}/?galeria=${event.id}`;
                
                await resend.emails.send({
                    from: FROM_EMAIL,
                    to: photographer.rows[0].email,
                    subject: `📸 Evento creado: ${event.title}`,
                    html: `
                        <div style="font-family: 'Inter', sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                            <div style="background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%); padding: 30px; border-radius: 16px 16px 0 0; text-align: center;">
                                <h1 style="color: white; margin: 0; font-size: 28px;">📸 GlobalFoto</h1>
                            </div>
                            <div style="background: white; padding: 30px; border-radius: 0 0 16px 16px; border: 1px solid #e2e8f0; border-top: none;">
                                <h2 style="color: #0f172a; margin-bottom: 16px;">¡Evento creado exitosamente!</h2>
                                <p style="color: #475569; font-size: 15px; line-height: 1.6; margin-bottom: 20px;">
                                    Hola ${photographer.rows[0].name},<br><br>
                                    Tu nuevo evento ha sido registrado en la plataforma.
                                </p>
                                <div style="background: #f8fafc; padding: 20px; border-radius: 10px; margin-bottom: 20px; border-left: 4px solid #2563eb;">
                                    <h3 style="color: #0f172a; margin: 0 0 12px 0; font-size: 16px;">📋 Detalles del evento</h3>
                                    <p style="color: #475569; font-size: 14px; margin: 8px 0;"><strong>Título:</strong> ${event.title}</p>
                                    ${event.event_date ? `<p style="color: #475569; font-size: 14px; margin: 8px 0;"><strong>Fecha:</strong> ${event.event_date}</p>` : ''}
                                    ${event.location ? `<p style="color: #475569; font-size: 14px; margin: 8px 0;"><strong>Ubicación:</strong> ${event.location}</p>` : ''}
                                </div>
                                <div style="background: #eff6ff; padding: 20px; border-radius: 10px; margin-bottom: 20px;">
                                    <h3 style="color: #0f172a; margin: 0 0 12px 0; font-size: 16px;">🔗 Tu enlace público</h3>
                                    <p style="color: #475569; font-size: 13px; margin-bottom: 12px;">Comparte este enlace con tus clientes para que vean la galería:</p>
                                    <a href="${publicUrl}" style="background: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 14px; display: inline-block; word-break: break-all;">
                                        Ver Galería Pública
                                    </a>
                                </div>
                                <div style="background: #fffbeb; padding: 16px; border-radius: 10px; border-left: 4px solid #f59e0b;">
                                    <p style="color: #92400e; font-size: 13px; margin: 0;">
                                        <strong>💡 Siguiente paso:</strong> Sube tus fotos al evento y configura los precios para comenzar a vender.
                                    </p>
                                </div>
                                <p style="color: #64748b; font-size: 13px; text-align: center; margin-top: 24px; padding-top: 20px; border-top: 1px solid #e2e8f0;">
                                    GlobalFoto - Tu plataforma profesional de fotografía
                                </p>
                            </div>
                        </div>
                    `
                });
                console.log('✅ [EMAIL] Correo de confirmación de evento enviado a:', photographer.rows[0].email);
            }
        } catch (emailErr) {
            console.error('⚠️ [EMAIL] No se pudo enviar confirmación de evento:', emailErr.message);
        }

        res.status(201).json({
            mensaje: 'Evento creado exitosamente.',
            event
        });

    } catch (error) {
        console.error('Error al crear evento:', error);
        res.status(500).json({ error: 'Error interno al crear el evento.' });
    }
});

// =====================================================
// LISTAR EVENTOS SOLO DEL USUARIO AUTENTICADO
// =====================================================
router.get('/', verificarToken, async (req, res) => {
    try {
        const photographer_id = req.user.id;
        
        const query = `
            SELECT e.*, COUNT(p.id) as "photosCount"
            FROM events e
            LEFT JOIN photos p ON e.id = p.event_id
            WHERE e.photographer_id = $1
            GROUP BY e.id
            ORDER BY e.created_at DESC;
        `;
        const allEvents = await pool.query(query, [photographer_id]);
        
        const eventsWithCount = allEvents.rows.map(ev => ({
            ...ev,
            photosCount: parseInt(ev.photosCount, 10) || 0
        }));

        res.json(eventsWithCount);
    } catch (error) {
        console.error('Error al obtener los eventos:', error);
        res.status(500).json({ error: 'Error interno al listar los eventos.' });
    }
});

// =====================================================
// CONFIGURAR PRECIOS Y DATOS DE PAGO
// =====================================================
router.put('/:id/pricing', verificarToken, async (req, res) => {
    try {
        const { id } = req.params;
        const photographer_id = req.user.id;
        const { 
            price_per_photo, 
            price_full_gallery, 
            currency = 'COP',
            nequi_phone,
            nequi_name,
            qr_code_url,
            sales_enabled 
        } = req.body;

        if (!isValidId(id)) {
            return res.status(400).json({ error: 'ID de evento inválido.' });
        }

        const eventCheck = await pool.query(
            'SELECT id FROM events WHERE id = $1 AND photographer_id = $2',
            [id, photographer_id]
        );

        if (eventCheck.rows.length === 0) {
            return res.status(404).json({ error: 'Evento no encontrado o sin permisos.' });
        }

        const photoPrice = parseFloat(price_per_photo) || 0;
        const galleryPrice = parseFloat(price_full_gallery) || 0;

        if (photoPrice < 0 || galleryPrice < 0) {
            return res.status(400).json({ error: 'Los precios no pueden ser negativos.' });
        }

        const updated = await pool.query(`
            UPDATE events SET 
                price_per_photo = $1, 
                price_full_gallery = $2, 
                currency = $3,
                nequi_phone = $4,
                nequi_name = $5,
                qr_code_url = $6,
                sales_enabled = $7
            WHERE id = $8
            RETURNING *
        `, [photoPrice, galleryPrice, currency, nequi_phone || '', nequi_name || '', qr_code_url || '', sales_enabled === true, id]);

        res.json({
            mensaje: 'Configuración de precios actualizada.',
            event: updated.rows[0]
        });

    } catch (error) {
        console.error('Error al actualizar precios:', error);
        res.status(500).json({ error: 'Error interno al guardar la configuración.' });
    }
});

// =====================================================
// ELIMINAR EVENTO
// =====================================================
router.delete('/:id', verificarToken, async (req, res) => {
    try {
        const { id } = req.params;
        const photographer_id = req.user.id;

        if (!isValidId(id)) {
            return res.status(400).json({ error: 'ID de evento inválido.' });
        }

        const eventCheck = await pool.query(
            'SELECT id FROM events WHERE id = $1 AND photographer_id = $2',
            [id, photographer_id]
        );

        if (eventCheck.rows.length === 0) {
            return res.status(404).json({ error: 'Evento no encontrado o sin permisos.' });
        }

        const photosResult = await pool.query('SELECT filename FROM photos WHERE event_id = $1', [id]);
        
        for (const photo of photosResult.rows) {
            try {
                await s3Client.send(new DeleteObjectCommand({
                    Bucket: process.env.AWS_BUCKET_NAME,
                    Key: photo.filename
                }));
            } catch (s3Error) {
                console.error(`Error al eliminar archivo de S3 (${photo.filename}):`, s3Error);
            }
        }

        await pool.query('DELETE FROM events WHERE id = $1', [id]);

        res.json({ mensaje: 'Evento y sus fotografías eliminados correctamente.' });
    } catch (error) {
        console.error('Error al eliminar evento:', error);
        res.status(500).json({ error: 'Error interno al eliminar el evento.' });
    }
});

// =====================================================
// GALERÍA PÚBLICA (CON PROTECCIÓN)
// =====================================================
router.get('/:id/public', async (req, res) => {
    try {
        const { id } = req.params;

        if (!isValidId(id)) {
            return res.status(400).json({ error: 'ID de evento inválido.' });
        }

        const eventResult = await pool.query('SELECT * FROM events WHERE id = $1', [id]);
        if (eventResult.rows.length === 0) {
            return res.status(404).json({ error: 'El evento no existe.' });
        }

        const photosResult = await pool.query(
            'SELECT id, preview_url, created_at FROM photos WHERE event_id = $1 ORDER BY created_at DESC', 
            [id]
        );

        // 🔒 Solo devolvemos preview_url, NUNCA la url original
        const protectedPhotos = photosResult.rows.map(p => ({
            id: p.id,
            url: p.preview_url, // El frontend usará esto como "url"
            created_at: p.created_at
        }));

        res.json({
            event: eventResult.rows[0],
            photos: protectedPhotos
        });
    } catch (error) {
        console.error('Error al obtener la galería pública:', error);
        res.status(500).json({ error: 'Error interno al cargar la galería.' });
    }
});

// =====================================================
// DESCARGA ZIP PÚBLICA
// =====================================================
router.get('/:id/download-zip', async (req, res) => {
    try {
        const { id } = req.params;

        if (!isValidId(id)) {
            return res.status(400).json({ error: 'ID de evento inválido.' });
        }

        const eventResult = await pool.query('SELECT * FROM events WHERE id = $1', [id]);
        if (eventResult.rows.length === 0) {
            return res.status(404).json({ error: 'El evento no existe.' });
        }
        const event = eventResult.rows[0];

        const photosResult = await pool.query('SELECT * FROM photos WHERE event_id = $1', [id]);
        const photos = photosResult.rows;

        if (photos.length === 0) {
            return res.status(400).json({ error: 'Este evento no contiene fotografías para descargar.' });
        }

        const zipFileName = `${event.title.replace(/[^a-zA-Z0-9]/g, '_')}_GlobalFoto.zip`;
        res.attachment(zipFileName);

        const archive = archiver('zip', { zlib: { level: 9 } });

        archive.on('error', (err) => {
            console.error('Error al empaquetar ZIP:', err);
            if (!res.headersSent) {
                res.status(500).json({ error: 'Error al generar el archivo ZIP.' });
            }
        });

        archive.pipe(res);

        for (const photo of photos) {
            try {
                const response = await axios.get(photo.url, { responseType: 'stream' });
                const fileNameInZip = photo.filename.split('/').pop() || 'foto.jpg';
                archive.append(response.data, { name: fileNameInZip });
            } catch (err) {
                console.error(`No se pudo incluir la foto ${photo.url} en el ZIP:`, err.message);
            }
        }

        await archive.finalize();

    } catch (error) {
        console.error('Error al procesar descarga ZIP:', error);
        if (!res.headersSent) {
            res.status(500).json({ error: 'Error interno al generar la descarga masiva.' });
        }
    }
});

// =====================================================
// LISTAR FOTOS DE UN EVENTO (Protegido)
// =====================================================
router.get('/:id/photos', verificarToken, async (req, res) => {
    try {
        const { id } = req.params;
        const photographer_id = req.user.id;

        if (!isValidId(id)) {
            return res.status(400).json({ error: 'ID de evento inválido.' });
        }

        const eventCheck = await pool.query(
            'SELECT id FROM events WHERE id = $1 AND photographer_id = $2',
            [id, photographer_id]
        );

        if (eventCheck.rows.length === 0) {
            return res.status(404).json({ error: 'Evento no encontrado o sin permisos.' });
        }

        const photosResult = await pool.query(
            'SELECT id, url, filename, preview_url, created_at FROM photos WHERE event_id = $1 ORDER BY created_at DESC',
            [id]
        );

        res.json({ photos: photosResult.rows });
    } catch (error) {
        console.error('Error al obtener fotos:', error);
        res.status(500).json({ error: 'Error interno al cargar las fotos.' });
    }
});

module.exports = router;