const express = require('express');
const router = express.Router();
const pool = require('../db');
const verificarToken = require('../middleware/auth');
const archiver = require('archiver');
const { S3Client, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const axios = require('axios');

const s3Client = new S3Client({
    region: process.env.AWS_REGION,
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    }
});

// Validar que un ID sea número entero positivo
const isValidId = (id) => /^\d+$/.test(id) && parseInt(id) > 0;

// Crear evento (Protegido)
router.post('/', verificarToken, async (req, res) => {
    try {
        const { title, description, event_date, location } = req.body;
        
        if (!title || title.trim().length < 3) {
            return res.status(400).json({ error: 'El título debe tener al menos 3 caracteres.' });
        }
        if (!event_date) {
            return res.status(400).json({ error: 'La fecha del evento es obligatoria.' });
        }

        const photographer_id = req.user.id;
        const formattedDate = new Date(event_date).toISOString().split('T')[0];

        const newEvent = await pool.query(
            'INSERT INTO events (title, description, event_date, location, photographer_id) VALUES ($1, $2, $3, $4, $5) RETURNING *',
            [title.trim(), (description || '').trim(), formattedDate, (location || '').trim(), photographer_id]
        );

        res.status(201).json({
            mensaje: '¡Evento creado exitosamente!',
            event: newEvent.rows[0]
        });

    } catch (error) {
        console.error('Error al crear evento:', error);
        res.status(500).json({ error: 'Error interno al crear el evento.' });
    }
});

// Listar eventos SOLO del usuario autenticado (Protegido)
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

// Eliminar evento (Protegido + verificación de propiedad)
router.delete('/:id', verificarToken, async (req, res) => {
    try {
        const { id } = req.params;
        const photographer_id = req.user.id;

        if (!isValidId(id)) {
            return res.status(400).json({ error: 'ID de evento inválido.' });
        }

        // Verificar que el evento existe Y pertenece al usuario autenticado
        const eventCheck = await pool.query(
            'SELECT id FROM events WHERE id = $1 AND photographer_id = $2',
            [id, photographer_id]
        );

        if (eventCheck.rows.length === 0) {
            return res.status(404).json({ error: 'Evento no encontrado o sin permisos.' });
        }

        // Eliminar fotos de S3
        const photosResult = await pool.query('SELECT * FROM photos WHERE event_id = $1', [id]);
        
        for (const photo of photosResult.rows) {
            try {
                const deleteParams = {
                    Bucket: process.env.AWS_BUCKET_NAME,
                    Key: photo.filename
                };
                await s3Client.send(new DeleteObjectCommand(deleteParams));
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

// Galería pública (sin autenticación)
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

        const event = eventResult.rows[0];
        const photosResult = await pool.query('SELECT * FROM photos WHERE event_id = $1 ORDER BY created_at DESC', [id]);

        res.json({
            event: event,
            photos: photosResult.rows
        });
    } catch (error) {
        console.error('Error al obtener la galería pública:', error);
        res.status(500).json({ error: 'Error interno al cargar la galería.' });
    }
});

// Descarga ZIP (público, pero con validación)
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

module.exports = router;