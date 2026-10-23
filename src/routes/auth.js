const express = require('express');
const router = express.Router();
const pool = require('../db');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const verificarToken = require('../middleware/auth');

// Ruta para el Login
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const userResult = await pool.query('SELECT * FROM users WHERE email = $1', [email]);

        if (userResult.rows.length === 0) {
            return res.status(400).json({ error: 'Credenciales inválidas.' });
        }

        const user = userResult.rows[0];
        const validPassword = await bcrypt.compare(password, user.password);

        if (!validPassword) {
            return res.status(400).json({ error: 'Credenciales inválidas.' });
        }

        const token = jwt.sign(
            { id: user.id, email: user.email, role: user.role },
            process.env.JWT_SECRET || 'secreto_super_seguro',
            { expiresIn: '7d' }
        );

        res.json({
            mensaje: '¡Inicio de sesión exitoso!',
            token,
            user: { id: user.id, name: user.name, email: user.email, role: user.role }
        });
    } catch (error) {
        console.error('Error en login:', error);
        res.status(500).json({ error: 'Error interno en el servidor.' });
    }
});

// NUEVA RUTA: Validar token y mantener sesión activa al refrescar
router.get('/me', verificarToken, async (req, res) => {
    try {
        const userResult = await pool.query('SELECT id, name, email, role FROM users WHERE id = $1', [req.user.id]);
        if (userResult.rows.length === 0) {
            return res.status(404).json({ error: 'Usuario no encontrado.' });
        }
        res.json({ user: userResult.rows[0] });
    } catch (error) {
        console.error('Error al validar sesión:', error);
        res.status(500).json({ error: 'Error interno del servidor.' });
    }
});

module.exports = router;