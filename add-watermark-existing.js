const pool = require('./src/db');
const { S3Client, GetObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');
const Jimp = require('jimp');
const https = require('https');

const s3Client = new S3Client({
    region: process.env.AWS_REGION,
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    }
});

function downloadImage(url) {
    return new Promise((resolve, reject) => {
        https.get(url, (response) => {
            const chunks = [];
            response.on('data', (chunk) => chunks.push(chunk));
            response.on('end', () => resolve(Buffer.concat(chunks)));
            response.on('error', reject);
        }).on('error', reject);
    });
}

async function addWatermark(imageBuffer) {
    try {
        const image = await Jimp.read(imageBuffer);
        
        if (image.getWidth() > 1200 || image.getHeight() > 1200) {
            image.resize(1200, Jimp.AUTO);
        }

        const watermark = await Jimp.create(800, 200, 0x00000000, (err, img) => {
            if (err) throw err;
            return img;
        });

        const font = await Jimp.loadFont(Jimp.FONT_SANS_64_WHITE);
        watermark.print(font, 100, 50, {
            text: 'GlobalFoto',
            alignmentX: Jimp.HORIZONTAL_ALIGN_CENTER,
            alignmentY: Jimp.VERTICAL_ALIGN_MIDDLE
        }, 800, 200);

        watermark.rotate(-30);
        watermark.opacity(0.5);

        const x = (image.getWidth() - watermark.getWidth()) / 2;
        const y = (image.getHeight() - watermark.getHeight()) / 2;

        image.composite(watermark, x, y);

        const buffer = await image.getBufferAsync(Jimp.MIME_JPEG);
        return buffer;

    } catch (error) {
        console.error('Error al agregar marca de agua:', error);
        return imageBuffer;
    }
}

async function processExistingPhotos() {
    console.log('🔄 Procesando fotos existentes...');
    
    try {
        const photosResult = await pool.query(`
            SELECT id, url, filename, event_id 
            FROM photos 
            WHERE preview_url = url OR preview_url IS NULL
        `);

        console.log(`📊 Encontradas ${photosResult.rows.length} fotos para procesar`);

        for (const photo of photosResult.rows) {
            try {
                console.log(` Procesando foto ${photo.id}...`);

                const originalBuffer = await downloadImage(photo.url);
                const previewBuffer = await addWatermark(originalBuffer);

                const previewFileName = photo.filename.replace('original/', 'preview/').replace(/\.\w+$/, '.jpg');
                
                await s3Client.send(new PutObjectCommand({
                    Bucket: process.env.AWS_BUCKET_NAME,
                    Key: previewFileName,
                    Body: previewBuffer,
                    ContentType: 'image/jpeg',
                    ServerSideEncryption: 'AES256'
                }));

                const previewUrl = `https://${process.env.AWS_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${previewFileName}`;

                await pool.query(
                    'UPDATE photos SET preview_url = $1 WHERE id = $2',
                    [previewUrl, photo.id]
                );

                console.log(`✅ Foto ${photo.id} procesada`);
            } catch (err) {
                console.error(`❌ Error procesando foto ${photo.id}:`, err.message);
            }
        }

        console.log('🎉 Proceso completado');
        process.exit(0);
    } catch (error) {
        console.error('Error fatal:', error);
        process.exit(1);
    }
}

processExistingPhotos();