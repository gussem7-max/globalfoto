const express = require('express');
const router = express.Router();
const pool = require('../db');
const verificarToken = require('../middleware/auth');

// Obtener lista de usuarios registrados
router.get('/', verificarToken, async (req, res) => {
    try {
        // NOTA: Nunca seleccionamos la columna 'password' por seguridad
        const result = await pool.query(`
            SELECT id, name, email, role, created_at 
            FROM users 
            ORDER BY created_at DESC
        `);
        res.json(result.rows);
    } catch (error) {
        console.error('Error al obtener usuarios:', error);
        res.status(500).json({ error: 'Error interno al cargar usuarios.' });
    }
});

module.exports = router;