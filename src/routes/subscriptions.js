const express = require('express');
const router = express.Router();
const pool = require('../db');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { PLANS } = require('../lib/subscription');
const { getCurrentRate } = require('../lib/exchangeRate');

const JWT_SECRET = process.env.JWT_SECRET || 'globalfoto_secret_key_2024';

const BANK_DATA = {
    nequi: { number: '3155129964', name: 'Gustavo Semprun' },
    pagomovil: { bank: 'Banco Venezolano de Crédito', account: '20661645', phone: '04145866017', name: 'Gustavo Semprun' },
    zinli: { link: 'https://recargas.zinli.com/6XgFfhiz45rArACBUYxWTo' }
};

// === CORREO DE CONFIRMACIÓN DE PAGO (Resend, mismo patrón que auth.js) ===
const { Resend } = require('resend');
const resend = new Resend(process.env.RESEND_API_KEY);
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'notificaciones@globalfotoapp.com';

const CHANNEL_LABELS = { nequi: 'Nequi', pagomovil: 'Pago Móvil', zinli: 'Zinli' };

function formatMoney(amount, currency) {
    const num = parseFloat(amount) || 0;
    if (currency === 'VES') return `Bs. ${num.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    if (currency === 'COP') return `$${Math.round(num).toLocaleString('es-CO')} COP`;
    return `$${num.toFixed(2)} USD`;
}

// Se llama en background (fire-and-forget) desde webhook y verify-manual.
// Nunca lanza hacia afuera: todo está dentro de try/catch para no romper la conciliación.
async function sendPaymentConfirmationEmail(userId, planKey, paymentInfo) {
    try {
        const u = await pool.query('SELECT name, email, plan_expires_at FROM users WHERE id = $1', [userId]);
        if (u.rows.length === 0 || !u.rows[0].email) return;
        const user = u.rows[0];

        // Todo se calcula FUERA del template: dentro solo van ${variableSimple}, a prueba de pegado.
        const firstName = (user.name || '').split(' ')[0];
        const planLabel = (planKey || '').toUpperCase();
        const moneyStr = formatMoney(paymentInfo.amount, paymentInfo.currency);
        const channelLabel = CHANNEL_LABELS[paymentInfo.channel] || 'transferencia';
        const reference = paymentInfo.reference || '—';
        const expiryStr = user.plan_expires_at
            ? new Date(user.plan_expires_at).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' })
            : 'la fecha indicada';
        const panelUrl = process.env.FRONTEND_URL || 'https://www.globalfotoapp.com';

        const html = `
            <div style="font-family: 'Inter', sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                <div style="background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%); padding: 30px; border-radius: 16px 16px 0 0; text-align: center;">
                    <h1 style="color: white; margin: 0; font-size: 26px;">📸 GlobalFoto</h1>
                    <p style="color: #94a3b8; margin-top: 8px; font-size: 14px;">Pago confirmado</p>
                </div>
                <div style="background: white; padding: 30px; border-radius: 0 0 16px 16px; border: 1px solid #e2e8f0; border-top: none;">
                    <div style="text-align: center; margin-bottom: 24px;">
                        <div style="font-size: 48px; line-height: 1;">✅</div>
                        <h2 style="color: #0f172a; margin: 12px 0 6px 0; font-size: 22px;">¡Pago recibido, ${firstName}!</h2>
                        <p style="color: #475569; font-size: 15px; margin: 0;">Tu plan <strong>${planLabel}</strong> ya está activo.</p>
                    </div>
                    <div style="background: #f8fafc; padding: 20px; border-radius: 10px; margin-bottom: 24px; border-left: 4px solid #059669;">
                        <div style="display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #e2e8f0;">
                            <span style="color: #64748b; font-size: 13px;">Plan</span>
                            <span style="color: #0f172a; font-size: 14px; font-weight: 700;">${planLabel}</span>
                        </div>
                        <div style="display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #e2e8f0;">
                            <span style="color: #64748b; font-size: 13px;">Monto pagado</span>
                            <span style="color: #0f172a; font-size: 14px; font-weight: 700;">${moneyStr}</span>
                        </div>
                        <div style="display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #e2e8f0;">
                            <span style="color: #64748b; font-size: 13px;">Pagado mediante</span>
                            <span style="color: #0f172a; font-size: 14px; font-weight: 700;">${channelLabel}</span>
                        </div>
                        <div style="display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #e2e8f0;">
                            <span style="color: #64748b; font-size: 13px;">Referencia</span>
                            <span style="color: #0f172a; font-size: 14px; font-weight: 700; font-family: monospace;">${reference}</span>
                        </div>
                        <div style="display: flex; justify-content: space-between; padding: 8px 0;">
                            <span style="color: #64748b; font-size: 13px;">Válido hasta</span>
                            <span style="color: #0f172a; font-size: 14px; font-weight: 700;">${expiryStr}</span>
                        </div>
                    </div>
                    <p style="color: #64748b; font-size: 13px; line-height: 1.6; margin-bottom: 20px;">Guarda este correo como comprobante de tu pago. Si tienes algún inconveniente, responde a este mensaje y te ayudamos.</p>
                    <div style="text-align: center;">
                        <a href="${panelUrl}" style="background: #059669; color: white; padding: 14px 32px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 15px; display: inline-block;">Ir a mi panel</a>
                    </div>
                </div>
            </div>
        `;

        await resend.emails.send({
            from: FROM_EMAIL,
            to: user.email,
            subject: `✅ Pago confirmado · Plan ${planLabel} activado`,
            html
        });
        console.log(`✅ [EMAIL] Confirmación de pago enviada a ${user.email} (plan ${planKey})`);
    } catch (err) {
        console.error('⚠️ [EMAIL] No se pudo enviar confirmación de pago:', err.message);
    }
}

// Avisa a los admins de un reporte manual (fire-and-forget, no rompe la conciliación)
async function notifyAdminsOfReport(order, reporterData) {
    try {
        const admins = await pool.query("SELECT email FROM users WHERE role = 'admin' AND email IS NOT NULL");
        if (admins.rows.length === 0) return;

        // Todo calculado FUERA del template: a prueba de pegado.
        const planLabel = (order.plan || '').toUpperCase();
        const moneyStr = formatMoney(order.expected_amount, order.currency);
        const channelLabel = CHANNEL_LABELS[order.channel] || 'transferencia';
        const ref = order.reference_code || '—';
        const txRef = reporterData.transaction_reference || '—';
        const reportedRef = reporterData.reported_reference || '—';
        const reportedAmount = (reporterData.reported_amount != null && reporterData.reported_amount !== '') ? reporterData.reported_amount : '—';
        const panelUrl = process.env.FRONTEND_URL || 'https://www.globalfotoapp.com';
        const subject = `🔔 Reporte de pago pendiente de revisión · Plan ${planLabel}`;

        const html = `
            <div style="font-family:'Inter',sans-serif;max-width:600px;margin:0 auto;padding:20px;">
                <div style="background:#0f172a;padding:24px;border-radius:12px 12px 0 0;text-align:center;">
                    <h1 style="color:#fff;margin:0;font-size:20px;">🔔 Nuevo reporte de pago</h1>
                    <p style="color:#94a3b8;margin:6px 0 0;font-size:13px;">Un fotógrafo reportó un pago manualmente. Requiere tu revisión.</p>
                </div>
                <div style="background:#fff;padding:24px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 12px 12px;">
                    <table style="width:100%;border-collapse:collapse;font-size:14px;">
                        <tr><td style="padding:8px 0;color:#64748b;">Orden</td><td style="padding:8px 0;text-align:right;font-weight:700;color:#0f172a;">#${order.id}</td></tr>
                        <tr><td style="padding:8px 0;color:#64748b;">Plan</td><td style="padding:8px 0;text-align:right;font-weight:700;color:#0f172a;">${planLabel}</td></tr>
                        <tr><td style="padding:8px 0;color:#64748b;">Monto esperado</td><td style="padding:8px 0;text-align:right;font-weight:700;color:#0f172a;">${moneyStr}</td></tr>
                        <tr><td style="padding:8px 0;color:#64748b;">Canal</td><td style="padding:8px 0;text-align:right;color:#0f172a;">${channelLabel}</td></tr>
                        <tr><td style="padding:8px 0;color:#64748b;">Código GF</td><td style="padding:8px 0;text-align:right;font-family:monospace;color:#0f172a;">${ref}</td></tr>
                        <tr><td style="padding:8px 0;color:#64748b;">Monto reportado</td><td style="padding:8px 0;text-align:right;color:#0f172a;">${reportedAmount}</td></tr>
                        <tr><td style="padding:8px 0;color:#64748b;">Ref usada</td><td style="padding:8px 0;text-align:right;font-family:monospace;color:#0f172a;">${reportedRef}</td></tr>
                        <tr><td style="padding:8px 0;color:#64748b;">Nº transacción</td><td style="padding:8px 0;text-align:right;font-family:monospace;color:#0f172a;">${txRef}</td></tr>
                    </table>
                    <p style="color:#64748b;font-size:13px;line-height:1.6;margin:18px 0 0;">Verifica el comprobante bancario. Si el pago es real, apruébalo desde el panel; el webhook también lo activará solo si el dinero entra por MacroDroid.</p>
                    <div style="text-align:center;margin-top:18px;">
                        <a href="${panelUrl}" style="background:#6366f1;color:#fff;padding:12px 28px;text-decoration:none;border-radius:8px;font-weight:600;font-size:14px;display:inline-block;">Revisar en el panel</a>
                    </div>
                </div>
            </div>
        `;

        for (const a of admins.rows) {
            resend.emails.send({ from: FROM_EMAIL, to: a.email, subject, html })
                .catch(e => console.error('⚠️ [EMAIL admin] fallo:', e.message));
        }
        console.log(`🔔 [REPORT] Orden ${order.id} reportada manualmente; notificamos a ${admins.rows.length} admin(es).`);
    } catch (err) {
        console.error('⚠️ [REPORT] No se pudo notificar admins:', err.message);
    }
}

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
        
        let rate = 1;
        if (currency === 'VES') {
            rate = await getCurrentRate('VES_RATE');
        }
        
        const plansOut = Object.keys(PLANS).map(key => {
            const baseUsd = PLANS[key].usd;
            let price;
            
            if (currency === 'VES') {
                price = +(baseUsd * rate).toFixed(2);
            } else if (currency === 'COP') {
                price = PLANS[key].cop;
            } else {
                price = baseUsd;
            }
            
            return {
                key,
                name: key.charAt(0).toUpperCase() + key.slice(1),
                price,
                currency,
                exchange_rate: currency === 'VES' ? rate : null
            };
        });

        res.json({ plans: plansOut, currency });
    } catch (error) {
        console.error('Error obteniendo planes:', error);
        res.status(500).json({ error: 'Error interno: ' + error.message });
    }
});

// === RANKING DE PLANES (independiente de moneda/tasa) ===
const PLAN_RANK = { basic: 1, pro: 2, studio: 3 };

/**
 * Decide el tipo de ajuste y el monto a cobrar según el cambio de plan.
 * precioActual = 0 cuando viene de trial o no tiene plan (no se regala crédito).
 */
function calcularAjuste(planActualKey, planNuevoKey, diasRestantes, precioActual, precioNuevo) {
    const rankActual = PLAN_RANK[planActualKey] || 0;
    const rankNuevo = PLAN_RANK[planNuevoKey] || 0;

    // Downgrade: no permitido en este ciclo (se aplica al expirar el plan caro)
    if (rankNuevo < rankActual) {
        return { tipo: 'downgrade', monto: 0, credito: 0, precioOriginal: precioNuevo, diasRestantes };
    }

    // Upgrade: descuento proporcional de los días no usados del plan viejo
    if (rankNuevo > rankActual) {
        const credito = (Math.max(0, diasRestantes) / 30) * precioActual;
        const monto = Math.max(0, precioNuevo - credito);
        return { tipo: 'upgrade', monto: +monto.toFixed(2), credito: +credito.toFixed(2), precioOriginal: +precioNuevo.toFixed(2), diasRestantes };
    }

    // Renovación del mismo plan: cobro completo (los días restantes se suman al final en activateUserPlan)
    return { tipo: 'renovacion', monto: +precioNuevo.toFixed(2), credito: 0, precioOriginal: +precioNuevo.toFixed(2), diasRestantes };
}

// POST /api/subscriptions/order
router.post('/order', verifyToken, async (req, res) => {
    try {
        const { plan } = req.body;
        if (!plan) return res.status(400).json({ error: 'Falta el plan.' });
        if (!PLAN_RANK[plan]) return res.status(400).json({ error: 'Plan inválido.' });

        const userResult = await pool.query('SELECT currency, country, plan, plan_expires_at, is_trial FROM users WHERE id = $1', [req.user.id]);
        if (userResult.rows.length === 0) return res.status(404).json({ error: 'Usuario no encontrado.' });

        const { currency, country, plan: planActual, plan_expires_at, is_trial: userIsTrial } = userResult.rows[0];

        let channel = 'zinli';
        if (country === 'VE') channel = 'pagomovil';
        else if (country === 'CO') channel = 'nequi';

        // Tasa vigente (solo afecta VES). DECLARADA AQUÍ arriba, por eso ya no da "rate is not defined".
        const rate = currency === 'VES' ? await getCurrentRate('VES_RATE') : 1;

        const precioNuevo = currency === 'VES'
            ? +(PLANS[plan].usd * rate).toFixed(2)
            : (PLANS[plan][currency.toLowerCase()] || PLANS[plan].usd);

        const precioActual = (!userIsTrial && planActual && planActual !== 'trial' && PLAN_RANK[planActual])
            ? (currency === 'VES' ? +(PLANS[planActual].usd * rate).toFixed(2) : (PLANS[planActual][currency.toLowerCase()] || PLANS[planActual].usd))
            : 0;

        let diasRestantes = 0;
        if (plan_expires_at) {
            const diff = new Date(plan_expires_at).getTime() - Date.now();
            diasRestantes = Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
        }

        const ajuste = calcularAjuste(planActual, plan, diasRestantes, precioActual, precioNuevo);

        if (ajuste.tipo === 'downgrade') {
            const fechaExp = plan_expires_at
                ? new Date(plan_expires_at).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' })
                : 'la fecha indicada';
            return res.status(400).json({
                error: `Tu plan ${(planActual || '').toUpperCase()} está activo hasta el ${fechaExp}. Para bajar de plan, espera a que expire tu periodo actual o renuévalo al mismo nivel. Si necesitas ayuda, escríbenos.`
            });
        }

        const order = await createSubscriptionOrderWithBase(req.user.id, plan, { currency, channel }, ajuste.monto);

        res.status(201).json({
            message: 'Orden creada.',
            order: {
                id: order.id,
                expected_amount: Number(order.expected_amount),
                reference_code: sanitizeRefCode(order.reference_code),
                currency: order.currency,
                channel: order.channel,
                expires_at: order.expires_at,
                proration: ajuste,
                instructions: getInstructions(channel, Number(order.expected_amount), currency, sanitizeRefCode(order.reference_code))
            }
        });

    } catch (error) {
        console.error('Error creando orden:', error);
        res.status(500).json({ error: error.message || 'Error interno al crear la orden.' });
    }
});

async function createSubscriptionOrderWithBase(userId, planKey, countryMeta, customBase) {
    const plan = PLANS[planKey];
    if (!plan) throw new Error('Plan inválido.');

    const currency = String(countryMeta.currency || '').toUpperCase();
    const base = typeof customBase === 'number' ? customBase : (plan[currency.toLowerCase()] ?? plan.usd);
    
    if (isNaN(base) || base <= 0) throw new Error(`Precio base inválido: ${base}`);

    const recentOrders = await pool.query(
        `SELECT expected_amount FROM subscription_orders 
         WHERE currency = $1 AND plan = $2 AND status IN ('pending','reported') 
           AND created_at > NOW() - INTERVAL '30 minutes'`,
        [currency, planKey]
    );
    const taken = new Set(recentOrders.rows.map(r => parseFloat(r.expected_amount)));

    const gen = generateUniqueAmount(base, currency, taken);
    if (!gen) throw new Error('Sistema saturado de pagos pendientes. Intenta de nuevo en unos minutos.');

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
    if (currency === 'USD') maxSuffix = 10;
    else if (currency === 'COP') maxSuffix = 100;
    else maxSuffix = 100;

    for (let i = 0; i < maxSuffix; i++) {
        const candidate = +(parseFloat(base) + i * (currency === 'USD' ? 0.01 : 1)).toFixed(4);
        if (!takenSuffixes.has(candidate)) {
            return { expected: candidate, suffix: i };
        }
    }
    return null;
}

function generateCleanReferenceCode() {
    const chars = crypto.randomBytes(6).toString('hex').toUpperCase().slice(0, 6);
    return `GF${chars}`;
}

function sanitizeRefCode(code) {
    return String(code || '').replace(/[^A-Z0-9]/gi, '').toUpperCase().slice(0, 10);
}

// --- CONCILIACIÓN AUTOMÁTICA (WEBHOOK) ---
router.post('/webhook', async (req, res) => {
    const secret = req.headers['x-webhook-secret'];
    if (secret !== process.env.WEBHOOK_SECRET) return res.status(401).json({ error: 'Secret invalido' });

    const { amount, currency, reference_text } = req.body;
    
    const cleanAmount = parseFloat(amount);
    const cleanRef = String(reference_text || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');

    try {
        let matchedOrder = null;
        
        if (cleanRef.startsWith('GF') && cleanRef.length >= 6) {
            const foundByCode = await pool.query(
                `UPDATE subscription_orders SET status='paid', paid_at=NOW(), webhook_raw=$1 
                 WHERE reference_code=$2 AND expected_amount=$3 AND currency=$4 AND status IN ('pending','reported')  
                 RETURNING *`,
                [JSON.stringify(req.body), cleanRef, cleanAmount, currency]
            );
            if (foundByCode.rows.length > 0) matchedOrder = foundByCode.rows[0];
        }

        if (!matchedOrder) {
            const foundByAmount = await pool.query(
                `UPDATE subscription_orders SET status='paid', paid_at=NOW(), webhook_raw=$1 
                 WHERE expected_amount=$2 AND currency=$3 AND status IN ('pending','reported') 
                   AND created_at > NOW() - INTERVAL '30 minutes'
                 LIMIT 1 RETURNING *`,
                [JSON.stringify(req.body), cleanAmount, currency]
            );
            if (foundByAmount.rows.length > 0) matchedOrder = foundByAmount.rows[0];
        }

        if (matchedOrder) {
            await activateUserPlan(matchedOrder.user_id, matchedOrder.plan);
            console.log(`✅ Pago confirmado automáticamente para orden ${matchedOrder.id}`);
            sendPaymentConfirmationEmail(matchedOrder.user_id, matchedOrder.plan, {
                amount: Number(matchedOrder.expected_amount),
                currency: matchedOrder.currency,
                reference: matchedOrder.reference_code,
                channel: matchedOrder.channel
            }).catch(err => console.error('⚠️ [EMAIL] fallo en background (webhook):', err.message));
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
    const { order_id, reported_amount, reported_reference, transaction_reference } = req.body;
    try {
        // El reporte manual YA NO activa el plan: solo marca la orden 'reported' y avisa al admin.
        // La activación automática la decide el webhook (dinero real) o el admin a mano.
        const orderCheck = await pool.query(
            `SELECT * FROM subscription_orders WHERE id=$1 AND user_id=$2 AND status IN ('pending','reported')`,
            [order_id, req.user.id]
        );
        if (orderCheck.rows.length === 0) return res.status(404).json({ error: 'No encontramos una orden tuya pendiente con esos datos.' });

        const order = orderCheck.rows[0];
        const cleanReportedAmount = parseFloat(reported_amount);
        const cleanReportedRef = String(reported_reference || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
        const cleanTxRef = String(transaction_reference || '').trim();

        let isMatch = false;
        if (cleanReportedRef.startsWith('GF') && cleanReportedRef === order.reference_code) isMatch = true;
        if (!isMatch && !isNaN(cleanReportedAmount) && Math.abs(cleanReportedAmount - parseFloat(order.expected_amount)) < 0.01) isMatch = true;

        if (!isMatch) {
            return res.status(400).json({ error: 'Los datos reportados no coinciden con tu orden. Revisa el monto exacto o el código de referencia.' });
        }

        await pool.query(
            `UPDATE subscription_orders SET status='reported', reference_note=$1, webhook_raw=$2 WHERE id=$3`,
            [`Reporte manual | TxRef: ${cleanTxRef} | Ref usada: ${reported_reference || '—'} | Monto reportado: ${reported_amount || '—'}`,
             JSON.stringify({ transaction_reference: cleanTxRef, reported_amount, reported_reference }),
             order.id]
        );

        notifyAdminsOfReport(order, { transaction_reference: cleanTxRef, reported_amount, reported_reference })
            .catch(err => console.error('⚠️ [REPORT] fallo notificando admins:', err.message));

        // reported:true le dice al frontend que muestre "reporte recibido", NO "plan activado".
        return res.json({ success: true, reported: true, message: 'Reporte recibido. Verificaremos tu pago con el comprobante y te avisaremos por correo en cuanto el plan esté activo.' });
    } catch (err) {
        console.error('Error en reporte manual:', err);
        res.status(500).json({ error: 'Error interno.' });
    }
});

// GET /api/subscriptions/history
router.get('/history', verifyToken, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT id, plan, currency, channel, base_amount, expected_amount, reference_code, status, created_at, paid_at
             FROM subscription_orders 
             WHERE user_id = $1 
             ORDER BY created_at DESC 
             LIMIT 20`,
            [req.user.id]
        );
        
        const orders = result.rows.map(o => ({
            ...o,
            base_amount: Number(o.base_amount),
            expected_amount: Number(o.expected_amount)
        }));

        res.json({ orders });
    } catch (error) {
        console.error('Error obteniendo historial:', error);
        res.status(500).json({ error: 'Error interno.' });
    }
});

