// public/js/subscriptions.js
let currentOrderId = null;
let pollInterval = null;

// === VERIFICAR ESTADO DE SUSCRIPCIÓN AL CARGAR ===
async function checkSubscriptionStatus() {
    const container = document.getElementById('subscriptionContent');
    if (!container) return;

    try {
        // Obtener datos del usuario actual (incluye plan y fecha de expiración)
        const res = await fetch('/api/auth/me', { headers: authHeaders() });
        if (!res.ok) throw new Error('No se pudo obtener perfil');
        
        const data = await res.json();
        const user = data.user;

        // Si tiene plan activo y no ha expirado
        if (user.plan && user.plan !== 'trial' && user.plan_expires_at) {
            const expiresAt = new Date(user.plan_expires_at);
            const now = new Date();
            const daysLeft = Math.ceil((expiresAt - now) / (1000 * 60 * 60 * 24));

            if (daysLeft > 0) {
                showActiveSubscriptionDashboard(user, daysLeft);
                return; // Salir temprano, no mostrar planes de venta
            }
        }

        // Si no tiene plan o expiró, mostrar planes normales
        loadPlans();
    } catch (err) {
        console.error('Error verificando suscripción:', err);
        loadPlans(); // Fallback a planes normales
    }
}

function showActiveSubscriptionDashboard(user, daysLeft) {
    const container = document.getElementById('subscriptionContent');
    if (!container) return;

    const planName = user.plan.charAt(0).toUpperCase() + user.plan.slice(1);
    const expiresDate = new Date(user.plan_expires_at).toLocaleDateString('es-ES', { 
        year: 'numeric', month: 'long', day: 'numeric' 
    });

    let statusClass = 'success';
    let statusText = '✅ Plan Activo';
    let warningHtml = '';

    if (daysLeft <= 7) {
        statusClass = 'warning';
        statusText = '⚠️ Plan por Vencer';
        warningHtml = `
            <div class="alert alert-warning" style="margin-bottom: 20px;">
                <i class="fa-solid fa-triangle-exclamation"></i>
                Tu plan expira en <strong>${daysLeft} día${daysLeft !== 1 ? 's' : ''}</strong>. 
                <button class="btn-secondary" style="margin-left: 10px;" onclick="loadPlans()">Renovar Ahora</button>
            </div>
        `;
    }

    const features = getFeaturesForPlan(user.plan);

    container.innerHTML = `
        <div class="header">
            <div>
                <h1>Tu Suscripción</h1>
                <p class="header-sub">Gestiona tu plan y beneficios actuales.</p>
            </div>
        </div>

        ${warningHtml}

        <div class="stats-grid">
            <div class="stat-card">
                <div class="stat-icon"><i class="fa-solid fa-crown"></i></div>
                <div class="stat-data">
                    <h3>${planName}</h3>
                    <p>Plan Actual</p>
                </div>
            </div>
            <div class="stat-card">
                <div class="stat-icon"><i class="fa-solid fa-calendar-check"></i></div>
                <div class="stat-data">
                    <h3>${daysLeft} días</h3>
                    <p>Restantes</p>
                </div>
            </div>
            <div class="stat-card">
                <div class="stat-icon"><i class="fa-solid fa-clock"></i></div>
                <div class="stat-data">
                    <h3>${expiresDate}</h3>
                    <p>Fecha de Expiración</p>
                </div>
            </div>
        </div>

        <h2 class="section-title">Tus Beneficios Actuales</h2>
        <div class="config-card">
            <ul class="plan-features" style="font-size: 15px; line-height: 2;">
                ${features}
            </ul>
        </div>

        <div style="margin-top: 30px; text-align: center;">
            <button class="btn-secondary" onclick="loadPlans()" style="width: auto; padding: 12px 24px;">
                <i class="fa-solid fa-arrow-up"></i> Cambiar o Mejorar Plan
            </button>
        </div>
    `;
}

// === FUNCIONES EXISTENTES (sin cambios) ===

