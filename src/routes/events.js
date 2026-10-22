const express = require('express');
const router = express.Router();
const pool = require('../db');
const verificarToken = require('../middleware/auth');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

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

const fs = require('fs');
const path = require('path');

// Ruta para eliminar un evento (Protegida)
router.delete('/:id', verificarToken, async (req, res) => {
    try {
        const { id } = req.params;

        // Buscar todas las fotos vinculadas a este evento
        const photosResult = await pool.query('SELECT * FROM photos WHERE event_id = $1', [id]);
        
        // Eliminar los archivos físicos de la carpeta uploads
        photosResult.rows.forEach(photo => {
            const filePath = path.join(__dirname, '../../uploads', photo.filename);
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
        });

        // Eliminar el evento de la BD (PostgreSQL eliminará en cascada las filas en photos si usaste CASCADE)
        await pool.query('DELETE FROM events WHERE id = $1', [id]);

        res.json({ mensaje: 'Evento y sus fotografías eliminados correctamente.' });
    } catch (error) {
        console.error('Error al eliminar evento:', error);
        res.status(500).json({ error: 'Error interno al eliminar el evento.' });
    }
});

// Ruta pública para ver un evento específico y sus fotos (Ideal para el cliente final)
router.get('/:id/public', async (req, res) => {
    try {
        const { id } = req.params;

        // Buscar el evento
        const eventResult = await pool.query('SELECT * FROM events WHERE id = $1', [id]);
        if (eventResult.rows.length === 0) {
            return res.status(404).json({ error: 'El evento no existe.' });
        }

        const event = eventResult.rows[0];

        // Buscar las fotos asociadas a este evento
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

// Ruta pública para descargar todas las fotos de un evento en un archivo ZIP
router.get('/:id/download-zip', async (req, res) => {
    try {
        const { id } = req.params;

        // 1. Obtener información del evento
        const eventResult = await pool.query('SELECT * FROM events WHERE id = $1', [id]);
        if (eventResult.rows.length === 0) {
            return res.status(404).json({ error: 'El evento no existe.' });
        }
        const event = eventResult.rows[0];

        // 2. Obtener todas las fotos asociadas
        const photosResult = await pool.query('SELECT * FROM photos WHERE event_id = $1', [id]);
        const photos = photosResult.rows;

        if (photos.length === 0) {
            return res.status(400).json({ error: 'Este evento no contiene fotografías para descargar.' });
        }

        // 3. Configurar cabeceras de respuesta HTTP para la descarga del archivo ZIP
        const zipFileName = `${event.title.replace(/[^a-zA-Z0-9]/g, '_')}_GlobalFoto.zip`;
        res.attachment(zipFileName);

        // 4. Inicializar Archiver
        const archive = archiver('zip', { zlib: { level: 9 } });

        // Capturar errores en la transmisión del ZIP
        archive.on('error', (err) => {
            console.error('Error al empaquetar ZIP:', err);
            res.status(500).send({ error: 'Error al generar el archivo ZIP.' });
        });

        // Enlazar el flujo del ZIP a la respuesta HTTP del cliente
        archive.pipe(res);

        // 5. Agregar cada archivo de foto al paquete ZIP
        photos.forEach(photo => {
            const filePath = path.join(__dirname, '../../uploads', photo.filename);
            if (fs.existsSync(filePath)) {
                archive.file(filePath, { name: photo.original_name || photo.filename });
            }
        });

        // Finalizar el empaquetado y enviar al navegador
        await archive.finalize();

    } catch (error) {
        console.error('Error al procesar descarga ZIP:', error);
        res.status(500).json({ error: 'Error interno al generar la descarga masiva.' });
    }
});

module.exports = router;