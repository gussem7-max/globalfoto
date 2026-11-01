const express = require('express');
const router = express.Router();
const pool = require('../db');
const jwt = require('jsonwebtoken');
const { S3Client, DeleteObjectCommand } = require('@aws-sdk/client-s3');

const s3Client = new S3Client({
    region: process.env.AWS_REGION,
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    }
});

const JWT_SECRET = process.env.JWT_SECRET || 'globalfoto_secret_key_2024';
const isValidId = (id) => /^\d+$/.test(id) && parseInt(id) > 0;

// Middleware: solo administradores
async function verificarAdmin(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'No autorizado.' });
    try {
        const decoded = jwt.verify(authHeader.split(' ')[1], JWT_SECRET);
        const r = await pool.query('SELECT role FROM users WHERE id = $1', [decoded.id]);
        if (r.rows.length === 0 || r.rows[0].role !== 'admin') {
            return res.status(403).json({ error: 'Se requieren permisos de administrador.' });
        }
        req.admin = decoded;
        next();
    } catch (e) {
        return res.status(401).json({ error: 'Token inválido.' });
    }
}

// =====================================================
// ESTADÍSTICAS GLOBALES
// =====================================================
router.get('/stats', verificarAdmin, async (req, res) => {
    try {
        const r = await pool.query(`
            SELECT
                (SELECT COUNT(*) FROM users) as users,
                (SELECT COUNT(*) FROM events) as events,
                (SELECT COUNT(*) FROM photos) as photos,
                (SELECT COUNT(*) FROM orders) as orders,
                (SELECT COALESCE(SUM(amount),0) FROM orders WHERE status='approved') as gross,
                (SELECT COALESCE(SUM(commission_amount),0) FROM orders WHERE status='approved') as commission
        `);
        res.json(r.rows[0]);
    } catch (error) {
        console.error('Error stats admin:', error);
        res.status(500).json({ error: 'Error al cargar estadísticas.' });
    }
});

// =====================================================
// TODOS LOS EVENTOS (de todos los fotógrafos)
// =====================================================
router.get('/events', verificarAdmin, async (req, res) => {
    try {
        const r = await pool.query(`
            SELECT e.*, u.name as photographer_name, u.email as photographer_email, COUNT(p.id) as "photosCount"
            FROM events e
            JOIN users u ON e.photographer_id = u.id
            LEFT JOIN photos p ON e.id = p.event_id
            GROUP BY e.id, u.id
            ORDER BY e.created_at DESC
        `);
        res.json(r.rows.map(ev => ({ ...ev, photosCount: parseInt(ev.photosCount, 10) || 0 })));
    } catch (error) {
        console.error('Error eventos admin:', error);
        res.status(500).json({ error: 'Error al cargar eventos.' });
    }
});

// =====================================================
// BIBLIOTECA DE MEDIOS (todas las fotos)
// =====================================================
router.get('/photos', verificarAdmin, async (req, res) => {
    try {
        const r = await pool.query(`
            SELECT p.id, p.url, p.preview_url, p.filename, p.created_at,
                   e.title as event_title, e.id as event_id,
                   u.name as photographer_name
            FROM photos p
            JOIN events e ON p.event_id = e.id
            JOIN users u ON e.photographer_id = u.id
            ORDER BY p.created_at DESC
            LIMIT 300
        `);
        res.json(r.rows);
    } catch (error) {
        console.error('Error fotos admin:', error);
        res.status(500).json({ error: 'Error al cargar fotos.' });
    }
});

// =====================================================
// TODOS LOS PEDIDOS
// =====================================================
router.get('/orders', verificarAdmin, async (req, res) => {
    try {
        const r = await pool.query(`
            SELECT o.*, e.title as event_title, u.name as photographer_name, u.email as photographer_email
            FROM orders o
            JOIN events e ON o.event_id = e.id
            JOIN users u ON e.photographer_id = u.id
            ORDER BY o.created_at DESC
        `);
        res.json(r.rows);
    } catch (error) {
        console.error('Error pedidos admin:', error);
        res.status(500).json({ error: 'Error al cargar pedidos.' });
    }
});

