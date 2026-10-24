const express = require('express');
const router = express.Router();
const pool = require('../db');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'notificaciones@globalfotoapp.com';

// REGISTRO
router.post('/register', async (req, res) => {
    try {
        const { name, email, password, role } = req.body;

        if (!name || !email || !password) {
            return res.status(400).json({ error: 'Faltan datos requeridos.' });
        }

        const existingUser = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
        if (existingUser.rows.length > 0) {
            return res.status(400).json({ error: 'El correo electrónico ya está registrado.' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = await pool.query(
            'INSERT INTO users (name, email, password, role) VALUES ($1, $2, $3, $4) RETURNING id, name, email, role, created_at',
            [name, email, hashedPassword, role || 'photographer']
        );

        const user = newUser.rows[0];

        //  ENVIAR CORREO DE BIENVENIDA
        try {
            await resend.emails.send({
                from: FROM_EMAIL,
                to: user.email,
                subject: '🎉 ¡Bienvenido a GlobalFoto!',
                html: `
                    <div style="font-family: 'Inter', sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                        <div style="background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%); padding: 30px; border-radius: 16px 16px 0 0; text-align: center;">
                            <h1 style="color: white; margin: 0; font-size: 28px;">📸 GlobalFoto</h1>
                            <p style="color: #94a3b8; margin-top: 8px; font-size: 14px;">Tu plataforma profesional de fotografía</p>
                        </div>
                        <div style="background: white; padding: 30px; border-radius: 0 0 16px 16px; border: 1px solid #e2e8f0; border-top: none;">
                            <h2 style="color: #0f172a; margin-bottom: 16px;">¡Hola ${user.name}!</h2>
                            <p style="color: #475569; font-size: 15px; line-height: 1.6; margin-bottom: 20px;">
                                Tu cuenta ha sido creada exitosamente. Ya puedes comenzar a gestionar tus eventos fotográficos, subir tus galerías y vender tus fotos a tus clientes.
                            </p>
                            <div style="background: #f8fafc; padding: 20px; border-radius: 10px; margin-bottom: 20px; border-left: 4px solid #2563eb;">
                                <h3 style="color: #0f172a; margin: 0 0 10px 0; font-size: 16px;"> ¿Qué puedes hacer ahora?</h3>
                                <ul style="color: #475569; font-size: 14px; line-height: 1.8; margin: 0; padding-left: 20px;">
                                    <li>Crear eventos fotográficos</li>
                                    <li>Subir tus fotos con marca de agua automática</li>
                                    <li>Configurar precios y métodos de pago (Nequi)</li>
                                    <li>Compartir galerías públicas con tus clientes</li>
                                    <li>Recibir pedidos y aprobar pagos</li>
                                </ul>
                            </div>
                            <div style="text-align: center; margin: 24px 0;">
                                <a href="${process.env.FRONTEND_URL || 'https://www.globalfotoapp.com'}" 
                                   style="background: #2563eb; color: white; padding: 14px 32px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 15px; display: inline-block;">
                                    Ir a mi Panel
                                </a>
                            </div>
                            <p style="color: #64748b; font-size: 13px; text-align: center; margin-top: 24px; padding-top: 20px; border-top: 1px solid #e2e8f0;">
                                Si tienes alguna duda, responde a este correo y te ayudaremos.
                            </p>
                        </div>
                    </div>
                `
            });
            console.log('✅ [EMAIL] Correo de bienvenida enviado a:', user.email);
        } catch (emailErr) {
            console.error('⚠️ [EMAIL] No se pudo enviar bienvenida:', emailErr.message);
        }

        res.status(201).json({
            mensaje: 'Usuario registrado exitosamente.',
            user: { id: user.id, name: user.name, email: user.email, role: user.role }
        });

    } catch (error) {
        console.error('Error al registrar usuario:', error);
        res.status(500).json({ error: 'Error interno al registrar el usuario.' });
    }
});

// LOGIN
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ error: 'Faltan datos requeridos.' });
        }

        const userResult = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
        if (userResult.rows.length === 0) {
            return res.status(401).json({ error: 'Credenciales incorrectas.' });
        }

        const user = userResult.rows[0];
        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) {
            return res.status(401).json({ error: 'Credenciales incorrectas.' });
        }

        const token = jwt.sign(
            { id: user.id, email: user.email, role: user.role },
            process.env.JWT_SECRET || 'globalfoto_secret_key_2024',
            { expiresIn: '7d' }
        );

        res.json({
            mensaje: 'Inicio de sesión exitoso.',
            token,
            user: { id: user.id, name: user.name, email: user.email, role: user.role }
        });

    } catch (error) {
        console.error('Error al iniciar sesión:', error);
        res.status(500).json({ error: 'Error interno al iniciar sesión.' });
    }
});

// OBTENER PERFIL ACTUAL
router.get('/me', async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader) return res.status(401).json({ error: 'No autorizado.' });

        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'globalfoto_secret_key_2024');

        const userResult = await pool.query('SELECT id, name, email, role, created_at FROM users WHERE id = $1', [decoded.id]);
        if (userResult.rows.length === 0) return res.status(404).json({ error: 'Usuario no encontrado.' });

        res.json({ user: userResult.rows[0] });
    } catch (error) {
        console.error('Error al obtener perfil:', error);
        res.status(401).json({ error: 'Token inválido o expirado.' });
    }
});

// ACTUALIZAR PERFIL
router.put('/profile', async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader) return res.status(401).json({ error: 'No autorizado.' });

        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'globalfoto_secret_key_2024');

        const { name, email } = req.body;
        if (!name || !email) return res.status(400).json({ error: 'Faltan datos requeridos.' });

        const updatedUser = await pool.query(
            'UPDATE users SET name = $1, email = $2 WHERE id = $3 RETURNING id, name, email, role',
            [name, email, decoded.id]
        );

        res.json({ mensaje: 'Perfil actualizado.', user: updatedUser.rows[0] });
    } catch (error) {
        console.error('Error al actualizar perfil:', error);
        res.status(500).json({ error: 'Error interno al actualizar el perfil.' });
    }
});

// ACTUALIZAR CONTRASEÑA
router.put('/password', async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader) return res.status(401).json({ error: 'No autorizado.' });

        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'globalfoto_secret_key_2024');

        const { currentPassword, newPassword } = req.body;
        if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Faltan datos requeridos.' });

        const userResult = await pool.query('SELECT password FROM users WHERE id = $1', [decoded.id]);
        if (userResult.rows.length === 0) return res.status(404).json({ error: 'Usuario no encontrado.' });

        const validPassword = await bcrypt.compare(currentPassword, userResult.rows[0].password);
        if (!validPassword) return res.status(401).json({ error: 'La contraseña actual es incorrecta.' });

        const hashedPassword = await bcrypt.hash(newPassword, 10);
        await pool.query('UPDATE users SET password = $1 WHERE id = $2', [hashedPassword, decoded.id]);

        res.json({ mensaje: 'Contraseña actualizada exitosamente.' });
    } catch (error) {
        console.error('Error al actualizar contraseña:', error);
        res.status(500).json({ error: 'Error interno al actualizar la contraseña.' });
    }
});

module.exports = router;