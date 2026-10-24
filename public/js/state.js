// =====================================================
// ESTADO GLOBAL COMPARTIDO
// =====================================================
let currentUser = null;
let cachedEvents = [];
let cachedPhotos = {};
let editingPricingId = null;
let cachedOrders = [];
let currentPublicEvent = null;
let selectedPhotos = new Set();

// Helpers de autenticación
function getToken() {
    return localStorage.getItem('token');
}

function authHeaders() {
    return { 'Authorization': `Bearer ${getToken()}` };
}

function jsonHeaders() {
    return { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getToken()}` };
}

function formatMoney(value) {
    return '$' + Number(value || 0).toLocaleString('es-CO');
}