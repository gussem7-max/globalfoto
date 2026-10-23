const express = require('express');
const router = express.Router();
const pool = require('../db');
const verificarToken = require('../middleware/auth');
const multer = require('multer');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

// Configurar multer para almacenar temporalmente en memoria
const upload = multer({ storage: multer.memoryStorage() });

// Inicializar cliente S3
const s3Client = new S3Client({
    region: process.env.AWS_REGION,
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    }
});

// Ruta para subir fotos a S3 asociadas a un evento
router.post('/upload', verificarToken, upload.array('photos', 20), async (req, res) => {
    try {
        const { event_id } = req.body;
        const files = req.files;

        if (!files || files.length === 0) {
            return res.status(400).json({ error: 'No se han seleccionado archivos para subir.' });
        }

        if (!event_id) {
            return res.status(400).json({ error: 'El ID del evento es obligatorio.' });
        }

        const uploadedPhotos = [];

        for (const file of files) {
            const fileName = `events/${event_id}/${Date.now()}_${file.originalname.replace(/\s+/g, '_')}`;

            const uploadParams = {
                Bucket: process.env.AWS_BUCKET_NAME,
                Key: fileName,
                Body: file.buffer,
                ContentType: file.mimetype
            };

            await s3Client.send(new PutObjectCommand(uploadParams));

            // Generar URL pública del archivo en S3
            const fileUrl = `https://${process.env.AWS_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${fileName}`;

            // Guardar registro en la base de datos PostgreSQL
            const newPhoto = await pool.query(
                'INSERT INTO photos (event_id, url, filename) VALUES ($1, $2, $3) RETURNING *',
                [event_id, fileUrl, fileName]
            );

            uploadedPhotos.push(newPhoto.rows[0]);
        }

        res.status(201).json({
            mensaje: '¡Fotografías subidas exitosamente a la nube!',
            photos: uploadedPhotos
        });

    } catch (error) {
        console.error('Error detallado al subir fotos a S3:', error);
        res.status(500).json({ error: `Error al subir las fotos: ${error.message}` });
    }
});

module.exports = router;