// =====================================================
// ELIMINAR CUALQUIER EVENTO (con sus fotos en S3)
// =====================================================
router.delete('/events/:id', verificarAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        if (!isValidId(id)) return res.status(400).json({ error: 'ID inválido.' });

        const photosResult = await pool.query('SELECT filename, preview_url FROM photos WHERE event_id = $1', [id]);
        for (const photo of photosResult.rows) {
            try {
                if (photo.filename) await s3Client.send(new DeleteObjectCommand({ Bucket: process.env.AWS_BUCKET_NAME, Key: photo.filename }));
                if (photo.preview_url) {
                    const previewKey = photo.preview_url.split('.com/')[1];
                    if (previewKey) await s3Client.send(new DeleteObjectCommand({ Bucket: process.env.AWS_BUCKET_NAME, Key: previewKey }));
                }
            } catch (s3Error) { console.error('Error S3:', s3Error); }
        }
        await pool.query('DELETE FROM events WHERE id = $1', [id]);
        res.json({ mensaje: 'Evento eliminado por el administrador.' });
    } catch (error) {
        console.error('Error eliminar evento admin:', error);
        res.status(500).json({ error: 'Error al eliminar el evento.' });
    }
});

// =====================================================
// ELIMINAR CUALQUIER FOTO
// =====================================================
router.delete('/photos/:id', verificarAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        if (!isValidId(id)) return res.status(400).json({ error: 'ID inválido.' });

        const r = await pool.query('SELECT filename, preview_url FROM photos WHERE id = $1', [id]);
        if (r.rows.length === 0) return res.status(404).json({ error: 'Foto no encontrada.' });
        const photo = r.rows[0];

        try {
            if (photo.filename) await s3Client.send(new DeleteObjectCommand({ Bucket: process.env.AWS_BUCKET_NAME, Key: photo.filename }));
            if (photo.preview_url) {
                const previewKey = photo.preview_url.split('.com/')[1];
                if (previewKey) await s3Client.send(new DeleteObjectCommand({ Bucket: process.env.AWS_BUCKET_NAME, Key: previewKey }));
            }
        } catch (s3Error) { console.error('Error S3:', s3Error); }

        await pool.query('DELETE FROM photos WHERE id = $1', [id]);
        res.json({ mensaje: 'Foto eliminada por el administrador.' });
    } catch (error) {
        console.error('Error eliminar foto admin:', error);
        res.status(500).json({ error: 'Error al eliminar la foto.' });
    }
});

// POST /api/admin/activate-subscription
// Activa o modifica la suscripción de un usuario manualmente (solo admin)
router.post('/activate-subscription', verificarAdmin, async (req, res) => {
    try {
        // Verificar que el requester sea admin
        const adminCheck = await pool.query('SELECT role FROM users WHERE id = $1', [req.admin.id]);
        if (adminCheck.rows.length === 0 || adminCheck.rows[0].role !== 'admin') {
            return res.status(403).json({ error: 'Solo administradores pueden activar suscripciones.' });
        }

        const { user_id, plan, days } = req.body;
        
        if (!user_id || !plan) {
            return res.status(400).json({ error: 'Faltan datos: user_id y plan son obligatorios.' });
        }

        const validPlans = ['basic', 'pro', 'studio', 'trial'];
        if (!validPlans.includes(plan)) {
            return res.status(400).json({ error: 'Plan inválido. Usa: basic, pro, studio o trial.' });
        }

        const expirationDays = parseInt(days) || 30; // Default 30 días si no se especifica
        
        // Si el plan es 'trial', resetear a estado inicial
        if (plan === 'trial') {
            await pool.query(
                `UPDATE users SET plan = 'trial', is_trial = FALSE, plan_started_at = CURRENT_TIMESTAMP, plan_expires_at = CURRENT_TIMESTAMP + INTERVAL '14 days' WHERE id = $1`,
                [user_id]
            );
        } else {
            // Activar plan pagado con duración personalizada
            await pool.query(
                `UPDATE users SET plan = $1, plan_started_at = CURRENT_TIMESTAMP, plan_expires_at = CURRENT_TIMESTAMP + INTERVAL '${expirationDays} days' WHERE id = $2`,
                [plan, user_id]
            );
        }

        console.log(`✅ Admin ${req.admin.id} activó plan "${plan}" (${expirationDays} días) para usuario ${user_id}`);
        
        res.json({ 
            success: true, 
            message: `Plan "${plan}" activado exitosamente por ${expirationDays} días.` 
        });

    } catch (error) {
        console.error('Error activando suscripción:', error);
        res.status(500).json({ error: 'Error interno al activar la suscripción.' });
    }
});

