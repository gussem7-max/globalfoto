const express = require('express');
const router = express.Router();
const pool = require('../db');
const upload = require('../middleware/upload');
const verificarToken = require('../middleware/auth');
const { S3Client, DeleteObjectCommand } = require('@aws-sdk/client-s3');

// Inicializar cliente S3 para la eliminación en la nube
const s3Client = new S3Client({
    region: process.env.AWS_REGION,
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    }
});

// Ruta para subir una foto asociada a un evento (Protegida)
router.post('/upload', verificarToken, upload.single('photo'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No se ha proporcionado ninguna imagen.' });
        }

        const { event_id } = req.body;
        if (!event_id) {
            return res.status(400).json({ error: 'Se requiere el ID del evento.' });
        }

        // Con multer-s3, obtenemos la URL pública y la key (ruta en el bucket)
        const url = req.file.location; 
        const filename = req.file.key; // Guardamos la key de S3 para poder borrarla después si es necesario

        // Guardar la referencia en la base de datos PostgreSQL
        const newPhoto = await pool.query(
            'INSERT INTO photos (event_id, filename, url) VALUES ($1, $2, $3) RETURNING *',
            [event_id, filename, url]
        );

        res.status(201).json({
            mensaje: '¡Foto subida exitosamente a Amazon S3!',
            photo: newPhoto.rows[0]
        });

    } catch (error) {
        console.error('Error al subir la foto:', error);
        res.status(500).json({ error: 'Error interno del servidor al subir la foto.' });
    }
});

// Ruta para listar las fotos de un evento específico
router.get('/event/:event_id', async (req, res) => {
    try {
        const { event_id } = req.params;
        const photos = await pool.query('SELECT * FROM photos WHERE event_id = $1 ORDER BY created_at DESC', [event_id]);
        res.json(photos.rows);
    } catch (error) {
        console.error('Error al obtener las fotos:', error);
        res.status(500).json({ error: 'Error interno al listar las fotos.' });
    }
});

// Ruta para eliminar una foto (Protegida)
router.delete('/:id', verificarToken, async (req, res) => {
    try {
        const { id } = req.params;

        // Buscar la foto en la base de datos
        const photoResult = await pool.query('SELECT * FROM photos WHERE id = $1', [id]);
        if (photoResult.rows.length === 0) {
            return res.status(404).json({ error: 'La fotografía no existe.' });
        }

        const photo = photoResult.rows[0];

        // Eliminar registro de la base de datos PostgreSQL
        await pool.query('DELETE FROM photos WHERE id = $1', [id]);

        // Eliminar el archivo físico directamente del bucket de Amazon S3
        const deleteParams = {
            Bucket: process.env.AWS_BUCKET_NAME,
            Key: photo.filename // Asumiendo que guardaste la key de S3 en la columna filename
        };

        await s3Client.send(new DeleteObjectCommand(deleteParams));

        res.json({ mensaje: 'Fotografía eliminada correctamente de Amazon S3.' });
    } catch (error) {
        console.error('Error al eliminar foto:', error);
        res.status(500).json({ error: 'Error interno al eliminar la fotografía.' });
    }
});

module.exports = router;