const express = require('express');
const router = express.Router();
const pool = require('../db');
const verificarToken = require('../middleware/auth');
const multer = require('multer');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const crypto = require('crypto');
const sharp = require('sharp');

const upload = multer({ 
    storage: multer.memoryStorage(),
    limits: { 
        fileSize: 25 * 1024 * 1024,
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

// Función para generar imagen con marca de agua
async function addWatermark(imageBuffer) {
    try {
        const watermarkText = 'GlobalFoto';
        
        // Crear SVG con la marca de agua
        const svgWatermark = `
            <svg width="800" height="200">
                <text 
                    x="50%" 
                    y="50%" 
                    font-family="Arial, sans-serif" 
                    font-size="60" 
                    font-weight="900" 
                    fill="rgba(255,255,255,0.5)" 
                    text-anchor="middle" 
                    dominant-baseline="middle"
                    transform="rotate(-30 400 100)"
                >${watermarkText}</text>
            </svg>
        `;

        const watermarkBuffer = Buffer.from(svgWatermark);

        // Aplicar marca de agua sobre la imagen
        const result = await sharp(imageBuffer)
            .resize(1200, 1200, { fit: 'inside', withoutEnlargement: true })
            .composite([{
                input: watermarkBuffer,
                gravity: 'center',
                tile: true
            }])
            .jpeg({ quality: 85 })
            .toBuffer();

        return result;
    } catch (error) {
        console.error('Error al agregar marca de agua:', error);
        return imageBuffer; // Retornar original si falla
    }
}

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

        const eventCheck = await pool.query(
            'SELECT id FROM events WHERE id = $1 AND photographer_id = $2',
            [event_id, photographer_id]
        );

        if (eventCheck.rows.length === 0) {
            return res.status(404).json({ error: 'Evento no encontrado o sin permisos.' });
        }

        const uploadedPhotos = [];

        for (const file of files) {
            if (!validateMagicBytes(file.buffer, file.mimetype)) {
                return res.status(400).json({ 
                    error: `El archivo ${file.originalname} no es una imagen válida.` 
                });
            }

            const uniqueId = crypto.randomBytes(16).toString('hex');
            const ext = file.mimetype === 'image/jpeg' ? 'jpg' : file.mimetype.split('/')[1];
            
            // Nombres de archivos
            const originalFileName = `events/${event_id}/original/${uniqueId}.${ext}`;
            const previewFileName = `events/${event_id}/preview/${uniqueId}.jpg`;

            // Subir versión ORIGINAL (sin comprimir)
            await s3Client.send(new PutObjectCommand({
                Bucket: process.env.AWS_BUCKET_NAME,
                Key: originalFileName,
                Body: file.buffer,
                ContentType: file.mimetype,
                ServerSideEncryption: 'AES256'
            }));

            // Generar y subir versión PREVIEW (con marca de agua)
            const previewBuffer = await addWatermark(file.buffer);
            await s3Client.send(new PutObjectCommand({
                Bucket: process.env.AWS_BUCKET_NAME,
                Key: previewFileName,
                Body: previewBuffer,
                ContentType: 'image/jpeg',
                ServerSideEncryption: 'AES256'
            }));

            const originalUrl = `https://${process.env.AWS_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${originalFileName}`;
            const previewUrl = `https://${process.env.AWS_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${previewFileName}`;

            const newPhoto = await pool.query(
                'INSERT INTO photos (event_id, url, filename, preview_url) VALUES ($1, $2, $3, $4) RETURNING *',
                [event_id, originalUrl, originalFileName, previewUrl]
            );

            uploadedPhotos.push(newPhoto.rows[0]);
        }

        res.status(201).json({
            mensaje: `¡${uploadedPhotos.length} fotografía(s) subida(s) en calidad original!`,
            photos: uploadedPhotos
        });

    } catch (error) {
        console.error('Error al subir fotos a S3:', error);
        
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

module.exports = router;