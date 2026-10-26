const express = require('express');
const router = express.Router();
const pool = require('../db');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { Resend } = require('resend');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const multer = require('multer');
const crypto = require('crypto');

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'notificaciones@globalfotoapp.com';
const JWT_SECRET = process.env.JWT_SECRET || 'globalfoto_secret_key_2024';

const s3Client = new S3Client({
    region: process.env.AWS_REGION,
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    }
});

// === Catálogo país → moneda/canal (ESPEJO de public/js/countries.js) ===
// Al agregar un país, agrégalo AQUÍ y en countries.js. La moneda se deriva del
// país en el servidor: el cliente nunca manda currency, solo country.
const USD_ZINLI = ['US','MX','AR','CL','PE','EC','BO','PY','UY','BR','PA','CR','DO','GT','HN','SV','NI','CU','PR','ES','IT','FR','DE','PT','GB','CA','AU'];
const COUNTRY_META = {
    VE: { currency: 'VES', channel: 'pagomovil' },
    CO: { currency: 'COP', channel: 'nequi' },
    XX: { currency: 'USD', channel: 'zinli' },
};
USD_ZINLI.forEach(iso => { COUNTRY_META[iso] = { currency: 'USD', channel: 'zinli' }; });

function verificarToken(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'No autorizado.' });
    try {
        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    } catch (e) {
        return res.status(401).json({ error: 'Token inválido.' });
    }
}

// REGISTRO
router.post('/register', async (req, res) => {
    try {
        const { name, email, password } = req.body;
        if (!name || !email || !password) return res.status(400).json({ error: 'Faltan datos requeridos.' });

        // País -> moneda derivada EN EL SERVIDOR (el cliente no manda currency)
        const countryRaw = String(req.body.country || '').toUpperCase().slice(0, 2);
        const country = Object.prototype.hasOwnProperty.call(COUNTRY_META, countryRaw) ? countryRaw : 'XX';
        const currency = COUNTRY_META[country].currency;

        // Teléfono: lo arma el front como "+57 300 123 4567"; lo normalizo y corto a 32
        const phoneRaw = typeof req.body.phone === 'string' ? req.body.phone.trim() : '';
        const phone = phoneRaw ? phoneRaw.slice(0, 32) : null;

        const existingUser = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
        if (existingUser.rows.length > 0) return res.status(400).json({ error: 'El correo electrónico ya está registrado.' });

        const hashedPassword = await bcrypt.hash(password, 10);

        // role FORZADO a photographer (el registro es solo de fotógrafos; ignora role del body)
        // plan_expires_at = hoy + 14 días de trial, coherente con los usuarios ya existentes
        const newUser = await pool.query(
            `INSERT INTO users (name, email, password, role, country, phone, currency, plan, plan_started_at, plan_expires_at)
             VALUES ($1, $2, $3, 'photographer', $4, $5, $6, 'trial', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP + INTERVAL '14 days')
             RETURNING id, name, email, role, country, phone, currency, plan, plan_started_at, plan_expires_at, created_at`,
            [name, email, hashedPassword, country, phone, currency]
        );
        const user = newUser.rows[0];

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
                            <p style="color: #475569; font-size: 15px; line-height: 1.6; margin-bottom: 20px;">Tu cuenta ha sido creada exitosamente.</p>
                            <div style="background: #f8fafc; padding: 20px; border-radius: 10px; margin-bottom: 20px; border-left: 4px solid #2563eb;">
                                <h3 style="color: #0f172a; margin: 0 0 10px 0; font-size: 16px;">¿Qué puedes hacer ahora?</h3>
                                <ul style="color: #475569; font-size: 14px; line-height: 1.8; margin: 0; padding-left: 20px;">
                                    <li>Crear eventos fotográficos</li>
                                    <li>Subir tus fotos con marca de agua automática</li>
                                    <li>Configurar precios y métodos de pago</li>
                                    <li>Compartir galerías públicas con tus clientes</li>
                                    <li>Recibir pedidos y aprobar pagos</li>
                                </ul>
                            </div>
                            <p style="color: #64748b; font-size: 13px; margin-bottom: 8px;">Tu periodo de prueba de 14 días comenzó hoy. Después podrás elegir un plan según tu país.</p>
                            <div style="text-align: center; margin: 24px 0;">
                                <a href="${process.env.FRONTEND_URL || 'https://www.globalfotoapp.com'}"
                                   style="background: #2563eb; color: white; padding: 14px 32px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 15px; display: inline-block;">
                                    Ir a mi Panel
                                </a>
                            </div>
                            <p style="color: #64748b; font-size: 13px; text-align: center; margin-top: 24px; padding-top: 20px; border-top: 1px solid #e2e8f0;">
                                Si tienes alguna duda, responde a este correo.
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
            user: {
                id: user.id, name: user.name, email: user.email, role: user.role,
                country: user.country, phone: user.phone, currency: user.currency,
                plan: user.plan, plan_expires_at: user.plan_expires_at
            }
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
        if (!email || !password) return res.status(400).json({ error: 'Faltan datos requeridos.' });

        const userResult = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
        if (userResult.rows.length === 0) return res.status(401).json({ error: 'Credenciales incorrectas.' });

        const user = userResult.rows[0];
        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) return res.status(401).json({ error: 'Credenciales incorrectas.' });

        const token = jwt.sign(
            { id: user.id, email: user.email, role: user.role },
            JWT_SECRET,
            { expiresIn: '7d' }
        );

        res.json({
            mensaje: 'Inicio de sesión exitoso.',
            token,
            user: { id: user.id, name: user.name, email: user.email, role: user.role, logo_url: user.logo_url, country: user.country, phone: user.phone, currency: user.currency, plan: user.plan, plan_started_at: user.plan_started_at, plan_expires_at: user.plan_expires_at }
        });
    } catch (error) {
        console.error('Error al iniciar sesión:', error);
        res.status(500).json({ error: 'Error interno al iniciar sesión.' });
    }
});

