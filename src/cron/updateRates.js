// src/cron/updateRates.js
require('dotenv').config();
const { updateExchangeRate } = require('../lib/exchangeRate');

console.log('🔄 Iniciando actualización de tasas...');

updateExchangeRate()
    .then(rate => console.log(`✅ Tasa actualizada correctamente: ${rate}`))
    .catch(err => console.error(`❌ Error fatal actualizando tasas:`, err));