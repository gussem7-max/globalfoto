const express = require('express');
const router = express.Router();
const pool = require('../db');
const verificarToken = require('../middleware/auth');
const multer = require('multer');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const sharp = require('sharp');
const crypto = require('crypto');

const upload = multer({ 
    storage: multer.memoryStorage(),
    limits: { 
        fileSize: 15 * 1024 * 1024, // 15MB por archivo
        files: 50 // máximo 50 archivos por petición
    },
    fileFilter: (req, file, cb) => {
        // Whitelist estricta de tipos MIME
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

// Validar magic bytes (firma real del archivo, no solo el mimetype)
const validateMagicBytes = (buffer, mimetype) => {
    const signatures = {
        'image/jpeg': ['FFD8FF'],
        'image/jpg': ['FFD8FF'],
        'image/png': ['89504E47'],
        'image/webp': ['52494646']
    };

    const hex = buffer.slice(0, 4).toString('hex').toUpperCase();
    const expectedSigs = signatures[mimetype] || [];
    
    return expectedSigs.some(sig => hex.startsWith(sig));
};

const isValidId = (id) => /^\d+$/.test(id) && parseInt(id) > 0;

// Subir fotos (Protegido + verificación de propiedad del evento)
router.post('/upload', verificarToken, upload.array('photos', 50), async (req, res) => {
    try {
        const { event_id } = req.body;
        const files = req.files;
        const photographer_id = req.user.id;

        if (!files || files.length === 0) {
            return res.status(400).json({ error: 'No se han seleccionado archivos para subir.' });
        }

        if (!event_id || !isValidId(event_id)) {
            return res.status(400).json({ error: 'ID de evento inválido.' });
        }

        // Verificar que el evento existe Y pertenece al usuario autenticado
        const eventCheck = await pool.query(
            'SELECT id FROM events WHERE id = $1 AND photographer_id = $2',
            [event_id, photographer_id]
        );

        if (eventCheck.rows.length === 0) {
            return res.status(404).json({ error: 'Evento no encontrado o sin permisos para subir fotos.' });
        }

        const uploadedPhotos = [];

        for (const file of files) {
            // Validar magic bytes
            if (!validateMagicBytes(file.buffer, file.mimetype)) {
                return res.status(400).json({ 
                    error: `El archivo ${file.originalname} no es una imagen válida o está corrupto.` 
                });
            }

            // Generar nombre único seguro (sin usar el nombre original)
            const uniqueId = crypto.randomBytes(16).toString('hex');
            const ext = file.mimetype.split('/')[1] === 'jpeg' ? 'jpg' : file.mimetype.split('/')[1];
            const fileName = `events/${event_id}/${uniqueId}.${ext}`;

            // Opcional: procesar imagen con sharp para optimizar (comprimir, redimensionar)
            let processedBuffer = file.buffer;
            try {
                processedBuffer = await sharp(file.buffer)
                    .resize(2400, 2400, { 
                        fit: 'inside', 
                        withoutEnlargement: true 
                    })
                    .jpeg({ quality: 85 })
                    .toBuffer();
            } catch (sharpError) {
                console.error('Error procesando imagen con Sharp, usando original:', sharpError.message);
                processedBuffer = file.buffer;
            }

            const uploadParams = {
                Bucket: process.env.AWS_BUCKET_NAME,
                Key: fileName,
                Body: processedBuffer,
                ContentType: 'image/jpeg',
                ServerSideEncryption: 'AES256'
            };

            await s3Client.send(new PutObjectCommand(uploadParams));

            const fileUrl = `https://${process.env.AWS_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${fileName}`;

            const newPhoto = await pool.query(
                'INSERT INTO photos (event_id, url, filename) VALUES ($1, $2, $3) RETURNING *',
                [event_id, fileUrl, fileName]
            );

            uploadedPhotos.push(newPhoto.rows[0]);
        }

        res.status(201).json({
            mensaje: `¡${uploadedPhotos.length} fotografía(s) subida(s) exitosamente!`,
            photos: uploadedPhotos
        });

    } catch (error) {
        console.error('Error al subir fotos a S3:', error);
        
        if (error instanceof multer.MulterError) {
            if (error.code === 'LIMIT_FILE_SIZE') {
                return res.status(400).json({ error: 'Archivo demasiado grande. Máximo 15MB por foto.' });
            }
            if (error.code === 'LIMIT_FILE_COUNT') {
                return res.status(400).json({ error: 'Demasiados archivos. Máximo 50 fotos por subida.' });
            }
        }

        res.status(500).json({ error: 'Error interno al subir las fotos.' });
    }
});

module.exports = router;