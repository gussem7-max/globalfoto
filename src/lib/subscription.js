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

/**
 * Genera un código corto único tipo "GF-XXXX"
 * Máximo 7 caracteres para caber en conceptos bancarios limitados.
 */
function generateReferenceCode() {
    // 4 caracteres alfanuméricos mayúsculos (base 36 -> A-Z, 0-9)
    const chars = crypto.randomBytes(4).toString('hex').toUpperCase().slice(0, 4);
    return `GF-${chars}`;
}

/**
 * Genera un monto esperado ÚNICO sumando un sufijo al precio base.
 */
function generateUniqueAmount(base, currency, takenSuffixes) {
    let maxSuffix;
    if (currency === 'USD') maxSuffix = 10;       // 0..9 (decimales)
    else if (currency === 'COP') maxSuffix = 100; // 0..99
    else maxSuffix = 100;                        // VES

    for (let i = 0; i < maxSuffix; i++) {
        const candidate = +(base + i * (currency === 'USD' ? 0.01 : 1)).toFixed(4);
        if (!takenSuffixes.has(candidate)) {
            return { expected: candidate, suffix: i };
        }
    }
    return null;
}

/**
 * Crea una nueva orden de suscripción pendiente.
 */
async function createSubscriptionOrder(userId, planKey, countryMeta) {
    const plan = PLANS[planKey];
    if (!plan) throw new Error('Plan inválido.');

    const currency = countryMeta.currency; 
    const base = plan[currency.toLowerCase()] || plan.usd; 
    
    // 1. Buscar qué sufijos están ocupados AHORA MISMO (últimos 30 min)
    const recentOrders = await pool.query(
        `SELECT expected_amount FROM subscription_orders 
         WHERE currency = $1 AND plan = $2 AND status = 'pending' 
           AND created_at > NOW() - INTERVAL '30 minutes'`,
        [currency, planKey]
    );
    const taken = new Set(recentOrders.rows.map(r => parseFloat(r.expected_amount)));

    // 2. Generar monto único
    const gen = generateUniqueAmount(base, currency, taken);
    if (!gen) throw new Error('Sistema saturado de pagos pendientes. Intenta de nuevo en unos minutos.');

    // 3. Generar código de referencia único (reintentar si choca, aunque es improbable)
    let refCode = generateReferenceCode();
    let attempts = 0;
    while (attempts < 5) {
        const exists = await pool.query('SELECT 1 FROM subscription_orders WHERE reference_code = $1', [refCode]);
        if (exists.rows.length === 0) break;
        refCode = generateReferenceCode();
        attempts++;
    }

    // 4. Insertar orden
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 minutos
    
    const result = await pool.query(
        `INSERT INTO subscription_orders 
         (user_id, plan, currency, channel, base_amount, expected_amount, suffix, reference_code, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING *`,
        [userId, planKey, currency, countryMeta.channel, base, gen.expected, gen.suffix, refCode, expiresAt]
    );

    return result.rows[0];
}

module.exports = { PLANS, createSubscriptionOrder };