const express = require('express');
const router = express.Router();
const pool = require('../db');
const verificarToken = require('../middleware/auth');
const multer = require('multer');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const crypto = require('crypto');
const Jimp = require('jimp');

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

// Función para agregar marca de agua
async function addWatermark(imageBuffer) {
    try {
        const image = await Jimp.read(imageBuffer);
        
        // Redimensionar si es muy grande para ahorrar espacio y tiempo
        if (image.bitmap.width > 1200 || image.bitmap.height > 1200) {
            image.resize(1200, Jimp.AUTO);
        }

        // Cargar fuente
        const font = await Jimp.loadFont(Jimp.FONT_SANS_64_WHITE);

        // Crear una imagen transparente para la marca de agua
        const watermark = await new Promise((resolve, reject) => {
            new Jimp(image.bitmap.width, 200, 0x00000000, (err, img) => {
                if (err) reject(err);
                else resolve(img);
            });
        });

        // Escribir el texto
        watermark.print(font, 10, 50, {
            text: 'GlobalFoto',
            alignmentX: Jimp.HORIZONTAL_ALIGN_CENTER,
            alignmentY: Jimp.VERTICAL_ALIGN_MIDDLE
        }, image.bitmap.width - 20, 200);

        // Rotar y hacer semi-transparente
        watermark.rotate(-30);
        watermark.opacity(0.5);

        // Calcular posición centrada
        const x = (image.bitmap.width - watermark.bitmap.width) / 2;
        const y = (image.bitmap.height - watermark.bitmap.height) / 2;

        // Superponer
        image.composite(watermark, x, y);

        // Retornar buffer JPEG
        return await image.getBufferAsync(Jimp.MIME_JPEG);
    } catch (error) {
        console.error('️ Error al generar marca de agua:', error.message);
        return imageBuffer; // Si falla, devuelve la original para no romper la subida
    }
}

// =====================================================
// SUBIR FOTOS (CON MARCA DE AGUA AUTOMÁTICA)
// =====================================================
router.post('/upload', verificarToken, upload.array('photos', 50), async (req, res) => {
    try {
        const { event_id } = req.body;
        const files = req.files;
        const photographer_id = req.user.id;

        console.log('📤 Iniciando subida de', files?.length, 'fotos...');

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
            
            // Rutas en S3
            const originalFileName = `events/${event_id}/original/${uniqueId}.${ext}`;
            const previewFileName = `events/${event_id}/preview/${uniqueId}.jpg`;
            
            console.log(`⬆️ Subiendo original: ${file.originalname}`);
            
            // 1. Subir versión ORIGINAL a S3
            await s3Client.send(new PutObjectCommand({
                Bucket: process.env.AWS_BUCKET_NAME,
                Key: originalFileName,
                Body: file.buffer,
                ContentType: file.mimetype,
                ServerSideEncryption: 'AES256'
            }));

            // 2. Generar y subir versión PREVIEW (con marca de agua)
            console.log(`🎨 Generando marca de agua para: ${file.originalname}`);
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

            // 3. Guardar en la base de datos
            const newPhoto = await pool.query(
                'INSERT INTO photos (event_id, url, filename, preview_url) VALUES ($1, $2, $3, $4) RETURNING *',
                [event_id, originalUrl, originalFileName, previewUrl]
            );

            uploadedPhotos.push(newPhoto.rows[0]);
            console.log(`✅ Foto ${file.originalname} procesada y guardada.`);
        }

        res.status(201).json({
            mensaje: `¡${uploadedPhotos.length} fotografía(s) subida(s) con marca de agua!`,
            photos: uploadedPhotos
        });

    } catch (error) {
        console.error('❌ Error al subir fotos a S3:', error);
        
        if (error instanceof multer.MulterError) {
            if (error.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'Archivo demasiado grande. Máximo 25MB.' });
            if (error.code === 'LIMIT_FILE_COUNT') return res.status(400).json({ error: 'Demasiados archivos. Máximo 50.' });
        }

        res.status(500).json({ error: 'Error interno al subir las fotos.' });
    }
});

// =====================================================
// LISTAR FOTOS DE UN EVENTO (PARA EL PANEL DEL FOTÓGRAFO)
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

        if (eventCheck.rows.length === 0) return res.status(404).json({ error: 'Evento no encontrado.' });

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