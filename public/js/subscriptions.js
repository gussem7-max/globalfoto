// public/js/subscriptions.js
let currentOrderId = null;
let pollInterval = null;

// === VERIFICAR ESTADO DE SUSCRIPCIÓN AL CARGAR ===
async function checkSubscriptionStatus() {
    const container = document.getElementById('subscriptionContent');
    if (!container) return;

    try {
        const res = await fetch('/api/auth/me', { headers: authHeaders() });
        if (!res.ok) throw new Error('No se pudo obtener perfil');
        
        const data = await res.json();
        const user = data.user;

        // Lógica robusta:
        // 1. Tiene plan asignado (no null, no trial)
        // 2. Tiene fecha de expiración
        // 3. La fecha no ha pasado
        
        const hasPlan = user.plan && user.plan !== 'trial';
        const hasExpiry = user.plan_expires_at;
        
        if (hasPlan && hasExpiry) {
            const expiresAt = new Date(user.plan_expires_at);
            const now = new Date();
            const daysLeft = Math.ceil((expiresAt - now) / (1000 * 60 * 60 * 24));

            if (daysLeft > 0) {
                showActiveSubscriptionDashboard(user, daysLeft);
                return; 
            }
        }

        // Si no cumple, mostrar planes
        loadPlans();
    } catch (err) {
        console.error('Error verificando suscripción:', err);
        loadPlans(); 
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
    let cancelBtnHtml = '';

    // Determinar si la renovación automática está activa
    // Asumimos true por defecto si la columna no existe o es null
    const isAutoRenew = user.auto_renew !== false; 

    if (daysLeft <= 7) {
        statusClass = 'warning';
        statusText = '⚠️ Plan por Vencer';
        if (isAutoRenew) {
            warningHtml = `
                <div class="alert alert-warning" style="margin-bottom: 20px;">
                    <i class="fa-solid fa-triangle-exclamation"></i>
                    Tu plan expira en <strong>${daysLeft} día${daysLeft !== 1 ? 's' : ''}</strong> y se renovará automáticamente.
                    <button class="btn-secondary" style="margin-left: 10px;" onclick="showPlanSelection()">Renovar Ahora</button>
                </div>
            `;
        } else {
            warningHtml = `
                <div class="alert alert-warning" style="margin-bottom: 20px;">
                    <i class="fa-solid fa-triangle-exclamation"></i>
                    Tu plan expira en <strong>${daysLeft} día${daysLeft !== 1 ? 's' : ''}</strong>. La renovación automática está desactivada.
                    <button class="btn-secondary" style="margin-left: 10px;" onclick="showPlanSelection()">Renovar Manualmente</button>
                </div>
            `;
        }
    } else {
        // Si faltan más de 7 días, mostrar botón de cancelar si está activo
        if (isAutoRenew) {
            cancelBtnHtml = `
                <div style="margin-top: 20px; padding-top: 20px; border-top: 1px solid var(--border-color); text-align: center;">
                    <p style="font-size: 13px; color: var(--text-muted); margin-bottom: 12px;">
                        ¿No deseas continuar? Puedes desactivar la renovación automática. Tu plan seguirá activo hasta el ${expiresDate}.
                    </p>
                    <button class="btn-danger" style="width: auto; padding: 8px 16px; font-size: 13px;" onclick="cancelSubscription()">
                        <i class="fa-solid fa-ban"></i> Cancelar Renovación Automática
                    </button>
                </div>
            `;
        } else {
            cancelBtnHtml = `
                <div style="margin-top: 20px; padding-top: 20px; border-top: 1px solid var(--border-color); text-align: center;">
                    <p style="font-size: 13px; color: var(--success);">
                        <i class="fa-solid fa-check-circle"></i> Renovación automática desactivada. Tu plan finalizará el ${expiresDate}.
                    </p>
                    <button class="btn-secondary" style="width: auto; padding: 8px 16px; font-size: 13px; margin-top: 8px;" onclick="reactivateAutoRenew()">
                        <i class="fa-solid fa-rotate-right"></i> Reactivar Renovación
                    </button>
                </div>
            `;
        }
    }

    const features = getFeaturesForPlan(user.plan);

    container.innerHTML = `
        <div class="header">
            <div>
                <h1>Tu Suscripción</h1>
                <p class="header-sub">Gestiona tu plan, beneficios e historial.</p>
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

        ${cancelBtnHtml}

        <h2 class="section-title" style="margin-top: 32px;">Historial de Pagos</h2>
        <div id="paymentHistoryContainer">
            <p style="color: var(--text-muted); font-size: 13px;">Cargando historial...</p>
        </div>
        
        <div style="margin-top: 30px; text-align: center;">
            <button class="btn-secondary" onclick="showPlanSelection()" style="width: auto; padding: 12px 24px;">
                <i class="fa-solid fa-arrow-up"></i> Cambiar o Mejorar Plan
            </button>
        </div>
    `;

    // Cargar historial asíncronamente
    loadPaymentHistory();
}

async function loadPaymentHistory() {
    const container = document.getElementById('paymentHistoryContainer');
    if (!container) return;

    try {
        const res = await fetch('/api/subscriptions/history', { headers: authHeaders() });
        if (!res.ok) throw new Error('Error cargando historial');
        const data = await res.json();

        if (!data.orders || data.orders.length === 0) {
            container.innerHTML = '<p style="color: var(--text-muted); font-size: 13px;">No hay registros de pagos anteriores.</p>';
            return;
        }

        let html = `
            <div style="overflow-x: auto; border: 1px solid var(--border-color); border-radius: 12px;">
                <table style="width: 100%; border-collapse: collapse; text-align: left; min-width: 600px;">
                    <thead style="background: rgba(2,6,23,0.6);">
                        <tr>
                            <th style="padding: 12px; font-size: 12px; color: var(--text-muted);">Fecha</th>
                            <th style="padding: 12px; font-size: 12px; color: var(--text-muted);">Plan</th>
                            <th style="padding: 12px; font-size: 12px; color: var(--text-muted);">Monto</th>
                            <th style="padding: 12px; font-size: 12px; color: var(--text-muted);">Estado</th>
                            <th style="padding: 12px; font-size: 12px; color: var(--text-muted);">Referencia</th>
                        </tr>
                    </thead>
                    <tbody>
        `;

        data.orders.forEach(order => {
            const date = new Date(order.paid_at || order.created_at).toLocaleDateString('es-ES');
            const amountStr = formatAmount(order.expected_amount, order.currency);
            const statusBadge = order.status === 'paid' 
                ? '<span style="color: var(--success); font-weight: 600;">Pagado</span>' 
                : '<span style="color: var(--warning); font-weight: 600;">Pendiente</span>';
            
            html += `
                <tr style="border-bottom: 1px solid var(--border-color);">
                    <td style="padding: 12px; font-size: 13px;">${date}</td>
                    <td style="padding: 12px; font-size: 13px; text-transform: capitalize;">${order.plan}</td>
                    <td style="padding: 12px; font-size: 13px; font-weight: 600;">${amountStr}</td>
                    <td style="padding: 12px; font-size: 13px;">${statusBadge}</td>
                    <td style="padding: 12px; font-size: 12px; color: var(--text-muted); font-family: monospace;">${order.reference_code}</td>
                </tr>
            `;
        });

        html += `</tbody></table></div>`;
        container.innerHTML = html;

    } catch (err) {
        console.error('Error:', err);
        container.innerHTML = `<p style="color: var(--danger); font-size: 13px;">Error al cargar el historial.</p>`;
    }
}

async function cancelSubscription() {
    if (!confirm('¿Estás seguro de desactivar la renovación automática? Tu plan seguirá activo hasta la fecha de expiración, pero no se renovará después.')) return;

    try {
        const res = await fetch('/api/subscriptions/cancel', {
            method: 'POST',
            headers: authHeaders()
        });
        const data = await res.json();

        if (res.ok && data.success) {
            alert(data.message);
            checkSubscriptionStatus(); // Recargar dashboard para reflejar el cambio
        } else {
            alert(data.error || 'Error al cancelar.');
        }
    } catch (err) {
        alert('Error de conexión: ' + err.message);
    }
}

async function reactivateAutoRenew() {
    if (!confirm('¿Deseas reactivar la renovación automática? Tu plan se renovará al finalizar el periodo actual.')) return;

    try {
        // Reutilizamos el endpoint de cancel pero con lógica inversa? 
        // Mejor creamos uno simple o modificamos el existente. 
        // Para rapidez, hagamos un fetch directo a un endpoint que ponga auto_renew = true.
        // Como no tenemos ese endpoint específico, podemos hacer un truco:
        // El endpoint /cancel pone false. Necesitamos uno que ponga true.
        // Vamos a agregarlo rápidamente al backend en el siguiente paso, 
        // pero por ahora, simularemos recargando y asumiendo que el usuario puede "Renovar Ahora" manualmente.
        // MEJOR: Agreguemos el endpoint reactivate en el backend ahora mismo (ver abajo).
        
        const res = await fetch('/api/subscriptions/reactivate', {
            method: 'POST',
            headers: authHeaders()
        });
        const data = await res.json();

        if (res.ok && data.success) {
            alert(data.message);
            checkSubscriptionStatus();
        } else {
            alert(data.error || 'Error al reactivar.');
        }
    } catch (err) {
        alert('Error de conexión: ' + err.message);
    }
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
        basic: ['5 eventos activos', 'Hasta 1.500 fotos', 'Marca de agua automática', 'Galerías con expiración'],
        pro: ['Eventos ilimitados', 'Hasta 10.000 fotos', 'Verificación por selfie', 'QR con tu logo', 'Soporte prioritario'],
        studio: ['Eventos ilimitados', 'Fotos ilimitadas', 'Multi-cuenta equipo', 'Dominio personalizado', 'Soporte dedicado 24/7']
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
        // El mensaje de downgrade del backend ya viene redactado para el usuario
        alert(err.message);
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
    const pro = order.proration;

    // Línea de crédito solo en upgrades con descuento real
    let prorationHtml = '';
    if (pro && pro.tipo === 'upgrade' && pro.credito > 0) {
        const creditoStr = formatAmount(pro.credito, order.currency);
        const originalStr = formatAmount(pro.precioOriginal, order.currency);
        prorationHtml = `
            <div style="background: rgba(16,185,129,0.10); border: 1px solid rgba(16,185,129,0.35); border-radius: 12px; padding: 14px 16px; margin-bottom: 18px; font-size: 13px; line-height: 1.7; color: #6ee7b7;">
                <div style="font-weight: 700; margin-bottom: 6px; color: #a7f3d0;">🎁 Renovación anticipada con crédito</div>
                <div>Pagabas <strong>${originalStr}</strong> por el plan completo.</div>
                <div>Te descontamos <strong>${creditoStr}</strong> por los ${pro.diasRestantes} día${pro.diasRestantes !== 1 ? 's' : ''} restantes de tu plan actual.</div>
                <div style="margin-top: 6px; color: var(--text-main);">Monto final a transferir: <strong style="color: #fff;">${amtStr}</strong></div>
            </div>
        `;
    } else if (pro && pro.tipo === 'renovacion' && pro.diasRestantes > 0) {
        prorationHtml = `
            <div style="background: rgba(99,102,241,0.10); border: 1px solid rgba(99,102,241,0.35); border-radius: 12px; padding: 12px 16px; margin-bottom: 18px; font-size: 13px; color: #a5b4fc;">
                ♻️ Renovación: tus ${pro.diasRestantes} día${pro.diasRestantes !== 1 ? 's' : ''} restantes se sumarán al final del nuevo periodo. No los pierdes.
            </div>
        `;
    }

    let html = `
        <div class="modal-header">
            <h3 class="modal-title">Completa tu pago</h3>
            <i class="fa-solid fa-xmark close-modal" onclick="confirmCancelPayment()"></i>
        </div>
        <div class="modal-body">
            ${prorationHtml}
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

// === MOSTRAR SELECCIÓN DE PLANES (desde el dashboard activo) ===
async function showPlanSelection() {
    const container = document.getElementById('subscriptionContent');
    if (!container) return;

    // Guardar estado actual por si quiere volver atrás
    const currentHtml = container.innerHTML;
    
    // Mostrar loading
    container.innerHTML = '<div style="text-align:center; padding:40px; color:var(--text-muted);">Cargando planes...</div>';

    try {
        const res = await fetch('/api/subscriptions/plans', { headers: authHeaders() });
        if (!res.ok) throw new Error('Error cargando planes');
        const data = await res.json();

        let html = `
            <div class="header">
                <div>
                    <h1>Elige tu Plan</h1>
                    <p class="header-sub">Selecciona un plan para renovar o mejorar tu suscripción actual.</p>
                </div>
                <button class="btn-secondary" onclick="restoreDashboard()" style="width:auto; padding:8px 16px;">
                    <i class="fa-solid fa-arrow-left"></i> Volver
                </button>
            </div>
            <div class="subscription-container">
                <div class="plan-cards" id="planCardsTemp"></div>
            </div>
        `;
        
        container.innerHTML = html;

        // Renderizar planes en el contenedor temporal
        const plansContainer = document.getElementById('planCardsTemp');
        plansContainer.innerHTML = data.plans.map(plan => `
            <div class="plan-card ${plan.key === 'pro' ? 'popular' : ''}" onclick="selectPlan('${plan.key}')">
                <div class="plan-name">${plan.name}</div>
                <div class="plan-price">${formatPrice(plan.price, plan.currency)}</div>
                <div class="plan-currency">${plan.currency} / mes</div>
                <ul class="plan-features">
                    ${getFeaturesForPlan(plan.key)}
                </ul>
            </div>
        `).join('');

        // Guardar el HTML del dashboard para poder restaurarlo
        window._savedDashboardHtml = currentHtml;

    } catch (err) {
        console.error('Error:', err);
        container.innerHTML = `<div class="alert alert-error">Error: ${err.message}</div>`;
        setTimeout(restoreDashboard, 3000);
    }
}

function restoreDashboard() {
    const container = document.getElementById('subscriptionContent');
    if (container && window._savedDashboardHtml) {
        container.innerHTML = window._savedDashboardHtml;
        // Re-ejecutar checkSubscriptionStatus para actualizar días restantes si cambiaron
        checkSubscriptionStatus(); 
    } else {
        // Fallback: recargar la sección completa
        showSection('subscription');
    }
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