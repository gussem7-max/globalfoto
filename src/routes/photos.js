const express = require('express');
const router = express.Router();
const pool = require('../db');
const verificarToken = require('../middleware/auth');
const multer = require('multer');
const { S3Client, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const sharp = require('sharp');
const crypto = require('crypto');
const { getUserPlanLimits } = require('../lib/subscription');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const s3Client = new S3Client({
    region: process.env.AWS_REGION,
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    }
});

// SUBIR FOTOS (con ACL pública + enforcement de límites de plan)
router.post('/upload', verificarToken, upload.array('photos', 50), async (req, res) => {
    try {
        const { event_id } = req.body;
        const files = req.files;
        const photographer_id = req.user.id;

        if (!event_id || !files || files.length === 0) {
            return res.status(400).json({ error: 'Faltan datos o archivos.' });
        }

        const eventCheck = await pool.query(
            'SELECT id FROM events WHERE id = $1 AND photographer_id = $2',
            [event_id, photographer_id]
        );
        if (eventCheck.rows.length === 0) return res.status(404).json({ error: 'Evento no encontrado.' });

        // === ENFORCEMENT DE LÍMITES (fotos): cuenta TODAS las fotos del fotógrafo, antes de subir a S3 ===
        const limitInfo = await getUserPlanLimits(photographer_id);
        if (limitInfo.maxFotos !== null) {
            const cnt = await pool.query(
                'SELECT COUNT(*)::int AS n FROM photos p JOIN events e ON p.event_id = e.id WHERE e.photographer_id = $1',
                [photographer_id]
            );
            const current = cnt.rows[0].n;
            const remaining = limitInfo.maxFotos - current;

            if (remaining <= 0) {
                const msg = 'Tu plan ' + limitInfo.planLabel + ' permite hasta ' + limitInfo.maxFotos + ' fotos y ya llegaste al límite (' + current + ' subidas). Elimina fotos o mejora tu plan para subir más.';
                return res.status(403).json({ error: msg });
            }
            if (files.length > remaining) {
                const msg = 'Tu plan ' + limitInfo.planLabel + ' permite hasta ' + limitInfo.maxFotos + ' fotos: ya tienes ' + current + ' y te quedan ' + remaining + ' espacios, pero estás intentando subir ' + files.length + '. Sube menos archivos o mejora tu plan.';
                return res.status(403).json({ error: msg });
            }
        }

        const uploadedPhotos = [];
        for (const file of files) {
            const originalName = file.originalname.replace(/\.[^/.]+$/, '');
            const ext = file.mimetype.split('/')[1] || 'jpg';
            const uniqueId = crypto.randomBytes(16).toString('hex');
            
            // Ruta original
            const originalKey = `events/${event_id}/original/${uniqueId}.${ext}`;
            // Ruta preview (con marca de agua)
            const previewKey = `events/${event_id}/preview/${uniqueId}.jpg`;

            // Subir original con ACL pública
            await s3Client.send(new PutObjectCommand({
                Bucket: process.env.AWS_BUCKET_NAME,
                Key: originalKey,
                Body: file.buffer,
                ContentType: file.mimetype,
                ACL: 'public-read'  // 🔑 CLAVE: hacer público
            }));
            const originalUrl = `https://${process.env.AWS_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${originalKey}`;

            // Generar preview con marca de agua
            let previewBuffer = await sharp(file.buffer)
                .resize(800, 800, { fit: 'inside' })
                .jpeg({ quality: 80 })
                .toBuffer();

            // Agregar marca de agua
            previewBuffer = await sharp(previewBuffer)
                .composite([{
                    input: Buffer.from(`<svg width="400" height="100"><text x="50%" y="50%" font-family="Arial" font-size="32" font-weight="bold" fill="rgba(255,255,255,0.5)" text-anchor="middle" dominant-baseline="middle" transform="rotate(-30 200 50)">GlobalFoto</text></svg>`),
                    top: 0,
                    left: 0
                }])
                .toBuffer();

            // Subir preview con ACL pública
            await s3Client.send(new PutObjectCommand({
                Bucket: process.env.AWS_BUCKET_NAME,
                Key: previewKey,
                Body: previewBuffer,
                ContentType: 'image/jpeg',
                ACL: 'public-read'  // 🔑 CLAVE: hacer público
            }));
            const previewUrl = `https://${process.env.AWS_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${previewKey}`;

            // Guardar en base de datos
            const photoResult = await pool.query(
                'INSERT INTO photos (event_id, filename, url, preview_url) VALUES ($1, $2, $3, $4) RETURNING id',
                [event_id, originalKey, originalUrl, previewUrl]
            );

            uploadedPhotos.push({
                id: photoResult.rows[0].id,
                url: originalUrl,
                preview_url: previewUrl
            });
        }

        res.json({
            mensaje: `${uploadedPhotos.length} foto(s) subida(s) exitosamente.`,
            photos: uploadedPhotos
        });
    } catch (error) {
        console.error('Error al subir fotos:', error);
        res.status(500).json({ error: 'Error interno al subir las fotos.' });
    }
});

// ELIMINAR FOTO
router.delete('/:id', verificarToken, async (req, res) => {
    try {
        const { id } = req.params;
        const photographer_id = req.user.id;

        const photoCheck = await pool.query(`
            SELECT p.*, e.photographer_id 
            FROM photos p JOIN events e ON p.event_id = e.id 
            WHERE p.id = $1 AND e.photographer_id = $2`,
            [id, photographer_id]
        );
        if (photoCheck.rows.length === 0) return res.status(404).json({ error: 'Foto no encontrada.' });

        const photo = photoCheck.rows[0];

        // Eliminar de S3
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
            console.error('Error al eliminar de S3:', s3Error);
        }

        await pool.query('DELETE FROM photos WHERE id = $1', [id]);
        res.json({ mensaje: 'Foto eliminada.' });
    } catch (error) {
        console.error('Error al eliminar foto:', error);
        res.status(500).json({ error: 'Error interno al eliminar la foto.' });
    }
});

module.exports = router;