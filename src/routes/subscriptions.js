const express = require('express');
const router = express.Router();
const pool = require('../db');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { createSubscriptionOrder, PLANS } = require('../lib/subscription');
const { getCurrentRate } = require('../lib/exchangeRate');

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
        
        const { currency, country } = userResult.rows[0];
        
        // Calcular precios dinámicos según moneda/tasa
        let plansOut;
        if (currency === 'VES') {
            // Obtener tasa EUR→VES vigente
            const eurVesRate = await getCurrentRate('EUR_VES');
            
            plansOut = Object.keys(PLANS).map(key => ({
                key,
                name: key.charAt(0).toUpperCase() + key.slice(1),
                price_usd: PLANS[key].usd,
                price_ves: +(PLANS[key].usd * eurVesRate).toFixed(2), // conversión automática
                currency: 'VES',
                exchange_rate: eurVesRate
            }));
        } else if (currency === 'COP') {
            // COP tiene precio fijo definido en PLANS
            plansOut = Object.keys(PLANS).map(key => ({
                key,
                name: key.charAt(0).toUpperCase() + key.slice(1),
                price_cop: PLANS[key].cop,
                currency: 'COP'
            }));
        } else {
            // USD/Zinli: precio base directo
            plansOut = Object.keys(PLANS).map(key => ({
                key,
                name: key.charAt(0).toUpperCase() + key.slice(1),
                price_usd: PLANS[key].usd,
                currency: 'USD'
            }));
        }

        res.json({ plans: plansOut, currency });
    } catch (error) {
        console.error('Error obteniendo planes:', error);
        res.status(500).json({ error: 'Error interno: ' + error.message });
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

        // Para VES, calcular monto base con tasa actual ANTES de crear orden
        let baseAmount;
        if (currency === 'VES') {
            const eurVesRate = await getCurrentRate('EUR_VES');
            baseAmount = +(PLANS[plan].usd * eurVesRate).toFixed(2);
        } else {
            baseAmount = PLANS[plan][currency.toLowerCase()] || PLANS[plan].usd;
        }

        // Crear orden con monto base ya convertido
        const order = await createSubscriptionOrderWithBase(req.user.id, plan, { currency, channel }, baseAmount);

        res.status(201).json({
            message: 'Orden creada.',
            order: {
                id: order.id,
                expected_amount: Number(order.expected_amount), // forzar número
                reference_code: sanitizeRefCode(order.reference_code), // limpiar símbolos
                currency: order.currency,
                channel: order.channel,
                expires_at: order.expires_at,
                instructions: getInstructions(channel, Number(order.expected_amount), currency, sanitizeRefCode(order.reference_code))
            }
        });

    } catch (error) {
        console.error('Error creando orden:', error);
        res.status(500).json({ error: error.message || 'Error interno al crear la orden.' });
    }
});

// Función auxiliar para crear orden con base pre-calculada (VES dinámico)
async function createSubscriptionOrderWithBase(userId, planKey, countryMeta, customBase) {
    const plan = PLANS[planKey];
    if (!plan) throw new Error('Plan inválido.');

    const currency = String(countryMeta.currency || '').toUpperCase();
    const base = typeof customBase === 'number' ? customBase : (plan[currency.toLowerCase()] ?? plan.usd);
    
    if (isNaN(base) || base <= 0) throw new Error(`Precio base inválido: ${base}`);

    // Buscar sufijos ocupados (últimos 30 min)
    const recentOrders = await pool.query(
        `SELECT expected_amount FROM subscription_orders 
         WHERE currency = $1 AND plan = $2 AND status = 'pending' 
           AND created_at > NOW() - INTERVAL '30 minutes'`,
        [currency, planKey]
    );
    const taken = new Set(recentOrders.rows.map(r => parseFloat(r.expected_amount)));

    // Generar monto único
    const gen = generateUniqueAmount(base, currency, taken);
    if (!gen) throw new Error('Sistema saturado de pagos pendientes. Intenta de nuevo en unos minutos.');

    // Generar código limpio (solo letras/números)
    let refCode = generateCleanReferenceCode();
    let attempts = 0;
    while (attempts < 5) {
        const exists = await pool.query('SELECT 1 FROM subscription_orders WHERE reference_code = $1', [refCode]);
        if (exists.rows.length === 0) break;
        refCode = generateCleanReferenceCode();
        attempts++;
    }

    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
    
    const result = await pool.query(
        `INSERT INTO subscription_orders 
         (user_id, plan, currency, channel, base_amount, expected_amount, suffix, reference_code, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id, user_id, plan, currency, channel, 
                   base_amount::text AS base_amount, 
                   expected_amount::text AS expected_amount, 
                   suffix, reference_code, status, created_at, expires_at`,
        [userId, planKey, currency, countryMeta.channel, base, gen.expected, gen.suffix, refCode, expiresAt]
    );

    const row = result.rows[0];
    return {
        ...row,
        base_amount: Number(row.base_amount),
        expected_amount: Number(row.expected_amount),
        suffix: Number(row.suffix)
    };
}

function generateUniqueAmount(base, currency, takenSuffixes) {
    let maxSuffix;
    if (currency === 'USD') maxSuffix = 10;       // 0..9
    else if (currency === 'COP') maxSuffix = 100; // 0..99
    else maxSuffix = 100;                        // VES

    for (let i = 0; i < maxSuffix; i++) {
        const candidate = +(parseFloat(base) + i * (currency === 'USD' ? 0.01 : 1)).toFixed(4);
        if (!takenSuffixes.has(candidate)) {
            return { expected: candidate, suffix: i };
        }
    }
    return null;
}

