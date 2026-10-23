const express = require('express');
const router = express.Router();
const pool = require('../db');
const verificarToken = require('../middleware/auth');
const archiver = require('archiver');
const { S3Client, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const axios = require('axios');

// Inicializar cliente S3
const s3Client = new S3Client({
    region: process.env.AWS_REGION,
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    }
});

// Ruta para crear un nuevo evento (Protegida)
router.post('/', verificarToken, async (req, res) => {
    try {
        const { title, description, event_date, location } = req.body;
        
        if (!title || !event_date) {
            return res.status(400).json({ error: 'El título y la fecha del evento son obligatorios.' });
        }

        const photographer_id = req.user.id;

        // Limpiar la fecha asegurando formato AAAA-MM-DD
        const formattedDate = new Date(event_date).toISOString().split('T')[0];

        const newEvent = await pool.query(
            'INSERT INTO events (title, description, event_date, location, photographer_id) VALUES ($1, $2, $3, $4, $5) RETURNING *',
            [title, description || '', formattedDate, location || '', photographer_id]
        );

        res.status(201).json({
            mensaje: '¡Evento creado exitosamente!',
            event: newEvent.rows[0]
        });

    } catch (error) {
        // Imprimir el error exacto en la consola del servidor (Logs de Render)
        console.error('Error detallado de PostgreSQL:', error);
        
        // Devolver el mensaje real de la base de datos para diagnosticar en pantalla
        res.status(500).json({ 
            error: `Error en BD: ${error.message || 'Error interno al crear el evento.'}` 
        });
    }
});

// Ruta para listar todos los eventos (Actualizada con conteo de fotos)
router.get('/', async (req, res) => {
    try {
        const query = `
            SELECT e.*, COUNT(p.id) as "photosCount"
            FROM events e
            LEFT JOIN photos p ON e.id = p.event_id
            GROUP BY e.id
            ORDER BY e.created_at DESC;
        `;
        const allEvents = await pool.query(query);
        
        // Asegurarnos de que photosCount sea un número entero
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

// Ruta para eliminar un evento
router.delete('/:id', verificarToken, async (req, res) => {
    try {
        const { id } = req.params;

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

        res.json({ mensaje: 'Evento y sus fotografías eliminados correctamente de la nube.' });
    } catch (error) {
        console.error('Error al eliminar evento:', error);
        res.status(500).json({ error: 'Error interno al eliminar el evento.' });
    }
});

// Ruta pública para ver un evento específico
router.get('/:id/public', async (req, res) => {
    try {
        const { id } = req.params;

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

// Ruta pública para descargar ZIP
router.get('/:id/download-zip', async (req, res) => {
    try {
        const { id } = req.params;

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
                res.status(500).send({ error: 'Error al generar el archivo ZIP.' });
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