// POST /api/subscriptions/cancel
router.post('/cancel', verifyToken, async (req, res) => {
    try {
        const userCheck = await pool.query('SELECT plan, plan_expires_at FROM users WHERE id = $1', [req.user.id]);
        if (userCheck.rows.length === 0 || !userCheck.rows[0].plan || userCheck.rows[0].plan === 'trial') {
            return res.status(400).json({ error: 'No tienes una suscripción activa para cancelar.' });
        }

        await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS auto_renew BOOLEAN DEFAULT TRUE`);
        await pool.query(`UPDATE users SET auto_renew = FALSE WHERE id = $1`, [req.user.id]);

        console.log(`🚫 Usuario ${req.user.id} solicitó cancelación de renovación automática.`);
        
        res.json({ success: true, message: 'Renovación automática desactivada. Tu plan seguirá activo hasta la fecha de expiración.' });
    } catch (error) {
        console.error('Error cancelando suscripción:', error);
        res.status(500).json({ error: 'Error interno.' });
    }
});

// POST /api/subscriptions/reactivate
router.post('/reactivate', verifyToken, async (req, res) => {
    try {
        await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS auto_renew BOOLEAN DEFAULT TRUE`);
        await pool.query(`UPDATE users SET auto_renew = TRUE WHERE id = $1`, [req.user.id]);
        res.json({ success: true, message: 'Renovación automática reactivada.' });
    } catch (error) {
        console.error('Error reactivando:', error);
        res.status(500).json({ error: 'Error interno.' });
    }
});

