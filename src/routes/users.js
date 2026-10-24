const express = require('express');
const router = express.Router();
const pool = require('../db');
const verificarToken = require('../middleware/auth');

// Middleware para verificar si es admin
const verificarAdmin = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader) return res.status(401).json({ error: 'No autorizado.' });

        const token = authHeader.split(' ')[1];
        const jwt = require('jsonwebtoken');
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'globalfoto_secret_key_2024');

        const userResult = await pool.query('SELECT role FROM users WHERE id = $1', [decoded.id]);
        if (userResult.rows.length === 0 || userResult.rows[0].role !== 'admin') {
            return res.status(403).json({ error: 'No tienes permisos de administrador.' });
        }

        req.adminId = decoded.id;
        next();
    } catch (error) {
        res.status(401).json({ error: 'Token inválido o expirado.' });
    }
};

// Obtener lista de usuarios (Solo admin)
router.get('/', verificarToken, verificarAdmin, async (req, res) => {
    try {
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

// Actualizar usuario (Solo admin)
router.put('/:id', verificarToken, verificarAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { name, email, role } = req.body;

        if (!name || !email || !role) {
            return res.status(400).json({ error: 'Faltan datos requeridos.' });
        }

        if (!['photographer', 'admin'].includes(role)) {
            return res.status(400).json({ error: 'Rol inválido.' });
        }

        // No permitir que el admin se elimine a sí mismo
        if (parseInt(id) === req.adminId) {
            return res.status(400).json({ error: 'No puedes modificar tu propio usuario desde aquí.' });
        }

        const updated = await pool.query(
            'UPDATE users SET name = $1, email = $2, role = $3 WHERE id = $4 RETURNING id, name, email, role',
            [name, email, role, id]
        );

        if (updated.rows.length === 0) {
            return res.status(404).json({ error: 'Usuario no encontrado.' });
        }

        res.json({ mensaje: 'Usuario actualizado exitosamente.', user: updated.rows[0] });
    } catch (error) {
        console.error('Error al actualizar usuario:', error);
        res.status(500).json({ error: 'Error interno al actualizar usuario.' });
    }
});

// Eliminar usuario (Solo admin)
router.delete('/:id', verificarToken, verificarAdmin, async (req, res) => {
    try {
        const { id } = req.params;

        // No permitir que el admin se elimine a sí mismo
        if (parseInt(id) === req.adminId) {
            return res.status(400).json({ error: 'No puedes eliminar tu propio usuario.' });
        }

        const result = await pool.query('DELETE FROM users WHERE id = $1 RETURNING id', [id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Usuario no encontrado.' });
        }

        res.json({ mensaje: 'Usuario eliminado exitosamente.' });
    } catch (error) {
        console.error('Error al eliminar usuario:', error);
        res.status(500).json({ error: 'Error interno al eliminar usuario.' });
    }
});

module.exports = router;