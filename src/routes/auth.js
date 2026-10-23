const express = require('express');
const router = express.Router();
const pool = require('../db');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const verificarToken = require('../middleware/auth');

// Clave secreta estandarizada para toda la aplicación
const JWT_SECRET = process.env.JWT_SECRET || 'clave_secreta_globalfoto_2026';

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

        // Usamos la misma clave secreta estandarizada
        const token = jwt.sign(
            { id: user.id, email: user.email, role: user.role },
            JWT_SECRET,
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

// Ruta para el Registro
router.post('/register', async (req, res) => {
    try {
        const { name, email, password, role } = req.body;

        const userExists = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
        if (userExists.rows.length > 0) {
            return res.status(400).json({ error: 'El correo electrónico ya está registrado.' });
        }

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        const newUser = await pool.query(
            'INSERT INTO users (name, email, password, role) VALUES ($1, $2, $3, $4) RETURNING id, name, email, role',
            [name, email, hashedPassword, role || 'photographer']
        );

        res.status(201).json({
            mensaje: '¡Usuario registrado con éxito!',
            user: newUser.rows[0]
        });
    } catch (error) {
        console.error('Error en registro:', error);
        res.status(500).json({ error: 'Error interno en el servidor.' });
    }
});

// Ruta para validar token y mantener sesión activa al refrescar
router.get('/me', verificarToken, async (req, res) => {
    try {
        const userId = req.user?.id || req.usuario?.id;

        if (!userId) {
            return res.status(401).json({ error: 'No autorizado.' });
        }

        const userResult = await pool.query('SELECT id, name, email, role FROM users WHERE id = $1', [userId]);
        if (userResult.rows.length === 0) {
            return res.status(404).json({ error: 'Usuario no encontrado.' });
        }
        res.json({ user: userResult.rows[0] });
    } catch (error) {
        console.error('Error al validar sesión:', error);
        res.status(500).json({ error: 'Error interno del servidor.' });
    }
});

// Ruta para actualizar datos del perfil
router.put('/profile', verificarToken, async (req, res) => {
    try {
        const userId = req.user.id;
        const { name, email } = req.body;

        if (!name || !email) {
            return res.status(400).json({ error: 'El nombre y el correo son obligatorios.' });
        }

        // Verificar que el email no lo use otro usuario
        const emailExists = await pool.query('SELECT * FROM users WHERE email = $1 AND id <> $2', [email, userId]);
        if (emailExists.rows.length > 0) {
            return res.status(400).json({ error: 'Ese correo ya está en uso por otra cuenta.' });
        }

        const result = await pool.query(
            'UPDATE users SET name = $1, email = $2 WHERE id = $3 RETURNING id, name, email, role',
            [name, email, userId]
        );

        res.json({ mensaje: 'Perfil actualizado correctamente.', user: result.rows[0] });
    } catch (error) {
        console.error('Error al actualizar perfil:', error);
        res.status(500).json({ error: 'Error interno del servidor.' });
    }
});

// Ruta para cambiar la contraseña
router.put('/password', verificarToken, async (req, res) => {
    try {
        const userId = req.user.id;
        const { currentPassword, newPassword } = req.body;

        if (!currentPassword || !newPassword) {
            return res.status(400).json({ error: 'Debes proporcionar la contraseña actual y la nueva.' });
        }

        if (newPassword.length < 8) {
            return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 8 caracteres.' });
        }

        const userResult = await pool.query('SELECT * FROM users WHERE id = $1', [userId]);
        if (userResult.rows.length === 0) {
            return res.status(404).json({ error: 'Usuario no encontrado.' });
        }

        const validPassword = await bcrypt.compare(currentPassword, userResult.rows[0].password);
        if (!validPassword) {
            return res.status(400).json({ error: 'La contraseña actual no es correcta.' });
        }

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(newPassword, salt);

        await pool.query('UPDATE users SET password = $1 WHERE id = $2', [hashedPassword, userId]);

        res.json({ mensaje: 'Contraseña actualizada correctamente.' });
    } catch (error) {
        console.error('Error al cambiar contraseña:', error);
        res.status(500).json({ error: 'Error interno del servidor.' });
    }
});

module.exports = router;