async function loadPlans() {
    const container = document.getElementById('planCards');
    if (!container) return;
    
    container.innerHTML = '<div style="text-align:center; padding:40px; color:var(--text-muted);">Cargando planes...</div>';

    try {
        const res = await fetch('/api/subscriptions/plans', { headers: authHeaders() });
        
        if (!res.ok) {
            const errData = await res.json().catch(() => ({ error: 'Error desconocido' }));
            throw new Error(errData.error || `HTTP ${res.status}`);
        }
        
        const data = await res.json();
        
        if (!data.plans || data.plans.length === 0) {
            container.innerHTML = '<p style="color:var(--warning); text-align:center;">No hay planes disponibles.</p>';
            return;
        }

        const plansHtml = data.plans.map(plan => `
            <div class="plan-card ${plan.key === 'pro' ? 'popular' : ''}" onclick="selectPlan('${plan.key}')">
                <div class="plan-name">${plan.name}</div>
                <div class="plan-price">${formatPrice(plan.price, plan.currency)}</div>
                <div class="plan-currency">${plan.currency} / mes</div>
                <ul class="plan-features">
                    ${getFeaturesForPlan(plan.key)}
                </ul>
            </div>
        `).join('');
        
        container.innerHTML = plansHtml;
    } catch (err) {
        console.error('Error cargando planes:', err);
        container.innerHTML = `
            <div style="background:rgba(239,68,68,0.1); border:1px solid var(--danger); padding:20px; border-radius:12px; color:#fca5a5;">
                <strong>Error al cargar planes:</strong><br/>
                ${err.message}<br/><br/>
                <small>Verifica tu conexión o inicia sesión nuevamente.</small>
            </div>`;
    }
}

