const express = require('express');
const router = express.Router();
const pool = require('../db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const verificarToken = require('../middleware/auth');

// Clave secreta para firmar los tokens (en un entorno real va en el .env)
const JWT_SECRET = process.env.JWT_SECRET || 'clave_secreta_globalfoto_2026';

// Ruta para registrar un nuevo fotógrafo/usuario
router.post('/register', async (req, res) => {
    try {
        const { name, email, password, role } = req.body;

        // 1. Verificar si el usuario ya existe
        const userExists = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
        if (userExists.rows.length > 0) {
            return res.status(400).json({ error: 'El correo electrónico ya está registrado.' });
        }

        // 2. Encriptar la contraseña
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        // 3. Guardar el usuario en la base de datos
        const newUser = await pool.query(
            'INSERT INTO users (name, email, password, role) VALUES ($1, $2, $3, $4) RETURNING id, name, email, role, created_at',
            [name, email, hashedPassword, role || 'photographer']
        );

        res.status(201).json({
            mensaje: '¡Usuario registrado exitosamente!',
            user: newUser.rows[0]
        });

    } catch (error) {
        console.error('Error en el registro:', error);
        res.status(500).json({ error: 'Error interno del servidor al registrar el usuario.' });
    }
});

// Ruta para iniciar sesión (Login)
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        // 1. Verificar si el usuario existe
        const userQuery = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
        if (userQuery.rows.length === 0) {
            return res.status(400).json({ error: 'Correo o contraseña incorrectos.' });
        }

        const user = userQuery.rows[0];

        // 2. Validar la contraseña encriptada
        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) {
            return res.status(400).json({ error: 'Correo o contraseña incorrectos.' });
        }

        // 3. Generar el Token JWT (expira en 2 horas)
        const token = jwt.sign(
            { id: user.id, email: user.email, role: user.role },
            JWT_SECRET,
            { expiresIn: '2h' }
        );

        res.json({
            mensaje: '¡Inicio de sesión exitoso!',
            token,
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                role: user.role
            }
        });

    } catch (error) {
        console.error('Error en el login:', error);
        res.status(500).json({ error: 'Error interno del servidor al iniciar sesión.' });
    }
});

// Ruta para actualizar datos del perfil (Nombre y Correo)
router.put('/update-profile', verificarToken, async (req, res) => {
    try {
        const { name, email } = req.body;
        const userId = req.user.id;

        if (!name || !email) {
            return res.status(400).json({ error: 'El nombre y el correo son obligatorios.' });
        }

        const updatedUser = await pool.query(
            'UPDATE users SET name = $1, email = $2 WHERE id = $3 RETURNING id, name, email, role',
            [name, email, userId]
        );

        res.json({
            mensaje: '¡Perfil actualizado con éxito!',
            user: updatedUser.rows[0]
        });
    } catch (error) {
        console.error('Error al actualizar perfil:', error);
        res.status(500).json({ error: 'Error interno al actualizar el perfil.' });
    }
});

// Ruta para cambiar contraseña de forma segura
router.put('/change-password', verificarToken, async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;
        const userId = req.user.id;

        if (!currentPassword || !newPassword) {
            return res.status(400).json({ error: 'Debes proporcionar la contraseña actual y la nueva.' });
        }

        // Buscar al usuario
        const userResult = await pool.query('SELECT * FROM users WHERE id = $1', [userId]);
        if (userResult.rows.length === 0) {
            return res.status(404).json({ error: 'Usuario no encontrado.' });
        }

        const user = userResult.rows[0];

        // Verificar la contraseña actual
        const isMatch = await bcrypt.compare(currentPassword, user.password);
        if (!isMatch) {
            return res.status(400).json({ error: 'La contraseña actual es incorrecta.' });
        }

        // Encriptar la nueva contraseña
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(newPassword, salt);

        // Guardar en BD
        await pool.query('UPDATE users SET password = $1 WHERE id = $2', [hashedPassword, userId]);

        res.json({ mensaje: '¡Contraseña actualizada correctamente!' });
    } catch (error) {
        console.error('Error al cambiar contraseña:', error);
        res.status(500).json({ error: 'Error interno al actualizar la contraseña.' });
    }
});

module.exports = router;