// src/lib/exchangeRate.js
// Baja la tasa oficial BCV que GlobalFoto usa para pasar de "$-etiqueta" a Bs.
// Fuente primaria: EURO oficial (protege el valor al convertir a stablecoin, y es legal).
// Si el euro no responde, cae a DÓLAR oficial (legal, pero rinde menos). Si nada responde,
// usa un default ESTIMADO y avisa fuerte en logs para que lo corrijas a mano.
const pool = require('../db');
const https = require('https');

const RATE_KEY = 'VES_RATE';          // clave interna neutra: "la tasa que aplico"
const DEFAULT_RATE = 962;             // estimado euro-oficial; solo emergencia si la API cae

// Fuentes en orden de preferencia. La primera que devuelva un promedio válido gana.
const SOURCES = [
    { url: 'https://ve.dolarapi.com/v1/euros/oficial',   label: 'euro oficial BCV' },
    { url: 'https://ve.dolarapi.com/v1/dolares/oficial', label: 'dólar oficial BCV (fallback legal)' },
];

function httpGetJson(url) {
    return new Promise((resolve, reject) => {
        https.get(url, { timeout: 10000 }, (res) => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
                try { resolve(JSON.parse(data)); }
                catch (e) { reject(new Error(`JSON inválido: ${e.message}`)); }
            });
        }).on('error', e => reject(new Error(`Error red: ${e.message}`)));
    });
}

// Extrae el "promedio" tanto si viene objeto plano como si viene en array.
function extractPromedio(json) {
    const r = parseFloat(json?.promedio ?? json?.[0]?.promedio);
    return (!isNaN(r) && r > 0) ? r : null;
}

async function fetchOfficialRate() {
    for (const src of SOURCES) {
        try {
            const json = await httpGetJson(src.url);
            const rate = extractPromedio(json);
            if (rate) return { rate, source: `dolarapi:${src.label}` };
            console.warn(`⚠️ ${src.url} respondió sin 'promedio' válido, probando siguiente...`);
        } catch (e) {
            console.warn(`⚠️ ${src.label} falló (${e.message}), probando siguiente...`);
        }
    }
    return null; // ninguna fuente respondió
}

async function updateExchangeRate() {
    const fetched = await fetchOfficialRate();

    if (fetched) {
        await pool.query(`
            INSERT INTO exchange_rates (currency_pair, rate, source, fetched_at)
            VALUES ($1, $2, $3, NOW())
            ON CONFLICT (currency_pair)
            DO UPDATE SET rate = $2, source = $3, fetched_at = NOW()
        `, [RATE_KEY, fetched.rate, fetched.source]);
        console.log(`✅ Tasa oficial actualizada: ${fetched.rate} (${fetched.source})`);
        return fetched.rate;
    }

    // Sin API: intenta la última conocida; si no hay, default estimado + alerta ruidosa.
    const last = await getLastKnownRate();
    if (last) {
        console.log(`⚠️ API caída. Usando última tasa conocida: ${last}`);
        return last;
    }
    console.error(`🚨 API caída y sin historial. Usando DEFAULT ESTIMADO ${DEFAULT_RATE}. ` +
                  `Corrígela a mano o verifica la fuente. Los precios en Bs. pueden estar desfasados.`);
    return DEFAULT_RATE;
}

async function getCurrentRate() {
    const result = await pool.query(
        'SELECT rate FROM exchange_rates WHERE currency_pair = $1 ORDER BY fetched_at DESC LIMIT 1',
        [RATE_KEY]
    );
    if (result.rows.length === 0) {
        console.error(`🚨 No hay tasa ${RATE_KEY} en BD. Devolviendo default ${DEFAULT_RATE}.`);
        return DEFAULT_RATE;
    }
    return parseFloat(result.rows[0].rate);
}

async function getLastKnownRate() {
    const result = await pool.query(
        'SELECT rate FROM exchange_rates WHERE currency_pair = $1 ORDER BY fetched_at DESC LIMIT 1',
        [RATE_KEY]
    );
    return result.rows.length > 0 ? parseFloat(result.rows[0].rate) : null;
}

module.exports = { updateExchangeRate, getCurrentRate };