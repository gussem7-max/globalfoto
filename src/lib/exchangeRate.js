// src/lib/exchangeRate.js
const pool = require('../db');
const https = require('https');

/**
 * Obtiene la tasa EUR→VES desde MonitorLatam (fuente confiable, gratuita).
 * Fallback a PyDolarVE si falla.
 */
async function fetchEurusdRate() {
    return new Promise((resolve, reject) => {
        // Intento 1: MonitorLatam API pública
        const monitorUrl = 'https://api.monitorlatam.com/v1/rates/latest';
        
        https.get(monitorUrl, { timeout: 10000 }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    // Buscar EUR→VES específicamente
                    const eurVes = json.rates?.find(r => r.from === 'EUR' && r.to === 'VES');
                    if (eurVes && eurVes.rate > 0) {
                        resolve({ rate: parseFloat(eurVes.rate), source: 'monitorlatam' });
                    } else {
                        throw new Error('Par EUR_VES no encontrado en respuesta');
                    }
                } catch (e) {
                    console.warn('MonitorLatam falló:', e.message);
                    // Fallback: PyDolarVE
                    fetchPyDolarVe().then(resolve).catch(reject);
                }
            });
        }).on('error', (e) => {
            console.warn('Error red MonitorLatam:', e.message);
            fetchPyDolarVe().then(resolve).catch(reject);
        });
    });
}

function fetchPyDolarVe() {
    return new Promise((resolve, reject) => {
        const url = 'https://pydolarve.org/api/v1/dollar?page=criptodolar';
        https.get(url, { timeout: 10000 }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    // PyDolarVE retorna USD principalmente; estimamos EUR≈USD*0.92
                    const usdVes = json.monitor?.average || json.enparalelovzla?.price || 0;
                    if (usdVes > 0) {
                        const estimatedEurVes = usdVes * 0.92; // aproximación conservadora
                        resolve({ rate: estimatedEurVes, source: 'pydolarve_estimated' });
                    } else {
                        throw new Error('No se pudo extraer tasa válida');
                    }
                } catch (e) {
                    reject(new Error(`Ambas fuentes fallaron: ${e.message}`));
                }
            });
        }).on('error', (e) => reject(new Error(`Error red PyDolarVE: ${e.message}`)));
    });
}

/**
 * Actualiza la tasa en BD. Retorna la tasa vigente.
 */
async function updateExchangeRate() {
    try {
        const { rate, source } = await fetchEurusdRate();
        
        await pool.query(`
            INSERT INTO exchange_rates (currency_pair, rate, source, fetched_at)
            VALUES ($1, $2, $3, NOW())
            ON CONFLICT (currency_pair) 
            DO UPDATE SET rate = $2, source = $3, fetched_at = NOW()
        `, ['EUR_VES', rate, source]);
        
        console.log(`✅ Tasa EUR→VES actualizada: ${rate} (${source})`);
        return rate;
    } catch (err) {
        console.error('❌ Error actualizando tasa:', err.message);
        // Si falla, retornamos la última conocida de BD
        const lastKnown = await getLastKnownRate();
        if (lastKnown) {
            console.log(`⚠️ Usando última tasa conocida: ${lastKnown}`);
            return lastKnown;
        }
        throw err;
    }
}

/**
 * Lee la tasa vigente desde BD (sin hacer fetch externo).
 */
async function getCurrentRate(currencyPair = 'EUR_VES') {
    const result = await pool.query(
        'SELECT rate FROM exchange_rates WHERE currency_pair = $1 ORDER BY fetched_at DESC LIMIT 1',
        [currencyPair]
    );
    if (result.rows.length === 0) {
        throw new Error(`No hay tasa registrada para ${currencyPair}. Corre updateExchangeRate() primero.`);
    }
    return parseFloat(result.rows[0].rate);
}

async function getLastKnownRate() {
    const result = await pool.query(
        'SELECT rate FROM exchange_rates WHERE currency_pair = $1 ORDER BY fetched_at DESC LIMIT 1',
        ['EUR_VES']
    );
    return result.rows.length > 0 ? parseFloat(result.rows[0].rate) : null;
}

module.exports = { updateExchangeRate, getCurrentRate };