// =====================================================
// ÓRDENES DE SUSCRIPCIÓN (Reportes manuales y pendientes)
// =====================================================
router.get('/subscription-orders', verificarAdmin, async (req, res) => {
    try {
        const r = await pool.query(`
            SELECT so.*, u.name as user_name, u.email as user_email, u.country
            FROM subscription_orders so
            JOIN users u ON so.user_id = u.id
            ORDER BY 
                CASE so.status 
                    WHEN 'reported' THEN 1 
                    WHEN 'pending' THEN 2 
                    WHEN 'paid' THEN 3 
                    ELSE 4 
                END,
                so.created_at DESC
        `);
        res.json(r.rows);
    } catch (error) {
        console.error('Error cargando órdenes de suscripción:', error);
        res.status(500).json({ error: 'Error al cargar órdenes.' });
    }
});

router.post('/subscription-orders/:id/approve', verificarAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const orderRes = await pool.query('SELECT * FROM subscription_orders WHERE id = $1', [id]);
        if (orderRes.rows.length === 0) return res.status(404).json({ error: 'Orden no encontrada.' });
        
        const order = orderRes.rows[0];
        if (order.status === 'paid' || order.status === 'approved') {
            return res.status(400).json({ error: 'Esta orden ya fue procesada.' });
        }

        // Importar funciones de suscripciones
        const subRoutes = require('./subscriptions');

        // 1. Activar plan (misma lógica exacta que el webhook automático)
        if (subRoutes.activateUserPlan) {
            await subRoutes.activateUserPlan(order.user_id, order.plan);
        }

        // 2. Marcar orden como pagada en la base de datos
        await pool.query(
            `UPDATE subscription_orders SET status = 'paid', paid_at = NOW(), reference_note = COALESCE(reference_note, '') || ' | Aprobado manualmente por Admin' WHERE id = $1`,
            [id]
        );

        // 3. Enviar correo espectacular de confirmación al fotógrafo
        if (subRoutes.sendPaymentConfirmationEmail) {
            subRoutes.sendPaymentConfirmationEmail(order.user_id, order.plan, {
                amount: Number(order.expected_amount),
                currency: order.currency,
                reference: order.reference_code,
                channel: order.channel
            }).catch(err => console.error('⚠️ [EMAIL admin] fallo:', err.message));
        }

        res.json({ success: true, message: 'Plan activado y orden aprobada.' });
    } catch (error) {
        console.error('Error aprobando orden:', error);
        res.status(500).json({ error: 'Error interno al aprobar.' });
    }
});

router.post('/subscription-orders/:id/reject', verificarAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { reason } = req.body;
        
        await pool.query(
            `UPDATE subscription_orders SET status = 'rejected', reference_note = COALESCE(reference_note, '') || ' | Rechazado por Admin: ' || $1 WHERE id = $2`,
            [reason || 'Sin motivo', id]
        );
        
        res.json({ success: true, message: 'Orden rechazada.' });
    } catch (error) {
        console.error('Error rechazando orden:', error);
        res.status(500).json({ error: 'Error interno al rechazar.' });
    }
});

module.exports = router;