// OBTENER PERFIL ACTUAL
router.get('/me', verificarToken, async (req, res) => {
    try {
        const userResult = await pool.query('SELECT id, name, email, role, created_at, logo_url, country, phone, currency, plan, plan_started_at, plan_expires_at FROM users WHERE id = $1', [req.user.id]);
        if (userResult.rows.length === 0) return res.status(404).json({ error: 'Usuario no encontrado.' });
        res.json({ user: userResult.rows[0] });
    } catch (error) {
        console.error('Error al obtener perfil:', error);
        res.status(401).json({ error: 'Token inválido o expirado.' });
    }
});

// ACTUALIZAR PERFIL
router.put('/profile', verificarToken, async (req, res) => {
    try {
        const { name, email } = req.body;
        if (!name || !email) return res.status(400).json({ error: 'Faltan datos requeridos.' });

        const updatedUser = await pool.query(
            'UPDATE users SET name = $1, email = $2 WHERE id = $3 RETURNING id, name, email, role, logo_url',
            [name, email, req.user.id]
        );
        res.json({ mensaje: 'Perfil actualizado.', user: updatedUser.rows[0] });
    } catch (error) {
        console.error('Error al actualizar perfil:', error);
        res.status(500).json({ error: 'Error interno al actualizar el perfil.' });
    }
});

// ACTUALIZAR CONTRASEÑA
router.put('/password', verificarToken, async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;
        if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Faltan datos requeridos.' });

        const userResult = await pool.query('SELECT password FROM users WHERE id = $1', [req.user.id]);
        if (userResult.rows.length === 0) return res.status(404).json({ error: 'Usuario no encontrado.' });

        const validPassword = await bcrypt.compare(currentPassword, userResult.rows[0].password);
        if (!validPassword) return res.status(401).json({ error: 'La contraseña actual es incorrecta.' });

        const hashedPassword = await bcrypt.hash(newPassword, 10);
        await pool.query('UPDATE users SET password = $1 WHERE id = $2', [hashedPassword, req.user.id]);
        res.json({ mensaje: 'Contraseña actualizada exitosamente.' });
    } catch (error) {
        console.error('Error al actualizar contraseña:', error);
        res.status(500).json({ error: 'Error interno al actualizar la contraseña.' });
    }
});

// SUBIR LOGO DEL FOTÓGRAFO (con ACL pública)
router.put('/logo', verificarToken, uploadLogo.single('logo'), async (req, res) => {
    try {
        const file = req.file;
        if (!file) return res.status(400).json({ error: 'No se recibió archivo.' });
        if (!file.mimetype.startsWith('image/')) return res.status(400).json({ error: 'Solo se permiten imágenes.' });

        const ext = file.mimetype.split('/')[1] || 'png';
        const key = `logos/${req.user.id}/${crypto.randomBytes(16).toString('hex')}.${ext}`;
        
        //  CAMBIO CLAVE: ACL public-read para que el logo sea accesible desde el navegador
        await s3Client.send(new PutObjectCommand({
            Bucket: process.env.AWS_BUCKET_NAME,
            Key: key,
            Body: file.buffer,
            ContentType: file.mimetype
        }));
        const logoUrl = `https://${process.env.AWS_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`;

        await pool.query('UPDATE users SET logo_url = $1 WHERE id = $2', [logoUrl, req.user.id]);
        res.json({ mensaje: 'Logo actualizado.', logo_url: logoUrl });
    } catch (error) {
        console.error('Error subiendo logo:', error);
        res.status(500).json({ error: 'Error al subir el logo.' });
    }
});

module.exports = router;