async function activateUserPlan(userId, planKey) {
    const cur = await pool.query('SELECT plan, plan_expires_at FROM users WHERE id = $1', [userId]);
    const row = cur.rows[0];
    const now = new Date();

    // Renovación anticipada del MISMO plan: suma 30 días al final del periodo actual (no pierde días).
    // Upgrade / plan nuevo / expirado: ciclo nuevo desde hoy.
    let baseDate = now;
    if (row && row.plan === planKey && row.plan_expires_at && new Date(row.plan_expires_at) > now) {
        baseDate = new Date(row.plan_expires_at);
    }
    const newExp = new Date(baseDate.getTime() + 30 * 24 * 60 * 60 * 1000);

    // Pagar = salir de prueba: is_trial = FALSE, auto_renew = TRUE.
    await pool.query(
        `UPDATE users SET plan = $1, plan_started_at = CURRENT_TIMESTAMP, plan_expires_at = $2, auto_renew = TRUE, is_trial = FALSE WHERE id = $3`,
        [planKey, newExp, userId]
    );
}

function getInstructions(channel, amount, currency, refCode) {
    let amtStr;
    if (currency === 'VES') amtStr = `Bs. ${amount.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    else if (currency === 'COP') amtStr = `$${Math.round(amount).toLocaleString('es-CO')} COP`;
    else amtStr = `$${amount.toFixed(2)} USD`;
    
    const codeStr = `TU CÓDIGO DE REFERENCIA ES: ${refCode}`;
    
    let intro = "";
    let bankInfo = "";
    
    if (channel === 'nequi') {
        intro = `Transfiere EXACTAMENTE ${amtStr} a nuestro Nequi institucional.`;
        bankInfo = `\n\n📱 NEQUI:\nNúmero: ${BANK_DATA.nequi.number}\nTitular: ${BANK_DATA.nequi.name}`;
    } else if (channel === 'pagomovil') {
        intro = `Realiza Pago Móvil por ${amtStr}.`;
        bankInfo = `\n\n🏦 BANCO VENEZOLANO DE CRÉDITO:\nCuenta: ${BANK_DATA.pagomovil.account}\nTeléfono: ${BANK_DATA.pagomovil.phone}\nTitular: ${BANK_DATA.pagomovil.name}`;
    } else {
        intro = `Genera un cobro o transferencia en Zinli por ${amtStr}.`;
        bankInfo = `\n\n💳 ZINLI:\nLink directo: ${BANK_DATA.zinli.link}`;
    }

    return `${intro}${bankInfo}\n\n${codeStr}\n\nIMPORTANTE: Copia este código y pégalo en el campo "Concepto", "Mensaje" o "Referencia" al momento de pagar.\nSi olvidas el código, asegúrate de transferir el MONTO EXACTO (${amtStr}).`;
}

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