// Código SIN símbolos bancarios problemáticos (-*/#@_)
function generateCleanReferenceCode() {
    // Solo A-Z y 0-9, longitud 6 caracteres
    const chars = crypto.randomBytes(6).toString('hex').toUpperCase().slice(0, 6);
    return `GF${chars}`; // Ej: GFABC123
}

// Sanitizar cualquier código existente por seguridad
function sanitizeRefCode(code) {
    return String(code || '').replace(/[^A-Z0-9]/gi, '').toUpperCase().slice(0, 10);
}

// --- CONCILIACIÓN AUTOMÁTICA (WEBHOOK CASERO) ---
router.post('/webhook', async (req, res) => {
    const secret = req.headers['x-webhook-secret'];
    if (secret !== process.env.WEBHOOK_SECRET) return res.status(401).json({ error: 'Secret invalido' });

    const { amount, currency, reference_text, sender_name } = req.body;
    
    const cleanAmount = parseFloat(amount);
    const cleanRef = String(reference_text || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, ''); // quitar todo excepto alfanuméricos

    try {
        let matchedOrder = null;
        
        // ESTRATEGIA 1: Búsqueda por CÓDIGO EXACTO (sin símbolos)
        if (cleanRef.startsWith('GF') && cleanRef.length >= 6) {
            const foundByCode = await pool.query(
                `UPDATE subscription_orders SET status='paid', paid_at=NOW(), webhook_raw=$1 
                 WHERE reference_code=$2 AND expected_amount=$3 AND currency=$4 AND status='pending' 
                 RETURNING *`,
                [JSON.stringify(req.body), cleanRef, cleanAmount, currency]
            );
            if (foundByCode.rows.length > 0) matchedOrder = foundByCode.rows[0];
        }

        // ESTRATEGIA 2: Monto único (fallback)
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
            await activateUserPlan(matchedOrder.user_id, matchedOrder.plan);
            console.log(`✅ Pago confirmado automáticamente para orden ${matchedOrder.id}`);
            return res.json({ success: true, order_id: matchedOrder.id });
        } else {
            console.warn(`⚠️ Notificación recibida pero sin coincidencia clara: ${amount} ${currency} Ref:${reference_text}`);
            return res.json({ success: false, reason: 'no_match' });
        }

    } catch (err) {
        console.error('Error procesando webhook:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// --- VALIDACIÓN MANUAL ---
router.post('/verify-manual', verifyToken, async (req, res) => {
    const { order_id, reported_amount, reported_reference } = req.body;
    
    try {
        const orderCheck = await pool.query(
            `SELECT * FROM subscription_orders WHERE id=$1 AND user_id=$2 AND status='pending'`,
            [order_id, req.user.id]
        );
        if (orderCheck.rows.length === 0) return res.status(404).json({ error: 'Orden no encontrada o ya procesada.' });
        
        const order = orderCheck.rows[0];
        const cleanReportedAmount = parseFloat(reported_amount);
        const cleanReportedRef = String(reported_reference || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');

        let isMatch = false;

        // 1. ¿Coincide el código?
        if (cleanReportedRef.startsWith('GF') && cleanReportedRef === order.reference_code) isMatch = true;

        // 2. ¿Coincide el monto exacto?
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

// Helpers
async function activateUserPlan(userId, planKey) {
    const expirationDays = 30;
    await pool.query(
        `UPDATE users SET plan=$1, plan_expires_at=CURRENT_TIMESTAMP + INTERVAL '${expirationDays} days' WHERE id=$2`,
        [planKey, userId]
    );
}

function getInstructions(channel, amount, currency, refCode) {
    // Formatear monto SEGÚN moneda (Bs. sin $, COP con $, USD con $)
    let amtStr;
    if (currency === 'VES') amtStr = `Bs. ${amount.toFixed(2)}`;
    else if (currency === 'COP') amtStr = `$${Math.round(amount).toLocaleString('es-CO')} COP`;
    else amtStr = `$${amount.toFixed(2)} USD`;
    
    const codeStr = `TU CÓDIGO DE REFERENCIA ES: ${refCode}`;
    
    let intro = "";
    if (channel === 'nequi') intro = `Transfiere EXACTAMENTE ${amtStr} a nuestro Nequi institucional.`;
    else if (channel === 'pagomovil') intro = `Realiza Pago Móvil por ${amtStr}.`;
    else intro = `Genera un cobro o transferencia en Zinli por ${amtStr}.`;

    return `${intro}\n\n${codeStr}\n\nIMPORTANTE: Copia este código y pégalo en el campo "Concepto", "Mensaje" o "Referencia" al momento de pagar.\nSi olvidas el código, asegúrate de transferir el MONTO EXACTO (${amtStr}).`;
}

// Endpoints de consulta de estado
router.get('/orders/:id/status', verifyToken, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT status FROM subscription_orders WHERE id=$1 AND user_id=$2',
            [req.params.id, req.user.id]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Orden no encontrada.' });
        res.json({ status: result.rows[0].status });
    } catch (error) {
        console.error('Error consultando estado:', error);
        res.status(500).json({ error: 'Error interno.' });
    }
});

router.get('/orders/:id', verifyToken, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT * FROM subscription_orders WHERE id=$1 AND user_id=$2',
            [req.params.id, req.user.id]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Orden no encontrada.' });
        const order = result.rows[0];
        // Normalizar números antes de devolver
        order.expected_amount = Number(order.expected_amount);
        order.base_amount = Number(order.base_amount);
        order.reference_code = sanitizeRefCode(order.reference_code);
        res.json({ order });
    } catch (error) {
        console.error('Error obteniendo orden:', error);
        res.status(500).json({ error: 'Error interno.' });
    }
});

module.exports = router;