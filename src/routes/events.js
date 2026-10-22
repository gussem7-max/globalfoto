const express = require('express');
const router = express.Router();
const pool = require('../db');
const verificarToken = require('../middleware/auth');
const archiver = require('archiver');
const { S3Client, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const axios = require('axios'); // Opcional si quieres descargar de S3 para el ZIP

// Inicializar cliente S3
const s3Client = new S3Client({
    region: process.env.AWS_REGION,
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    }
});

// Ruta para crear un nuevo evento (Protegida con verificarToken)
router.post('/', verificarToken, async (req, res) => {
    try {
        const { title, description, event_date, location } = req.body;
        
        // El ID del fotógrafo lo extraemos directamente del token verificado (req.user.id)
        const photographer_id = req.user.id;

        const newEvent = await pool.query(
            'INSERT INTO events (title, description, event_date, location, photographer_id) VALUES ($1, $2, $3, $4, $5) RETURNING *',
            [title, description, event_date, location, photographer_id]
        );

        res.status(201).json({
            mensaje: '¡Evento creado exitosamente!',
            event: newEvent.rows[0]
        });

    } catch (error) {
        console.error('Error al crear el evento:', error);
        res.status(500).json({ error: 'Error interno del servidor al crear el evento.' });
    }
});

// Ruta para listar todos los eventos (Pública para que los clientes puedan verlos)
router.get('/', async (req, res) => {
    try {
        const allEvents = await pool.query('SELECT * FROM events ORDER BY created_at DESC');
        res.json(allEvents.rows);
    } catch (error) {
        console.error('Error al obtener los eventos:', error);
        res.status(500).json({ error: 'Error interno al listar los eventos.' });
    }
});

// Ruta para eliminar un evento (Protegida)
router.delete('/:id', verificarToken, async (req, res) => {
    try {
        const { id } = req.params;

        // Buscar todas las fotos vinculadas a este evento en la base de datos
        const photosResult = await pool.query('SELECT * FROM photos WHERE event_id = $1', [id]);
        
        // Eliminar los archivos directamente del bucket de Amazon S3
        for (const photo of photosResult.rows) {
            try {
                const deleteParams = {
                    Bucket: process.env.AWS_BUCKET_NAME,
                    Key: photo.filename // Contiene la key de S3
                };
                await s3Client.send(new DeleteObjectCommand(deleteParams));
            } catch (s3Error) {
                console.error(`Error al eliminar archivo de S3 (${photo.filename}):`, s3Error);
            }
        }

        // Eliminar el evento de la BD (PostgreSQL eliminará en cascada las filas en photos si tiene ON DELETE CASCADE)
        await pool.query('DELETE FROM events WHERE id = $1', [id]);

        res.json({ mensaje: 'Evento y sus fotografías eliminados correctamente de la nube.' });
    } catch (error) {
        console.error('Error al eliminar evento:', error);
        res.status(500).json({ error: 'Error interno al eliminar el evento.' });
    }
});

// Ruta pública para ver un evento específico y sus fotos
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

// Ruta pública para descargar todas las fotos de un evento en un archivo ZIP desde S3
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

        // Descargar cada foto desde su URL pública de S3 y añadirla al ZIP
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