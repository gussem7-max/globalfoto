const express = require('express');
const router = express.Router();
const pool = require('../db');
const verificarToken = require('../middleware/auth');
const multer = require('multer');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const crypto = require('crypto');

const upload = multer({ 
    storage: multer.memoryStorage(),
    limits: { 
        fileSize: 25 * 1024 * 1024, // 25MB por foto
        files: 50
    },
    fileFilter: (req, file, cb) => {
        const allowedMimes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
        if (allowedMimes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Tipo de archivo no permitido. Solo JPEG, PNG o WebP.'), false);
        }
    }
});

const s3Client = new S3Client({
    region: process.env.AWS_REGION,
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    }
});

const isValidId = (id) => /^\d+$/.test(id) && parseInt(id) > 0;

router.post('/upload', verificarToken, upload.array('photos', 50), async (req, res) => {
    try {
        const { event_id } = req.body;
        const files = req.files;
        const photographer_id = req.user.id;

        console.log('📤 Iniciando subida de fotos...', files?.length, 'archivos');

        if (!files || files.length === 0) {
            return res.status(400).json({ error: 'No se han seleccionado archivos para subir.' });
        }

        if (!event_id || !isValidId(event_id)) {
            return res.status(400).json({ error: 'ID de evento inválido.' });
        }

        const eventCheck = await pool.query(
            'SELECT id FROM events WHERE id = $1 AND photographer_id = $2',
            [event_id, photographer_id]
        );

        if (eventCheck.rows.length === 0) {
            return res.status(404).json({ error: 'Evento no encontrado o sin permisos.' });
        }

        const uploadedPhotos = [];

        for (const file of files) {
            const uniqueId = crypto.randomBytes(16).toString('hex');
            const ext = file.mimetype === 'image/jpeg' ? 'jpg' : file.mimetype.split('/')[1];
            
            const originalFileName = `events/${event_id}/original/${uniqueId}.${ext}`;
            
            console.log(`⬆️ Subiendo ${file.originalname} a S3...`);
            
            await s3Client.send(new PutObjectCommand({
                Bucket: process.env.AWS_BUCKET_NAME,
                Key: originalFileName,
                Body: file.buffer,
                ContentType: file.mimetype,
                ServerSideEncryption: 'AES256'
            }));

            const originalUrl = `https://${process.env.AWS_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${originalFileName}`;

            // 🔑 CLAVE: preview_url = url (temporalmente, hasta arreglar sharp)
            const newPhoto = await pool.query(
                'INSERT INTO photos (event_id, url, filename, preview_url) VALUES ($1, $2, $3, $4) RETURNING *',
                [event_id, originalUrl, originalFileName, originalUrl]
            );

            uploadedPhotos.push(newPhoto.rows[0]);
            console.log(`✅ Foto ${file.originalname} subida exitosamente`);
        }

        res.status(201).json({
            mensaje: `¡${uploadedPhotos.length} fotografía(s) subida(s) exitosamente!`,
            photos: uploadedPhotos
        });

    } catch (error) {
        console.error('❌ Error al subir fotos a S3:', error);
        
        if (error instanceof multer.MulterError) {
            if (error.code === 'LIMIT_FILE_SIZE') {
                return res.status(400).json({ error: 'Archivo demasiado grande. Máximo 25MB por foto.' });
            }
            if (error.code === 'LIMIT_FILE_COUNT') {
                return res.status(400).json({ error: 'Demasiados archivos. Máximo 50 fotos por subida.' });
            }
        }

        res.status(500).json({ error: 'Error interno al subir las fotos.' });
    }
});

// Endpoint para listar fotos de un evento (protegido)
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