function formatPrice(price, currency) {
    const num = parseFloat(price);
    if (isNaN(num)) return String(price);
    if (currency === 'VES') return `Bs. ${num.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    if (currency === 'COP') return `$${Math.round(num).toLocaleString('es-CO')}`;
    return `$${num.toFixed(2)}`;
}

function getFeaturesForPlan(key) {
    const features = {
        basic: ['✓ 5 eventos activos', '✓ Hasta 1.500 fotos', '✓ Marca de agua automática', '✓ Galerías con expiración'],
        pro: ['✓ Eventos ilimitados', '✓ Hasta 10.000 fotos', '✓ Verificación por selfie', '✓ QR con tu logo', '✓ Soporte prioritario'],
        studio: ['✓ Eventos ilimitados', '✓ Fotos ilimitadas', '✓ Multi-cuenta equipo', '✓ Dominio personalizado', '✓ Soporte dedicado 24/7']
    };
    return (features[key] || []).map(f => `<li>${f}</li>`).join('');
}

async function selectPlan(planKey) {
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
        
        openPaymentModal(data.order);
    } catch (err) {
        alert('Error: ' + err.message);
    }
}

function openPaymentModal(order) {
    currentOrderId = order.id;
    localStorage.setItem('pending_order_id', order.id);
    
    const modal = document.getElementById('paymentModal');
    if (!modal) return;
    
    const amtStr = formatAmount(order.expected_amount, order.currency);
    const refCode = order.reference_code;
    const isZinli = order.channel === 'zinli';
    
    let html = `
        <div class="modal-header">
            <h3 class="modal-title">Completa tu pago</h3>
            <i class="fa-solid fa-xmark close-modal" onclick="confirmCancelPayment()"></i>
        </div>
        <div class="modal-body">
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
                    <strong>${refCode}</strong>
                    <button class="copy-btn" onclick="copyToClipboard('${refCode}', this)">📋</button>
                </span>
            </div>
            
            <div class="instructions-box">${escapeHtml(order.instructions)}</div>
    `;
    
    if (isZinli) {
        html += `
            <a href="${BANK_DATA_ZINLI_LINK}" target="_blank" class="zinli-link-btn">
                💳 Abrir cobro en Zinli (${amtStr})
            </a>
        `;
    }
    
    html += `
            <div class="waiting-screen" id="waitingScreen">
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
                    <input type="text" id="reportedRef" placeholder="${refCode}">
                </div>
                <div class="form-group">
                    <label>Número de referencia de la transacción (del comprobante bancario):</label>
                    <input type="text" id="transactionRef" placeholder="Ej: 0123456789" required>
                </div>
                <button class="btn-primary" onclick="submitManualVerification()">Enviar verificación</button>
            </div>
            
            <div class="success-message" id="successMessage" style="display:none;">
                <i class="fa-solid fa-circle-check success-icon"></i>
                <div class="success-title">¡Pago exitoso!</div>
                <div class="success-subtitle">Tu plan ha sido activado. Redirigiendo...</div>
            </div>
        </div>
    `;
    
    modal.querySelector('.modal-content').innerHTML = html;
    modal.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    
    startPolling();
}

const BANK_DATA_ZINLI_LINK = 'https://recargas.zinli.com/6XgFfhiz45rArACBUYxWTo';

function confirmCancelPayment() {
    if (confirm('¿Estás seguro de que quieres cancelar el pago? Perderás esta orden pendiente.')) {
        closePaymentModal();
        localStorage.removeItem('pending_order_id');
        stopPolling();
    }
}

function closePaymentModal() {
    const modal = document.getElementById('paymentModal');
    if (modal) {
        modal.classList.add('hidden');
        document.body.style.overflow = '';
    }
}

function formatAmount(amount, currency) {
    const num = parseFloat(amount);
    if (isNaN(num)) return String(amount);
    if (currency === 'VES') return `Bs. ${num.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    if (currency === 'COP') return `$${Math.round(num).toLocaleString('es-CO')} COP`;
    if (currency === 'USD') return `$${num.toFixed(2)} USD`;
    return num.toString();
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML.replace(/\n/g, '<br>');
}

function copyToClipboard(text, btn) {
    navigator.clipboard.writeText(String(text)).then(() => {
        btn.classList.add('copied');
        btn.innerHTML = '✓';
        setTimeout(() => {
            btn.classList.remove('copied');
            btn.innerHTML = '📋';
        }, 2000);
    }).catch(() => {
        const ta = document.createElement('textarea');
        ta.value = String(text);
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
    stopPolling();
    pollInterval = setInterval(async () => {
        if (!currentOrderId) return;
        try {
            const res = await fetch(`/api/subscriptions/orders/${currentOrderId}/status`, { headers: authHeaders() });
            if (!res.ok) return;
            
            const data = await res.json();
            
            if (data.status === 'paid') {
                stopPolling();
                showSuccess();
                setTimeout(() => {
                    closePaymentModal();
                    location.reload(); // Recargar para mostrar dashboard de suscripción activa
                }, 3000);
            } else if (data.status === 'expired') {
                stopPolling();
                alert('La orden expiró. Por favor intenta de nuevo.');
                closePaymentModal();
                location.reload();
            }
        } catch (err) {
            console.warn('Error polling:', err);
        }
    }, 4000);
}

function stopPolling() {
    if (pollInterval) clearInterval(pollInterval);
    pollInterval = null;
}

function showManualVerifyForm() {
    const mvf = document.getElementById('manualVerifyForm');
    if (mvf) mvf.style.display = 'block';
}

async function submitManualVerification() {
    const amountInput = document.getElementById('reportedAmount');
    const refInput = document.getElementById('reportedRef');
    const txRefInput = document.getElementById('transactionRef');
    
    if (!amountInput || !refInput || !txRefInput) return;
    
    const amount = parseFloat(amountInput.value);
    const ref = refInput.value.trim();
    const txRef = txRefInput.value.trim();
    
    if (!amount) { alert('Ingresa el monto que transferiste.'); return; }
    if (!txRef) { alert('Ingresa el número de referencia de la transacción bancaria.'); return; }
    
    try {
        const res = await fetch('/api/subscriptions/verify-manual', {
            method: 'POST',
            headers: { ...authHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                order_id: currentOrderId, 
                reported_amount: amount, 
                reported_reference: ref,
                transaction_reference: txRef
            })
        });
        const data = await res.json();
        
        if (res.ok && data.success) {
            stopPolling();
            showSuccess();
            setTimeout(() => {
                closePaymentModal();
                location.reload(); // Recargar para mostrar dashboard de suscripción activa
            }, 3000);
        } else {
            alert(data.error || 'No se pudo verificar. Revisa los datos.');
        }
    } catch (err) {
        alert('Error de conexión: ' + err.message);
    }
}

function showSuccess() {
    const ws = document.getElementById('waitingScreen');
    const mvf = document.getElementById('manualVerifyForm');
    const sm = document.getElementById('successMessage');
    
    if (ws) ws.style.display = 'none';
    if (mvf) mvf.style.display = 'none';
    if (sm) sm.style.display = 'block';
    
    localStorage.removeItem('pending_order_id');
}

// === INICIALIZACIÓN MEJORADA ===
document.addEventListener('DOMContentLoaded', () => {
    const section = document.getElementById('sectionSubscription');
    if (section && !section.classList.contains('hidden')) {
        // Verificar estado de suscripción primero
        checkSubscriptionStatus();
        
        // Retomar orden pendiente si existe
        const pendingId = localStorage.getItem('pending_order_id');
        if (pendingId) {
            fetch(`/api/subscriptions/orders/${pendingId}`, { headers: authHeaders() })
                .then(r => r.ok ? r.json() : Promise.reject())
                .then(data => {
                    if (data.order && data.order.status === 'pending') {
                        openPaymentModal(data.order);
                    } else {
                        localStorage.removeItem('pending_order_id');
                    }
                })
                .catch(() => localStorage.removeItem('pending_order_id'));
        }
    }
});

// También escuchar cuando se navega a la sección dinámicamente
window.showSection = function(originalShowSection) {
    return function(section) {
        originalShowSection(section);
        if (section === 'subscription') {
            checkSubscriptionStatus();
        }
    };
}(window.showSection);