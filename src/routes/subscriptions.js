const express = require('express');
const router = express.Router();
const pool = require('../db');
const jwt = require('jsonwebtoken');
const { createSubscriptionOrder, PLANS } = require('../lib/subscription');

const JWT_SECRET = process.env.JWT_SECRET || 'globalfoto_secret_key_2024';

function verifyToken(req, res, next) {
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

// GET /api/subscriptions/plans
router.get('/plans', verifyToken, async (req, res) => {
    try {
        const userResult = await pool.query('SELECT currency, country FROM users WHERE id = $1', [req.user.id]);
        if (userResult.rows.length === 0) return res.status(404).json({ error: 'Usuario no encontrado.' });
        
        const { currency } = userResult.rows[0];
        
        const plansOut = Object.keys(PLANS).map(key => ({
            key,
            name: key.charAt(0).toUpperCase() + key.slice(1),
            price: PLANS[key][currency.toLowerCase()] || PLANS[key].usd,
            currency
        }));

        res.json({ plans: plansOut, currency });
    } catch (error) {
        console.error('Error obteniendo planes:', error);
        res.status(500).json({ error: 'Error interno.' });
    }
});

// POST /api/subscriptions/order
router.post('/order', verifyToken, async (req, res) => {
    try {
        const { plan } = req.body;
        if (!plan) return res.status(400).json({ error: 'Falta el plan.' });

        const userResult = await pool.query('SELECT currency, country FROM users WHERE id = $1', [req.user.id]);
        if (userResult.rows.length === 0) return res.status(404).json({ error: 'Usuario no encontrado.' });
        
        const { currency, country } = userResult.rows[0];
        
        let channel = 'zinli';
        if (country === 'VE') channel = 'pagomovil';
        else if (country === 'CO') channel = 'nequi';

        const order = await createSubscriptionOrder(req.user.id, plan, { currency, channel });

        res.status(201).json({
            message: 'Orden creada.',
            order: {
                id: order.id,
                expected_amount: order.expected_amount,
                reference_code: order.reference_code, // <-- EL CÓDIGO PARA COPIAR
                currency: order.currency,
                channel: order.channel,
                expires_at: order.expires_at,
                instructions: getInstructions(channel, order.expected_amount, currency, order.reference_code)
            }
        });

    } catch (error) {
        console.error('Error creando orden:', error);
        res.status(500).json({ error: error.message || 'Error interno al crear la orden.' });
    }
});

// --- CONCILIACIÓN AUTOMÁTICA (WEBHOOK CASERO) ---
// Este endpoint lo llama tu teléfono Android vía MacroDroid
router.post('/webhook', async (req, res) => {
    // Seguridad básica: header secreto desde el teléfono
    const secret = req.headers['x-webhook-secret'];
    if (secret !== process.env.WEBHOOK_SECRET) return res.status(401).json({ error: 'Secret invalido' });

    const { amount, currency, reference_text, sender_name } = req.body;
    
    // Normalizar inputs
    const cleanAmount = parseFloat(amount);
    const cleanRef = String(reference_text || '').trim().toUpperCase();

    try {
        // ESTRATEGIA 1: Búsqueda por CÓDIGO EXACTO en el texto de referencia/concepto
        // Ejemplo: el usuario escribió "Pago GF-ABCD" o "GF-ABCD Suscripcion"
        let matchedOrder = null;
        
        if (cleanRef.includes('GF-')) {
            // Extraer el código GF-XXXX usando regex simple
            const match = cleanRef.match(/GF-[A-Z0-9]{4}/i);
            if (match) {
                const code = match[0].toUpperCase();
                
                // ⚠️ DOBLE VERIFICACIÓN: buscar por código Y validar que el MONTO coincida
                const foundByCode = await pool.query(
                    `UPDATE subscription_orders SET status='paid', paid_at=NOW(), webhook_raw=$1 
                     WHERE reference_code=$2 AND expected_amount=$3 AND currency=$4 AND status='pending' 
                     RETURNING *`,
                    [JSON.stringify(req.body), code, cleanAmount, currency]
                );
                if (foundByCode.rows.length > 0) matchedOrder = foundByCode.rows[0];
            }
        }

        // ESTRATEGIA 2: Si no hubo código, buscar por MONTO ÚNICO (sufijo)
        if (!matchedOrder) {
            const foundByAmount = await pool.query(
                `UPDATE subscription_orders SET status='paid', paid_at=NOW(), webhook_raw=$1 
                 WHERE expected_amount=$2 AND currency=$3 AND status='pending' 
                   AND created_at > NOW() - INTERVAL '30 minutes'
                 LIMIT 1 RETURNING *`,
                [JSON.stringify(req.body), cleanAmount, currency]
            );
            if (foundByAmount.rows.length > 0) matchedOrder = foundByAmount.rows[0];
        }

        if (matchedOrder) {
            // ACTIVAR PLAN EN USERS
            await activateUserPlan(matchedOrder.user_id, matchedOrder.plan);
            console.log(`✅ Pago confirmado automáticamente para orden ${matchedOrder.id}`);
            return res.json({ success: true, order_id: matchedOrder.id });
        } else {
            console.warn(`⚠️ Notificación recibida pero sin coincidencia clara: ${amount} ${currency} Ref:${reference_text}`);
            // Guardamos la notificación cruda para revisión manual posterior si quieres
            return res.json({ success: false, reason: 'no_match' });
        }

    } catch (err) {
        console.error('Error procesando webhook:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// --- VALIDACIÓN MANUAL (BOTÓN DEL CLIENTE) ---
// El cliente dice "Ya pagué X monto con referencia Y"
router.post('/verify-manual', verifyToken, async (req, res) => {
    const { order_id, reported_amount, reported_reference } = req.body;
    
    try {
        // Verificar que la orden pertenezca al usuario y esté pendiente
        const orderCheck = await pool.query(
            `SELECT * FROM subscription_orders WHERE id=$1 AND user_id=$2 AND status='pending'`,
            [order_id, req.user.id]
        );
        if (orderCheck.rows.length === 0) return res.status(404).json({ error: 'Orden no encontrada o ya procesada.' });
        
        const order = orderCheck.rows[0];
        const cleanReportedAmount = parseFloat(reported_amount);
        const cleanReportedRef = String(reported_reference || '').trim().toUpperCase();

        // LÓGICA DE CONCILIACIÓN MANUAL (igual que el webhook pero iniciada por el usuario)
        let isMatch = false;

        // 1. ¿Coincide el código?
        if (cleanReportedRef.includes('GF-')) {
            const match = cleanReportedRef.match(/GF-[A-Z0-9]{4}/i);
            if (match && match[0].toUpperCase() === order.reference_code) isMatch = true;
        }

        // 2. ¿Coincide el monto exacto? (tolerancia pequeña por decimales)
        if (!isMatch && Math.abs(cleanReportedAmount - parseFloat(order.expected_amount)) < 0.01) {
            isMatch = true;
        }

        if (isMatch) {
            await pool.query(`UPDATE subscription_orders SET status='paid', paid_at=NOW(), reference_note=$1 WHERE id=$2`, [`Manual: ${reported_reference}`, order.id]);
            await activateUserPlan(order.user_id, order.plan);
            return res.json({ success: true, message: 'Pago verificado manualmente. ¡Disfruta tu plan!' });
        } else {
            return res.status(400).json({ error: 'Datos no coinciden con ninguna orden activa. Revisa el monto y la referencia.' });
        }

    } catch (err) {
        console.error('Error en verificación manual:', err);
        res.status(500).json({ error: 'Error interno.' });
    }
});

// Helper: Activar plan en la tabla users
async function activateUserPlan(userId, planKey) {
    const expirationDays = 30; // Mensual
    await pool.query(
        `UPDATE users SET plan=$1, plan_expires_at=CURRENT_TIMESTAMP + INTERVAL '${expirationDays} days' WHERE id=$2`,
        [planKey, userId]
    );
}

// Helper: Instrucciones claras
function getInstructions(channel, amount, currency, refCode) {
    const amtStr = `${amount.toFixed(currency === 'USD' ? 2 : 0)} ${currency}`;
    const codeStr = `TU CÓDIGO DE REFERENCIA ES: ${refCode}`;
    
    let intro = "";
    if (channel === 'nequi') intro = `Transfiere EXACTAMENTE ${amtStr} a nuestro Nequi institucional.`;
    else if (channel === 'pagomovil') intro = `Realiza Pago Móvil por ${amtStr}.`;
    else intro = `Genera un cobro o transferencia en Zinli por ${amtStr}.`;

    return `${intro}\n\n${codeStr}\n\nIMPORTANTE: Copia este código y pégalo en el campo "Concepto", "Mensaje" o "Referencia" al momento de pagar.\nSi olvidas el código, asegúrate de transferir el MONTO EXACTO (${amtStr}) incluyendo los centavos.`;
}

module.exports = router;