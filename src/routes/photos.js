const express = require('express');
const router = express.Router();
const pool = require('../db');
const upload = require('../middleware/upload');
const verificarToken = require('../middleware/auth');

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

        const filename = req.file.filename;
        const url = `/uploads/${filename}`;

        // Guardar la referencia en la base de datos
        const newPhoto = await pool.query(
            'INSERT INTO photos (event_id, filename, url) VALUES ($1, $2, $3) RETURNING *',
            [event_id, filename, url]
        );

        res.status(201).json({
            mensaje: '¡Foto subida exitosamente!',
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

const fs = require('fs');
const path = require('path');

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
        const filePath = path.join(__dirname, '../../uploads', photo.filename);

        // Eliminar registro de la base de datos
        await pool.query('DELETE FROM photos WHERE id = $1', [id]);

        // Eliminar archivo físico de la carpeta /uploads si existe
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }

        res.json({ mensaje: 'Fotografía eliminada correctamente.' });
    } catch (error) {
        console.error('Error al eliminar foto:', error);
        res.status(500).json({ error: 'Error interno al eliminar la fotografía.' });
    }
});

module.exports = router;