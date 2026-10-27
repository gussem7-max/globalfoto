// src/lib/exchangeRate.js
const pool = require('../db');
const https = require('https');

/**
 * Obtiene la tasa USD→VES desde PyDolarVE o MonitorLatam.
 * Fallback a tasa manual si ambas fallan.
 */
async function fetchUsdVesRate() {
    return new Promise((resolve, reject) => {
        // Intento 1: PyDolarVE (fuente confiable venezolana)
        const pyDolarUrl = 'https://pydolarve.org/api/v1/dollar?page=criptodolar';
        
        https.get(pyDolarUrl, { timeout: 10000 }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    // Extraer promedio del dólar paralelo/BCV
                    const usdVes = json.monitor?.average || json.enparalelovzla?.price || 0;
                    if (usdVes > 0) {
                        resolve({ rate: parseFloat(usdVes), source: 'pydolarve' });
                    } else {
                        throw new Error('No se pudo extraer tasa válida de PyDolarVE');
                    }
                } catch (e) {
                    console.warn('PyDolarVE falló:', e.message);
                    // Fallback: MonitorLatam
                    fetchMonitorLatam().then(resolve).catch(reject);
                }
            });
        }).on('error', (e) => {
            console.warn('Error red PyDolarVE:', e.message);
            fetchMonitorLatam().then(resolve).catch(reject);
        });
    });
}

function fetchMonitorLatam() {
    return new Promise((resolve, reject) => {
        const url = 'https://api.monitorlatam.com/v1/rates/latest';
        https.get(url, { timeout: 10000 }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    const usdVes = json.rates?.find(r => r.from === 'USD' && r.to === 'VES');
                    if (usdVes && usdVes.rate > 0) {
                        resolve({ rate: parseFloat(usdVes.rate), source: 'monitorlatam' });
                    } else {
                        throw new Error('Par USD_VES no encontrado');
                    }
                } catch (e) {
                    reject(new Error(`Ambas fuentes fallaron: ${e.message}`));
                }
            });
        }).on('error', (e) => reject(new Error(`Error red MonitorLatam: ${e.message}`)));
    });
}

/**
 * Actualiza la tasa en BD. Retorna la tasa vigente.
 */
async function updateExchangeRate() {
    try {
        const { rate, source } = await fetchUsdVesRate();
        
        await pool.query(`
            INSERT INTO exchange_rates (currency_pair, rate, source, fetched_at)
            VALUES ($1, $2, $3, NOW())
            ON CONFLICT (currency_pair) 
            DO UPDATE SET rate = $2, source = $3, fetched_at = NOW()
        `, ['USD_VES', rate, source]);
        
        console.log(`✅ Tasa USD→VES actualizada: ${rate} (${source})`);
        return rate;
    } catch (err) {
        console.error('❌ Error actualizando tasa:', err.message);
        const lastKnown = await getLastKnownRate();
        if (lastKnown) {
            console.log(`⚠️ Usando última tasa conocida: ${lastKnown}`);
            return lastKnown;
        }
        throw err;
    }
}

/**
 * Lee la tasa vigente desde BD.
 */
async function getCurrentRate(currencyPair = 'USD_VES') {
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
        ['USD_VES']
    );
    return result.rows.length > 0 ? parseFloat(result.rows[0].rate) : null;
}

module.exports = { updateExchangeRate, getCurrentRate };