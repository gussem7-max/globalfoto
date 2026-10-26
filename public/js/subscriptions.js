// public/js/subscriptions.js
let currentOrderId = null;
let pollInterval = null;

async function loadPlans() {
    const container = document.getElementById('planCards');
    if (!container) return;
    
    try {
        const res = await fetch('/api/subscriptions/plans', { headers: authHeaders() });
        const data = await res.json();
        
        if (!res.ok) throw new Error(data.error || 'Error cargando planes');
        
        const plansHtml = data.plans.map(plan => `
            <div class="plan-card ${plan.key === 'pro' ? 'popular' : ''}" onclick="selectPlan('${plan.key}')">
                <div class="plan-name">${plan.name}</div>
                <div class="plan-price">$${plan.price.toFixed(2)}</div>
                <div class="plan-currency">${plan.currency} / mes</div>
                <ul class="plan-features">
                    ${getFeaturesForPlan(plan.key)}
                </ul>
            </div>
        `).join('');
        
        container.innerHTML = plansHtml;
    } catch (err) {
        console.error('Error:', err);
        container.innerHTML = `<p style="color: var(--danger);">Error: ${err.message}</p>`;
    }
}

function getFeaturesForPlan(key) {
    const features = {
        basic: ['5 eventos activos', 'Hasta 1.500 fotos', 'Marca de agua automática', 'Galerías con expiración'],
        pro: ['Eventos ilimitados', 'Hasta 10.000 fotos', 'Verificación por selfie', 'QR con tu logo', 'Soporte prioritario'],
        studio: ['Eventos ilimitados', 'Fotos ilimitadas', 'Multi-cuenta equipo', 'Dominio personalizado', 'Soporte dedicado 24/7']
    };
    return (features[key] || []).map(f => `<li>${f}</li>`).join('');
}

