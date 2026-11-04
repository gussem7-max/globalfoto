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

const uploadLogo = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 } });

// === Catálogo país → moneda/canal ===
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

        const countryRaw = String(req.body.country || '').toUpperCase().slice(0, 2);
        const country = Object.prototype.hasOwnProperty.call(COUNTRY_META, countryRaw) ? countryRaw : 'XX';
        const currency = COUNTRY_META[country].currency;

        const phoneRaw = typeof req.body.phone === 'string' ? req.body.phone.trim() : '';
        const phone = phoneRaw ? phoneRaw.slice(0, 32) : null;

        // === Plan elegido desde la landing ===
        // 'basic'|'pro'|'studio' -> prueba de ESE plan (is_trial = true, 14 días).
        // 'free' o ausente/inválido -> prueba genérica (plan = 'trial', is_trial = false).
        const PAID_TRIAL_PLANS = ['basic', 'pro', 'studio'];
        const requestedPlan = String(req.body.plan || '').toLowerCase();
        const isPaidTrial = PAID_TRIAL_PLANS.includes(requestedPlan);
        const planValue = isPaidTrial ? requestedPlan : 'trial';
        const isTrialFlag = isPaidTrial;

        const existingUser = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
        if (existingUser.rows.length > 0) return res.status(400).json({ error: 'El correo electrónico ya está registrado.' });

        const hashedPassword = await bcrypt.hash(password, 10);

        const newUser = await pool.query(
            `INSERT INTO users (name, email, password, role, country, phone, currency, plan, is_trial, plan_started_at, plan_expires_at)
             VALUES ($1, $2, $3, 'photographer', $4, $5, $6, $7, $8, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP + INTERVAL '14 days')
             RETURNING id, name, email, role, country, phone, currency, plan, is_trial, auto_renew, plan_started_at, plan_expires_at, created_at`,
            [name, email, hashedPassword, country, phone, currency, planValue, isTrialFlag]
        );
        const user = newUser.rows[0];

        const planLabel = isPaidTrial ? planValue.toUpperCase() : null;
        const trialLine = isPaidTrial
            ? `Tu periodo de prueba de 14 días del plan <strong>${planLabel}</strong> comenzó hoy. Al terminar, elige un plan de pago para no perder el acceso.`
            : `Tu periodo de prueba de 14 días comenzó hoy. Después podrás elegir un plan según tu país.`;

        try {
            await resend.emails.send({
                from: FROM_EMAIL,
                to: user.email,
                subject: isPaidTrial ? `🎉 ¡Bienvenido a GlobalFoto! Probando el plan ${planLabel}` : '🎉 ¡Bienvenido a GlobalFoto!',
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
                            <p style="color: #64748b; font-size: 13px; margin-bottom: 8px;">${trialLine}</p>
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

        // === AUTO-LOGIN: devolvemos token igual que /login ===
        const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '7d' });

        res.status(201).json({
            mensaje: 'Usuario registrado exitosamente.',
            token,
            user: {
                id: user.id, name: user.name, email: user.email, role: user.role,
                country: user.country, phone: user.phone, currency: user.currency,
                plan: user.plan, is_trial: !!user.is_trial, auto_renew: user.auto_renew !== false,
                plan_started_at: user.plan_started_at, plan_expires_at: user.plan_expires_at
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
            user: {
                id: user.id, name: user.name, email: user.email, role: user.role,
                logo_url: user.logo_url, country: user.country, phone: user.phone,
                currency: user.currency, plan: user.plan,
                plan_started_at: user.plan_started_at, plan_expires_at: user.plan_expires_at,
                auto_renew: user.auto_renew !== false, is_trial: !!user.is_trial
            }
        });
    } catch (error) {
        console.error('Error al iniciar sesión:', error);
        res.status(500).json({ error: 'Error interno al iniciar sesión.' });
    }
});

