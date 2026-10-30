// src/lib/subscription.js
const pool = require('../db');
const crypto = require('crypto');

// === CATÁLOGO DE PLANES Y PRECIOS BASE ===
// USD usa .90 para dejar el último dígito libre (sufijo 0-9).
// VES/COP usan montos grandes, permitiendo sufijos amplios.
const PLANS = {
    basic:  { usd: 6.90, cop: 30000, ves: 250 },
    pro:    { usd: 15.90, cop: 65000, ves: 550 },
    studio: { usd: 24.90, cop: 100000, ves: 850 }
};

// === LÍMITES DE PLAN (eventos y fotos) ===
const PLAN_LIMITS = {
    trial:  { eventos: 1,    fotos: 100   },
    basic:  { eventos: 5,    fotos: 1500  },
    pro:    { eventos: null, fotos: 10000 },
    studio: { eventos: null, fotos: null  },
};

/** Convierte cualquier cosa a número seguro. Si no puede, lanza error claro. */
function toNum(v, label) {
    const n = parseFloat(v);
    if (isNaN(n)) throw new Error(`Valor no numérico para ${label}: "${v}"`);
    return n;
}

/** Genera un código corto único tipo "GF-XXXX" */
function generateReferenceCode() {
    const chars = crypto.randomBytes(4).toString('hex').toUpperCase().slice(0, 4);
    return `GF-${chars}`;
}

/** Genera un monto esperado ÚNICO sumando un sufijo al precio base. */
function generateUniqueAmount(base, currency, takenSuffixes) {
    let maxSuffix;
    if (currency === 'USD') maxSuffix = 10;       // 0..9 (decimales)
    else if (currency === 'COP') maxSuffix = 100; // 0..99
    else maxSuffix = 100;                        // VES

    for (let i = 0; i < maxSuffix; i++) {
        const candidate = +(toNum(base, 'base') + i * (currency === 'USD' ? 0.01 : 1)).toFixed(4);
        if (!takenSuffixes.has(candidate)) {
            return { expected: candidate, suffix: i };
        }
    }
    return null;
}

/** Crea una nueva orden de suscripción pendiente. */
async function createSubscriptionOrder(userId, planKey, countryMeta) {
    const plan = PLANS[planKey];
    if (!plan) throw new Error('Plan inválido.');

    const currency = String(countryMeta.currency || '').toUpperCase();
    if (!['USD', 'COP', 'VES'].includes(currency)) throw new Error(`Moneda no soportada: ${currency}`);

    // Obtener base YA COMO NÚMERO (evita concatenación accidental con strings)
    const baseRaw = plan[currency.toLowerCase()] ?? plan.usd;
    const base = toNum(baseRaw, `precio_base_${planKey}_${currency}`);

    // 1. Buscar qué sufijos están ocupados AHORA MISMO (últimos 30 min)
    const recentOrders = await pool.query(
        `SELECT expected_amount FROM subscription_orders 
         WHERE currency = $1 AND plan = $2 AND status = 'pending' 
           AND created_at > NOW() - INTERVAL '30 minutes'`,
        [currency, planKey]
    );
    // Convertir cada fila a número ANTES de meterla al Set (Postgres devuelve strings)
    const taken = new Set(recentOrders.rows.map(r => toNum(r.expected_amount, 'recent_expected')));

    // 2. Generar monto único
    const gen = generateUniqueAmount(base, currency, taken);
    if (!gen) throw new Error('Sistema saturado de pagos pendientes. Intenta de nuevo en unos minutos.');

    // 3. Generar código de referencia único
    let refCode = generateReferenceCode();
    let attempts = 0;
    while (attempts < 5) {
        const exists = await pool.query('SELECT 1 FROM subscription_orders WHERE reference_code = $1', [refCode]);
        if (exists.rows.length === 0) break;
        refCode = generateReferenceCode();
        attempts++;
    }

    // 4. Insertar orden — passing numbers explicitly avoids type coercion issues
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 minutos
    
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
    // Normalizar TODOS los campos numéricos/string antes de devolverlos
    return {
        ...row,
        base_amount: Number(row.base_amount),
        expected_amount: Number(row.expected_amount),
        suffix: Number(row.suffix)
    };
}

/**
 * Lee los límites de plan del usuario (eventos y fotos).
 * Plan VIGENTE (no expirado) usa sus límites; expirado o sin fecha cae a 'trial'.
 * El trial-por-plan (plan='pro', is_trial=true, fecha futura) hereda límites de Pro.
 */
async function getUserPlanLimits(userId) {
    const r = await pool.query('SELECT plan, plan_expires_at FROM users WHERE id = $1', [userId]);
    const row = r.rows[0] || {};
    const vigente = row.plan_expires_at && new Date(row.plan_expires_at) > new Date();
    const key = (vigente && PLAN_LIMITS[row.plan]) ? row.plan : 'trial';
    const lim = PLAN_LIMITS[key];
    const label = key === 'trial' ? (row.plan === 'trial' ? 'Prueba' : 'Prueba/Expirado') : key.toUpperCase();
    return { maxEventos: lim.eventos, maxFotos: lim.fotos, planKey: key, planLabel: label };
}

module.exports = { PLANS, PLAN_LIMITS, createSubscriptionOrder, getUserPlanLimits };