async function selectPlan(planKey) {
    // Marcar visualmente el seleccionado
    document.querySelectorAll('.plan-card').forEach(c => c.classList.remove('selected'));
    event.currentTarget.classList.add('selected');
    
    try {
        const res = await fetch('/api/subscriptions/order', {
            method: 'POST',
            headers: { ...authHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify({ plan: planKey })
        });
        const data = await res.json();
        
        if (!res.ok) throw new Error(data.error || 'Error creando orden');
        
        showPaymentDetails(data.order);
    } catch (err) {
        alert('Error: ' + err.message);
    }
}

function showPaymentDetails(order) {
    currentOrderId = order.id;
    localStorage.setItem('pending_order_id', order.id); // Para retomar si cierra pestaña
    
    const detailsDiv = document.getElementById('paymentDetails');
    if (!detailsDiv) return;
    
    const amtStr = formatAmount(order.expected_amount, order.currency);
    const isZinli = order.channel === 'zinli';
    
    let html = `
        <h3 style="margin-bottom: 20px; color: var(--text-main);">Completa tu pago</h3>
        
        <div class="payment-row">
            <span class="payment-label">Monto exacto a transferir:</span>
            <span class="payment-value">
                ${amtStr}
                <button class="copy-btn" onclick="copyToClipboard('${order.expected_amount}', this)">📋</button>
            </span>
        </div>
        
        <div class="payment-row">
            <span class="payment-label">Código de referencia (concepto):</span>
            <span class="payment-value">
                <strong>${order.reference_code}</strong>
                <button class="copy-btn" onclick="copyToClipboard('${order.reference_code}', this)">📋</button>
            </span>
        </div>
        
        <div class="instructions-box">${escapeHtml(order.instructions)}</div>
    `;
    
    if (isZinli) {
        // Generar link de Zinli con monto incrustado (URL real dependerá de tu cuenta Zinli)
        // Ejemplo: https://pay.zin.li/your-username?amount=6.93&currency=USD
        const zinliUrl = `https://pay.zin.li/TU_USUARIO_ZINLI?amount=${order.expected_amount}&currency=${order.currency}`;
        html += `
            <a href="${zinliUrl}" target="_blank" class="zinli-link-btn">
                💳 Abrir cobro en Zinli (${amtStr})
            </a>
        `;
    }
    
    html += `
        <div class="waiting-screen" id="waitingScreen" style="display:none;">
            <div class="spinner-large"></div>
            <div class="waiting-text">Esperando tu pago de ${amtStr}...</div>
            <div class="waiting-subtext">No cierres esta ventana. Detectaremos el pago automáticamente.</div>
            <button class="manual-verify-btn" onclick="showManualVerifyForm()">✅ Ya pagué (Verificar manualmente)</button>
        </div>
        
        <div id="manualVerifyForm" style="display:none; margin-top: 20px; padding: 20px; background: rgba(2,6,23,0.6); border-radius: 12px;">
            <h4 style="color: var(--text-main); margin-bottom: 12px;">Reporta tu pago</h4>
            <div class="form-group">
                <label>Monto que transfiriste:</label>
                <input type="number" step="0.01" id="reportedAmount" placeholder="${order.expected_amount}" required>
            </div>
            <div class="form-group">
                <label>Código/referencia usada (opcional):</label>
                <input type="text" id="reportedRef" placeholder="${order.reference_code}">
            </div>
            <button class="btn-primary" onclick="submitManualVerification()">Enviar verificación</button>
        </div>
        
        <div class="success-message" id="successMessage" style="display:none;">
            <i class="fa-solid fa-circle-check success-icon"></i>
            <div class="success-title">¡Pago exitoso!</div>
            <div class="success-subtitle">Tu plan ha sido activado. Redirigiendo...</div>
        </div>
    `;
    
    detailsDiv.innerHTML = html;
    startPolling();
}

function formatAmount(amount, currency) {
    if (currency === 'USD') return `$${parseFloat(amount).toFixed(2)}`;
    if (currency === 'COP') return `${parseInt(amount).toLocaleString('es-CO')} COP`;
    if (currency === 'VES') return `Bs. ${parseFloat(amount).toFixed(2)}`;
    return amount;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML.replace(/\n/g, '<br>');
}

function copyToClipboard(text, btn) {
    navigator.clipboard.writeText(text).then(() => {
        btn.classList.add('copied');
        btn.innerHTML = '✓';
        setTimeout(() => {
            btn.classList.remove('copied');
            btn.innerHTML = '📋';
        }, 2000);
    }).catch(() => {
        // Fallback para navegadores antiguos
        const ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        btn.classList.add('copied');
        btn.innerHTML = '✓';
        setTimeout(() => { btn.classList.remove('copied'); btn.innerHTML = '📋'; }, 2000);
    });
}

function startPolling() {
    stopPolling(); // Limpiar intervalos previos
    pollInterval = setInterval(async () => {
        if (!currentOrderId) return;
        try {
            const res = await fetch(`/api/subscriptions/orders/${currentOrderId}/status`, { headers: authHeaders() });
            const data = await res.json();
            
            if (data.status === 'paid') {
                stopPolling();
                showSuccess();
                setTimeout(() => location.reload(), 3000);
            } else if (data.status === 'expired') {
                stopPolling();
                alert('La orden expiró. Por favor intenta de nuevo.');
                location.reload();
            }
        } catch (err) {
            console.error('Error polling:', err);
        }
    }, 4000); // Cada 4 segundos
}

function stopPolling() {
    if (pollInterval) clearInterval(pollInterval);
    pollInterval = null;
}

function showWaitingScreen() {
    document.getElementById('waitingScreen').style.display = 'block';
    document.querySelector('.zinli-link-btn')?.style.setProperty('display', 'none');
}

function showManualVerifyForm() {
    document.getElementById('manualVerifyForm').style.display = 'block';
}

async function submitManualVerification() {
    const amount = parseFloat(document.getElementById('reportedAmount').value);
    const ref = document.getElementById('reportedRef').value.trim();
    
    if (!amount) { alert('Ingresa el monto que transferiste.'); return; }
    
    try {
        const res = await fetch('/api/subscriptions/verify-manual', {
            method: 'POST',
            headers: { ...authHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify({ order_id: currentOrderId, reported_amount: amount, reported_reference: ref })
        });
        const data = await res.json();
        
        if (res.ok && data.success) {
            stopPolling();
            showSuccess();
            setTimeout(() => location.reload(), 3000);
        } else {
            alert(data.error || 'No se pudo verificar. Revisa los datos.');
        }
    } catch (err) {
        alert('Error de conexión: ' + err.message);
    }
}

function showSuccess() {
    document.getElementById('waitingScreen').style.display = 'none';
    document.getElementById('manualVerifyForm').style.display = 'none';
    document.getElementById('successMessage').style.display = 'block';
    localStorage.removeItem('pending_order_id');
}

// Inicialización cuando se carga la sección de suscripción
document.addEventListener('DOMContentLoaded', () => {
    const section = document.getElementById('sectionSubscription');
    if (section && !section.classList.contains('hidden')) {
        loadPlans();
        
        // Retomar orden pendiente si existe
        const pendingId = localStorage.getItem('pending_order_id');
        if (pendingId) {
            fetch(`/api/subscriptions/orders/${pendingId}`, { headers: authHeaders() })
                .then(r => r.json())
                .then(data => {
                    if (data.order && data.order.status === 'pending') {
                        showPaymentDetails(data.order);
                    } else {
                        localStorage.removeItem('pending_order_id');
                    }
                })
                .catch(() => localStorage.removeItem('pending_order_id'));
        }
    }
});