// OBTENER PERFIL ACTUAL
router.get('/me', verificarToken, async (req, res) => {
    try {
        const userResult = await pool.query(
            'SELECT id, name, email, role, created_at, logo_url, country, phone, currency, plan, plan_started_at, plan_expires_at, auto_renew, is_trial FROM users WHERE id = $1',            [req.user.id]
        );
        if (userResult.rows.length === 0) return res.status(404).json({ error: 'Usuario no encontrado.' });
        res.json({ user: userResult.rows[0] });
    } catch (error) {
        console.error('Error al obtener perfil:', error);
        res.status(500).json({ error: 'Error interno al obtener perfil.' });
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

// SUBIR LOGO DEL FOTÓGRAFO
router.put('/logo', verificarToken, uploadLogo.single('logo'), async (req, res) => {
    try {
        const file = req.file;
        if (!file) return res.status(400).json({ error: 'No se recibió archivo.' });
        if (!file.mimetype.startsWith('image/')) return res.status(400).json({ error: 'Solo se permiten imágenes.' });

        const ext = file.mimetype.split('/')[1] || 'png';
        const key = `logos/${req.user.id}/${crypto.randomBytes(16).toString('hex')}.${ext}`;
        
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

// =====================================================
// RECUPERACIÓN DE CONTRASEÑA
// =====================================================

/** Genera un token criptográfico seguro (URL-safe base64). */
function generateResetToken() {
    return crypto.randomBytes(32).toString('base64url'); // ~43 chars, sin padding problemático
}

/** Envía email con enlace de reset usando Resend. */
async function sendResetEmail(userEmail, userName, resetUrl) {
    await resend.emails.send({
        from: FROM_EMAIL,
        to: userEmail,
        subject: '🔐 Restablece tu contraseña en GlobalFoto',
        html: `
            <div style="font-family:'Inter',Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
                <div style="background:linear-gradient(135deg,#0f172a 0%,#1e293b 100%);padding:30px;border-radius:16px 16px 0 0;text-align:center;">
                    <h1 style="color:white;margin:0;font-size:28px;">📸 GlobalFoto</h1>
                    <p style="color:#94a3b8;margin-top:8px;font-size:14px;">Tu plataforma profesional de fotografía</p>
                </div>
                <div style="background:white;padding:30px;border-radius:0 0 16px 16px;border:1px solid #e2e8f0;border-top:none;">
                    <h2 style="color:#0f172a;margin-bottom:16px;">Hola ${userName},</h2>
                    <p style="color:#475569;font-size:15px;line-height:1.6;margin-bottom:20px;">
                        Recibimos una solicitud para restablecer tu contraseña. Si fuiste tú, haz clic en el botón de abajo. 
                        Este enlace vence en <strong>1 hora</strong>.
                    </p>
                    <div style="text-align:center;margin:24px 0;">
                        <a href="${resetUrl}" 
                           style="display:inline-block;background:#ffffff;color:#0f172a;padding:14px 32px;text-decoration:none;border-radius:8px;font-weight:700;font-size:15px;box-shadow:0 4px 14px rgba(0,0,0,0.15);">
                            Restablecer mi contraseña
                        </a>
                    </div>
                    <p style="color:#64748b;font-size:13px;margin-bottom:8px;">Si no ves el botón, copia y pega este enlace en tu navegador:</p>
                    <p style="color:#2563eb;font-size:13px;word-break:break-all;margin-bottom:20px;">${resetUrl}</p>
                    <div style="background:#fef3c7;padding:16px;border-radius:10px;border-left:4px solid #f59e0b;">
                        <p style="color:#92400e;font-size:13px;margin:0;">
                            ⚠️ <strong>No compartas este enlace.</strong> Quien lo tenga podrá cambiar tu contraseña durante la próxima hora.
                        </p>
                    </div>
                    <p style="color:#64748b;font-size:13px;text-align:center;margin-top:24px;padding-top:20px;border-top:1px solid #e2e8f0;">
                        ¿No solicitaste esto? Ignora este correo. Tu contraseña seguirá siendo la misma.<br>
                        GlobalFoto - Tu plataforma profesional de fotografía
                    </p>
                </div>
            </div>
        `
    });
}

// POST /api/auth/forgot-password — Solicita reset (envía email si el usuario existe)
router.post('/forgot-password', async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) return res.status(400).json({ error: 'El correo electrónico es requerido.' });

        // Buscamos al usuario SIN revelar si existe o no (anti-enumeración)
        const userResult = await pool.query('SELECT id, name, email FROM users WHERE email = $1', [email]);
        
        // Siempre respondemos igual (200 OK), aunque el email no exista
        const genericMsg = 'Si el correo está registrado, recibirás instrucciones para restablecer tu contraseña en los próximos minutos.';

        if (userResult.rows.length === 0) {
            // Usuario no encontrado: NO revelamos nada, solo devolvemos mensaje genérico
            return res.json({ mensaje: genericMsg });
        }

        const user = userResult.rows[0];
        const token = generateResetToken();
        const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hora

        // Invalidamos resets anteriores pendientes del mismo usuario (solo uno activo)
        await pool.query(
            'UPDATE password_resets SET used = TRUE WHERE user_id = $1 AND used = FALSE',
            [user.id]
        );

        // Insertamos el nuevo token
        await pool.query(
            'INSERT INTO password_resets (user_id, token, expires_at) VALUES ($1, $2, $3)',
            [user.id, token, expiresAt]
        );

        // Construimos la URL absoluta del frontend
        const baseUrl = process.env.FRONTEND_URL || 'https://www.globalfotoapp.com';
        const resetUrl = `${baseUrl}/reset-password?token=${encodeURIComponent(token)}&email=${encodeURIComponent(user.email)}`;

        // Enviamos email (si falla, logueamos pero NO rompemos la respuesta al cliente)
        try {
            await sendResetEmail(user.email, user.name, resetUrl);
            console.log('✅ [RESET-PASS] Email enviado a:', user.email);
        } catch (emailErr) {
            console.error('⚠️ [RESET-PASS] No se pudo enviar email:', emailErr.message);
        }

        res.json({ mensaje: genericMsg });
    } catch (error) {
        console.error('Error en forgot-password:', error);
        res.status(500).json({ error: 'Error interno al procesar la solicitud.' });
    }
});

// POST /api/auth/reset-password — Valida token y cambia la contraseña
router.post('/reset-password', async (req, res) => {
    try {
        const { token, email, newPassword } = req.body;
        if (!token || !email || !newPassword) {
            return res.status(400).json({ error: 'Token, correo y nueva contraseña son requeridos.' });
        }
        if (newPassword.length < 8) {
            return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 8 caracteres.' });
        }

        // Validamos el token contra la BD
        const resetResult = await pool.query(
            `SELECT pr.*, u.email, u.name 
             FROM password_resets pr 
             JOIN users u ON pr.user_id = u.id 
             WHERE pr.token = $1 AND pr.used = FALSE AND pr.expires_at > NOW()`,
            [token]
        );

        if (resetResult.rows.length === 0) {
            return res.status(400).json({ error: 'El enlace de recuperación es inválido o ha expirado. Solicita uno nuevo.' });
        }

        const resetRecord = resetResult.rows[0];

        // Verificamos que el email coincida (seguridad extra: evita cross-account si alguien roba el token)
        if (resetRecord.email.toLowerCase() !== email.toLowerCase()) {
            return res.status(400).json({ error: 'Datos inconsistentes. Intenta solicitar un nuevo enlace.' });
        }

        // Hash de la nueva contraseña (mismo algoritmo que register/login: bcrypt rounds=10)
        const hashedPassword = await bcrypt.hash(newPassword, 10);

        // Actualizamos la contraseña del usuario
        await pool.query('UPDATE users SET password = $1 WHERE id = $2', [hashedPassword, resetRecord.user_id]);

        // Marcamos el token como usado (single-use)
        await pool.query('UPDATE password_resets SET used = TRUE WHERE id = $1', [resetRecord.id]);

        // Opcional: invalidamos TODOS los tokens previos de ese usuario por seguridad
        await pool.query('UPDATE password_resets SET used = TRUE WHERE user_id = $1 AND id != $2', [resetRecord.user_id, resetRecord.id]);

        // Enviamos confirmación (opcional pero recomendado UX)
        try {
            await resend.emails.send({
                from: FROM_EMAIL,
                to: resetRecord.email,
                subject: '✅ Tu contraseña fue cambiada correctamente',
                html: `
                    <div style="font-family:'Inter',sans-serif;max-width:600px;margin:0 auto;padding:20px;">
                        <div style="background:white;padding:30px;border-radius:16px;border:1px solid #e2e8f0;">
                            <h2 style="color:#0f172a;margin-bottom:16px;">Hola ${resetRecord.name},</h2>
                            <p style="color:#475569;font-size:15px;line-height:1.6;margin-bottom:20px;">
                                Tu contraseña de GlobalFoto ha sido actualizada exitosamente. Ya puedes iniciar sesión con tus nuevas credenciales.
                            </p>
                            <div style="background:#ecfdf5;padding:16px;border-radius:10px;border-left:4px solid #10b981;">
                                <p style="color:#065f46;font-size:13px;margin:0;">
                                    ✓ Si no realizaste este cambio, contacta inmediatamente a soporte@globalfotoapp.com.
                                </p>
                            </div>
                            <div style="text-align:center;margin-top:24px;">
                                <a href="${process.env.FRONTEND_URL || 'https://www.globalfotoapp.com'}/panel"
                                   style="display:inline-block;background:#ffffff;color:#0f172a;padding:14px 32px;text-decoration:none;border-radius:8px;font-weight:700;font-size:15px;box-shadow:0 4px 14px rgba(0,0,0,0.15);">
                                    Ir a mi Panel
                                </a>
                            </div>
                        </div>
                    </div>
                `
            });
        } catch (e) { /* silencioso */ }

        res.json({ mensaje: 'Contraseña actualizada correctamente. Ya puedes iniciar sesión.' });
    } catch (error) {
        console.error('Error en reset-password:', error);
        res.status(500).json({ error: 'Error interno al actualizar la contraseña.' });
    }
});

module.exports = router;