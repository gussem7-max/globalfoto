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
// CREAR EVENTO (con estado, expiración y correo espectacular)
// =====================================================
router.post('/', verificarToken, async (req, res) => {
    try {
        const { title, event_date, location, description, status, expires_at, selfie_required } = req.body;
        const photographer_id = req.user.id;

        if (!title) return res.status(400).json({ error: 'El título del evento es requerido.' });

        const newEvent = await pool.query(`
            INSERT INTO events (photographer_id, title, event_date, location, description, status, expires_at, selfie_required)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            RETURNING *
        `, [photographer_id, title, event_date || null, location || '', description || '', status || 'published', expires_at || null, selfie_required === true]);

        const event = newEvent.rows[0];

        // 📧 CORREO DE CONFIRMACIÓN (versión espectacular restaurada)
        try {
            const photographer = await pool.query('SELECT name, email FROM users WHERE id = $1', [photographer_id]);
            if (photographer.rows.length > 0) {
                const publicUrl = `${process.env.FRONTEND_URL || 'https://www.globalfotoapp.com'}/?galeria=${event.id}`;

                // Formatear datos para que se vean bonitos en el correo
                const fechaFormateada = event.event_date
                    ? new Date(event.event_date).toLocaleDateString('es-CO', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
                    : '';
                const estadoTexto = event.status === 'published' ? 'Publicada ✅' : (event.status === 'draft' ? 'Borrador (oculta) 📝' : 'Archivada 🗄️');
                const expiraTexto = event.expires_at ? new Date(event.expires_at).toLocaleString('es-CO', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';

                await resend.emails.send({
                    from: FROM_EMAIL,
                    to: photographer.rows[0].email,
                    subject: `📸 Evento creado: ${event.title}`,
                    html: `
                        <div style="font-family: 'Inter', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background: #f8fafc;">
                            <div style="background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%); padding: 30px; border-radius: 16px 16px 0 0; text-align: center;">
                                <h1 style="color: white; margin: 0; font-size: 28px;">📸 GlobalFoto</h1>
                                <p style="color: #94a3b8; margin: 8px 0 0; font-size: 14px;">Tu plataforma profesional de fotografía</p>
                            </div>
                            <div style="background: white; padding: 30px; border-radius: 0 0 16px 16px; border: 1px solid #e2e8f0; border-top: none;">
                                <h2 style="color: #0f172a; margin: 0 0 16px; font-size: 22px;">¡Evento creado exitosamente!</h2>
                                <p style="color: #475569; font-size: 15px; line-height: 1.6; margin: 0 0 20px;">
                                    Hola <strong>${photographer.rows[0].name}</strong>,<br>
                                    Tu nuevo evento ha sido registrado en la plataforma.
                                </p>

                                <div style="background: #f8fafc; padding: 20px; border-radius: 10px; margin: 0 0 20px; border-left: 4px solid #2563eb;">
                                    <h3 style="color: #0f172a; margin: 0 0 12px; font-size: 16px;">📋 Detalles del evento</h3>
                                    <p style="color: #475569; font-size: 14px; margin: 8px 0;"><strong>Título:</strong> ${event.title}</p>
                                    ${fechaFormateada ? `<p style="color: #475569; font-size: 14px; margin: 8px 0;"><strong>Fecha:</strong> ${fechaFormateada}</p>` : ''}
                                    ${event.location ? `<p style="color: #475569; font-size: 14px; margin: 8px 0;"><strong>Ubicación:</strong> ${event.location}</p>` : ''}
                                    <p style="color: #475569; font-size: 14px; margin: 8px 0;"><strong>Estado:</strong> ${estadoTexto}</p>
                                    ${expiraTexto ? `<p style="color: #92400e; font-size: 14px; margin: 8px 0;"><strong>⏰ Expira:</strong> ${expiraTexto}</p>` : ''}
                                </div>

                                <div style="background: #eff6ff; padding: 20px; border-radius: 10px; margin: 0 0 20px;">
                                    <h3 style="color: #0f172a; margin: 0 0 12px; font-size: 16px;">🔗 Tu enlace público</h3>
                                    <p style="color: #475569; font-size: 13px; margin: 0 0 12px;">Comparte este enlace con tus clientes para que vean y compren la galería:</p>
                                    <a href="${publicUrl}" style="background: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 14px; display: inline-block;">Ver Galería Pública</a>
                                </div>

                                <div style="background: #fffbeb; padding: 16px; border-radius: 10px; border-left: 4px solid #f59e0b;">
                                    <p style="color: #92400e; font-size: 13px; margin: 0;">
                                        <strong>💡 Siguiente paso:</strong> Sube tus fotos, crea paquetes promocionales y configura tus precios y Nequi para comenzar a vender.
                                    </p>
                                </div>

                                <p style="color: #64748b; font-size: 13px; text-align: center; margin: 24px 0 0; padding-top: 20px; border-top: 1px solid #e2e8f0;">
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

        res.status(201).json({ mensaje: 'Evento creado exitosamente.', event });
    } catch (error) {
        console.error('Error al crear evento:', error);
        res.status(500).json({ error: 'Error interno al crear el evento.' });
    }
});

// =====================================================
// ACTUALIZAR EVENTO (incluye estado y expiración)
// =====================================================
router.put('/:id', verificarToken, async (req, res) => {
    try {
        const { id } = req.params;
        const photographer_id = req.user.id;
        const { title, event_date, location, description, status, expires_at, selfie_required } = req.body;

        if (!isValidId(id)) return res.status(400).json({ error: 'ID de evento inválido.' });

        const eventCheck = await pool.query(
            'SELECT id FROM events WHERE id = $1 AND photographer_id = $2',
            [id, photographer_id]
        );
        if (eventCheck.rows.length === 0) return res.status(404).json({ error: 'Evento no encontrado o sin permisos.' });

        const updated = await pool.query(`
            UPDATE events SET 
                title = $1, event_date = $2, location = $3, description = $4, 
                status = $5, expires_at = $6, selfie_required = $7
            WHERE id = $8 RETURNING *
        `, [title, event_date, location, description, status || 'published', expires_at || null, selfie_required === true, id]);

        res.json({ mensaje: 'Evento actualizado.', event: updated.rows[0] });
    } catch (error) {
        console.error('Error al actualizar evento:', error);
        res.status(500).json({ error: 'Error interno al actualizar el evento.' });
    }
});

// =====================================================
// LISTAR EVENTOS DEL FOTÓGRAFO
// =====================================================
router.get('/', verificarToken, async (req, res) => {
    try {
        const photographer_id = req.user.id;
        const allEvents = await pool.query(`
            SELECT e.*, COUNT(p.id) as "photosCount"
            FROM events e LEFT JOIN photos p ON e.id = p.event_id
            WHERE e.photographer_id = $1
            GROUP BY e.id
            ORDER BY e.created_at DESC;
        `, [photographer_id]);

        res.json(allEvents.rows.map(ev => ({ ...ev, photosCount: parseInt(ev.photosCount, 10) || 0 })));
    } catch (error) {
        console.error('Error al obtener los eventos:', error);
        res.status(500).json({ error: 'Error interno al listar los eventos.' });
    }
});

// =====================================================
// CONFIGURAR PRECIOS
// =====================================================
router.put('/:id/pricing', verificarToken, async (req, res) => {
    try {
        const { id } = req.params;
        const photographer_id = req.user.id;
        const { 
            price_per_photo, price_full_gallery, currency = 'COP',
            nequi_phone, nequi_name, qr_code_url, sales_enabled 
        } = req.body;

        if (!isValidId(id)) return res.status(400).json({ error: 'ID de evento inválido.' });

        const eventCheck = await pool.query(
            'SELECT id FROM events WHERE id = $1 AND photographer_id = $2',
            [id, photographer_id]
        );
        if (eventCheck.rows.length === 0) return res.status(404).json({ error: 'Evento no encontrado o sin permisos.' });

        const photoPrice = parseFloat(price_per_photo) || 0;
        const galleryPrice = parseFloat(price_full_gallery) || 0;

        const updated = await pool.query(`
            UPDATE events SET 
                price_per_photo = $1, price_full_gallery = $2, currency = $3,
                nequi_phone = $4, nequi_name = $5, qr_code_url = $6, sales_enabled = $7
            WHERE id = $8 RETURNING *
        `, [photoPrice, galleryPrice, currency, nequi_phone || '', nequi_name || '', qr_code_url || '', sales_enabled === true, id]);

        res.json({ mensaje: 'Configuración de precios actualizada.', event: updated.rows[0] });
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

        if (!isValidId(id)) return res.status(400).json({ error: 'ID de evento inválido.' });

        const eventCheck = await pool.query(
            'SELECT id FROM events WHERE id = $1 AND photographer_id = $2',
            [id, photographer_id]
        );
        if (eventCheck.rows.length === 0) return res.status(404).json({ error: 'Evento no encontrado o sin permisos.' });

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
// GALERÍA PÚBLICA (con validación de estado/expiración + paquetes)
// =====================================================
router.get('/:id/public', async (req, res) => {
    try {
        const { id } = req.params;
        if (!isValidId(id)) return res.status(400).json({ error: 'ID de evento inválido.' });

        const eventResult = await pool.query('SELECT * FROM events WHERE id = $1', [id]);
        if (eventResult.rows.length === 0) return res.status(404).json({ error: 'El evento no existe.' });

        const event = eventResult.rows[0];

        if (event.status !== 'published') {
            return res.status(404).json({ error: 'Esta galería no está disponible en este momento.' });
        }
        if (event.expires_at && new Date(event.expires_at) < new Date()) {
            return res.status(404).json({ error: 'Esta galería ha expirado.' });
        }

        const photosResult = await pool.query(
            'SELECT id, preview_url, created_at FROM photos WHERE event_id = $1 ORDER BY created_at DESC', 
            [id]
        );

        const protectedPhotos = photosResult.rows.map(p => ({
            id: p.id,
            url: p.preview_url,
            created_at: p.created_at
        }));

        const packagesResult = await pool.query(
            'SELECT * FROM packages WHERE event_id = $1 AND is_active = true ORDER BY price ASC', 
            [id]
        );

        res.json({
            event: eventResult.rows[0],
            photos: protectedPhotos,
            packages: packagesResult.rows
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
        if (!isValidId(id)) return res.status(400).json({ error: 'ID de evento inválido.' });

        const eventResult = await pool.query('SELECT * FROM events WHERE id = $1', [id]);
        if (eventResult.rows.length === 0) return res.status(404).json({ error: 'El evento no existe.' });
        const event = eventResult.rows[0];

        const photosResult = await pool.query('SELECT * FROM photos WHERE event_id = $1', [id]);
        const photos = photosResult.rows;

        if (photos.length === 0) return res.status(400).json({ error: 'Este evento no contiene fotografías.' });

        const zipFileName = `${event.title.replace(/[^a-zA-Z0-9]/g, '_')}_GlobalFoto.zip`;
        res.attachment(zipFileName);

        const archive = archiver('zip', { zlib: { level: 9 } });
        archive.on('error', (err) => {
            console.error('Error al empaquetar ZIP:', err);
            if (!res.headersSent) res.status(500).json({ error: 'Error al generar el ZIP.' });
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
        if (!res.headersSent) res.status(500).json({ error: 'Error interno al generar la descarga.' });
    }
});

// =====================================================
// LISTAR FOTOS DE UN EVENTO (Protegido)
// =====================================================
router.get('/:id/photos', verificarToken, async (req, res) => {
    try {
        const { id } = req.params;
        const photographer_id = req.user.id;

        if (!isValidId(id)) return res.status(400).json({ error: 'ID de evento inválido.' });

        const eventCheck = await pool.query(
            'SELECT id FROM events WHERE id = $1 AND photographer_id = $2',
            [id, photographer_id]
        );
        if (eventCheck.rows.length === 0) return res.status(404).json({ error: 'Evento no encontrado o sin permisos.' });

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

// =====================================================
// ELIMINAR FOTO INDIVIDUAL
// =====================================================
router.delete('/photos/:photoId', verificarToken, async (req, res) => {
    try {
        const { photoId } = req.params;
        const photographer_id = req.user.id;

        if (!isValidId(photoId)) return res.status(400).json({ error: 'ID de foto inválido.' });

        const photoCheck = await pool.query(`
            SELECT p.*, e.photographer_id 
            FROM photos p JOIN events e ON p.event_id = e.id 
            WHERE p.id = $1 AND e.photographer_id = $2`, 
            [photoId, photographer_id]
        );
        if (photoCheck.rows.length === 0) return res.status(404).json({ error: 'Foto no encontrada o sin permisos.' });

        const photo = photoCheck.rows[0];

        try {
            if (photo.filename) {
                await s3Client.send(new DeleteObjectCommand({
                    Bucket: process.env.AWS_BUCKET_NAME,
                    Key: photo.filename
                }));
            }
            if (photo.preview_url) {
                const previewKey = photo.preview_url.split('.com/')[1];
                if (previewKey) {
                    await s3Client.send(new DeleteObjectCommand({
                        Bucket: process.env.AWS_BUCKET_NAME,
                        Key: previewKey
                    }));
                }
            }
        } catch (s3Error) {
            console.error('Error al eliminar archivos de S3:', s3Error);
        }

        await pool.query('DELETE FROM photos WHERE id = $1', [photoId]);
        res.json({ mensaje: 'Foto eliminada correctamente.' });
    } catch (error) {
        console.error('Error al eliminar foto:', error);
        res.status(500).json({ error: 'Error interno al eliminar la foto.' });
    }
});

// =====================================================
// GESTIÓN DE PAQUETES
// =====================================================
router.get('/:id/packages', verificarToken, async (req, res) => {
    try {
        const { id } = req.params;
        const photographer_id = req.user.id;
        const eventCheck = await pool.query(
            'SELECT id FROM events WHERE id = $1 AND photographer_id = $2', 
            [id, photographer_id]
        );
        if (eventCheck.rows.length === 0) return res.status(404).json({ error: 'Evento no encontrado.' });

        const packages = await pool.query(
            'SELECT * FROM packages WHERE event_id = $1 ORDER BY price ASC', [id]
        );
        res.json(packages.rows);
    } catch (error) {
        res.status(500).json({ error: 'Error al cargar paquetes.' });
    }
});

router.post('/:id/packages', verificarToken, async (req, res) => {
    try {
        const { id } = req.params;
        const { name, photo_limit, price } = req.body;
        const photographer_id = req.user.id;

        const eventCheck = await pool.query(
            'SELECT id FROM events WHERE id = $1 AND photographer_id = $2', 
            [id, photographer_id]
        );
        if (eventCheck.rows.length === 0) return res.status(404).json({ error: 'Evento no encontrado.' });

        const newPackage = await pool.query(
            'INSERT INTO packages (event_id, name, photo_limit, price) VALUES ($1, $2, $3, $4) RETURNING *',
            [id, name, photo_limit, price]
        );
        res.status(201).json({ mensaje: 'Paquete creado.', package: newPackage.rows[0] });
    } catch (error) {
        res.status(500).json({ error: 'Error al crear paquete.' });
    }
});

router.delete('/packages/:packageId', verificarToken, async (req, res) => {
    try {
        const { packageId } = req.params;
        const photographer_id = req.user.id;

        const pkgCheck = await pool.query(`
            SELECT p.id FROM packages p JOIN events e ON p.event_id = e.id 
            WHERE p.id = $1 AND e.photographer_id = $2`, 
            [packageId, photographer_id]
        );
        if (pkgCheck.rows.length === 0) return res.status(404).json({ error: 'Paquete no encontrado.' });

        await pool.query('DELETE FROM packages WHERE id = $1', [packageId]);
        res.json({ mensaje: 'Paquete eliminado.' });
    } catch (error) {
        res.status(500).json({ error: 'Error al eliminar paquete.' });
    }
});

module.exports = router;