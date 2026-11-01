// =====================================================
// PANEL DE ADMINISTRACIÓN Y GESTIÓN DE USUARIOS
// v2: cada área admin es una sección propia del menú izquierdo
// =====================================================

const ADMIN_SECTIONS = ['adminSummary', 'adminEvents', 'adminMedia', 'adminOrders', 'adminSubs'];

// --- Wrapper de showSection: agrega las secciones admin sin tocar ui.js ---
if (typeof window._gfOriginalShowSection === 'undefined' && typeof window.showSection === 'function') {
    window._gfOriginalShowSection = window.showSection;
    window.showSection = function (section, ...rest) {
        if (section === 'admin') section = 'adminSummary'; // llamadas viejas aterrizan en Resumen
        if (ADMIN_SECTIONS.includes(section)) {
            document.querySelectorAll('[id^="section"]').forEach(el => el.classList.add('hidden'));
            const el = document.getElementById('section' + section.charAt(0).toUpperCase() + section.slice(1));
            if (el) el.classList.remove('hidden');
            if (section === 'adminSummary') loadAdminSummary();
            else if (section === 'adminEvents') loadAdminEventsAll();
            else if (section === 'adminMedia') loadAdminMedia();
            else if (section === 'adminOrders') loadAdminOrdersAll();
            else if (section === 'adminSubs') loadAdminSubs();
            return;
        }
        document.querySelectorAll('[id^="sectionAdmin"]').forEach(el => el.classList.add('hidden'));
        return window._gfOriginalShowSection(section, ...rest);
    };
}

// --- Wrapper de showDashboard: sincroniza visibilidad de ítems admin ---
if (typeof window._gfOriginalShowDashboard === 'undefined' && typeof window.showDashboard === 'function') {
    window._gfOriginalShowDashboard = window.showDashboard;
    window.showDashboard = function (...args) {
        const r = window._gfOriginalShowDashboard.apply(this, args);
        syncAdminNav();
        return r;
    };
}

function syncAdminNav() {
    const isAdmin = !!(typeof currentUser !== 'undefined' && currentUser && currentUser.role === 'admin');
    ['navAdminSummary', 'navAdminEvents', 'navAdminMedia', 'navAdminOrders', 'navAdminSubs',
     'drawerAdminSummary', 'drawerAdminEvents', 'drawerAdminMedia', 'drawerAdminOrders', 'drawerAdminSubs']
        .forEach(id => { const el = document.getElementById(id); if (el) el.classList.toggle('hidden', !isAdmin); });
    const navSub = document.getElementById('navSubscription');
    if (navSub) navSub.classList.toggle('hidden', isAdmin);
    const drawerSub = document.getElementById('drawerSubscription');
    if (drawerSub) drawerSub.classList.toggle('hidden', isAdmin);
}

// ---------- Cargadores de cada sección admin ----------
async function loadAdminSummary() {
    if (!currentUser || currentUser.role !== 'admin') { alert('No tienes permisos.'); showSection('events'); return; }
    try {
        const res = await fetch('/api/admin/stats', { headers: authHeaders() });
        if (res.ok) {
            const s = await res.json();
            document.getElementById('adminStats').innerHTML = `
                <div class="stat-card"><div class="stat-icon"><i class="fa-solid fa-users"></i></div><div class="stat-data"><h3>${s.users}</h3><p>Usuarios</p></div></div>
                <div class="stat-card"><div class="stat-icon"><i class="fa-solid fa-calendar-days"></i></div><div class="stat-data"><h3>${s.events}</h3><p>Eventos</p></div></div>
                <div class="stat-card"><div class="stat-icon"><i class="fa-solid fa-image"></i></div><div class="stat-data"><h3>${s.photos}</h3><p>Fotos</p></div></div>
                <div class="stat-card"><div class="stat-icon"><i class="fa-solid fa-cart-shopping"></i></div><div class="stat-data"><h3>${s.orders}</h3><p>Pedidos</p></div></div>
                <div class="stat-card"><div class="stat-icon"><i class="fa-solid fa-dollar-sign"></i></div><div class="stat-data"><h3>${formatMoney(s.gross)}</h3><p>Ventas Brutas</p></div></div>
                <div class="stat-card"><div class="stat-icon" style="background:#d1fae5;color:#065f46;"><i class="fa-solid fa-hand-holding-dollar"></i></div><div class="stat-data"><h3>${formatMoney(s.commission)}</h3><p>Comisión GlobalFoto</p></div></div>
            `;
        }
    } catch (err) { console.error('Error loadAdminSummary:', err); }
}

async function loadAdminEventsAll() {
    if (!currentUser || currentUser.role !== 'admin') { alert('No tienes permisos.'); showSection('events'); return; }
    const content = document.getElementById('adminEventsContent');
    content.innerHTML = '<p style="color: var(--text-muted); padding: 20px;">Cargando...</p>';
    try {
        const res = await fetch('/api/admin/events', { headers: authHeaders() });
        renderAdminEvents(await res.json(), 'adminEventsContent');
    } catch (err) { content.innerHTML = '<div class="alert alert-error">Error al cargar la información.</div>'; }
}

async function loadAdminMedia() {
    if (!currentUser || currentUser.role !== 'admin') { alert('No tienes permisos.'); showSection('events'); return; }
    const content = document.getElementById('adminMediaContent');
    content.innerHTML = '<p style="color: var(--text-muted); padding: 20px;">Cargando...</p>';
    try {
        const res = await fetch('/api/admin/photos', { headers: authHeaders() });
        renderAdminPhotos(await res.json(), 'adminMediaContent');
    } catch (err) { content.innerHTML = '<div class="alert alert-error">Error al cargar la información.</div>'; }
}

async function loadAdminOrdersAll() {
    if (!currentUser || currentUser.role !== 'admin') { alert('No tienes permisos.'); showSection('events'); return; }
    const content = document.getElementById('adminOrdersContent');
    content.innerHTML = '<p style="color: var(--text-muted); padding: 20px;">Cargando...</p>';
    try {
        const res = await fetch('/api/admin/orders', { headers: authHeaders() });
        renderAdminOrders(await res.json(), 'adminOrdersContent');
    } catch (err) { content.innerHTML = '<div class="alert alert-error">Error al cargar la información.</div>'; }
}

async function loadAdminSubs(targetId) {
    if (!currentUser || currentUser.role !== 'admin') { alert('No tienes permisos.'); showSection('events'); return; }
    const container = document.getElementById(targetId || 'adminSubsContent');
    if (!container) return;
    container.innerHTML = '<p style="color: var(--text-muted); padding: 20px;">Cargando...</p>';
    try {
        const res = await fetch('/api/admin/subscription-orders', { headers: authHeaders() });
        if (!res.ok) { container.innerHTML = '<div class="alert alert-error">No se pudo cargar la información.</div>'; return; }
        renderAdminSubscriptions(await res.json(), targetId || 'adminSubsContent');
    } catch (err) { container.innerHTML = '<div class="alert alert-error">Error al cargar la información.</div>'; }
}

function refreshSubsViews() {
    loadAdminSubs();
    const subSec = document.getElementById('sectionSubscription');
    if (subSec && !subSec.classList.contains('hidden')) loadAdminSubs('subscriptionContent');
}

// Stubs de compatibilidad (por si algún código viejo los llama)
async function loadAdmin() { showSection('adminSummary'); }
function adminTab(tab) {
    const map = { events: 'adminEvents', photos: 'adminMedia', orders: 'adminOrders', subscriptions: 'adminSubs' };
    showSection(map[tab] || 'adminSummary');
}

// ---------- Renderizadores ----------
function renderAdminEvents(events, targetId) {
    const content = document.getElementById(targetId || 'adminEventsContent');
    if (!events || events.length === 0) { content.innerHTML = '<div class="empty-state"><i class="fa-solid fa-calendar-days"></i><p>No hay eventos en la plataforma.</p></div>'; return; }
    content.innerHTML = `<div class="events-grid">` + events.map(ev => {
        const publicUrl = `${window.location.origin}/?galeria=${ev.id}`;
        const statusClass = `status-${ev.status || 'published'}`;
        const statusText = ev.status === 'published' ? 'Publicada' : ev.status === 'draft' ? 'Borrador' : 'Archivada';
        return `<div class="event-card">
            <div class="event-header">
                <div>
                    <div class="event-title">${ev.title} <span class="event-status-badge ${statusClass}">${statusText}</span></div>
                    <div class="event-meta"><span><i class="fa-solid fa-user"></i> ${ev.photographer_name}</span><span><i class="fa-solid fa-image"></i> ${ev.photosCount} fotos</span></div>
                </div>
                <div class="event-actions">
                    <a href="${publicUrl}" target="_blank" class="btn-action" title="Ver galería"><i class="fa-solid fa-eye"></i></a>
                    <button class="btn-action" onclick="adminDeleteEvent(${ev.id})" title="Eliminar" style="color:var(--danger);"><i class="fa-solid fa-trash"></i></button>
                </div>
            </div>
            <div class="event-body">
                <div class="event-desc"><strong>Fotógrafo:</strong> ${ev.photographer_name} (${ev.photographer_email})<br><strong>Fecha:</strong> ${ev.event_date ? ev.event_date.split('T')[0] : 'Sin fecha'}<br><strong>Ubicación:</strong> ${ev.location || 'Sin ubicación'}</div>
            </div>
        </div>`;
    }).join('') + `</div>`;
}

function renderAdminPhotos(photos, targetId) {
    const content = document.getElementById(targetId || 'adminMediaContent');
    if (!photos || photos.length === 0) { content.innerHTML = '<div class="empty-state"><i class="fa-solid fa-photo-film"></i><p>No hay fotos en la plataforma.</p></div>'; return; }
    content.innerHTML = `<p style="font-size:13px;color:var(--text-muted);margin-bottom:12px;">Mostrando las ${photos.length} fotos más recientes de todos los fotógrafos.</p>
    <div class="media-grid">` + photos.map(p => `
        <div class="media-item">
            <img src="${p.preview_url || p.url}" onclick="openLightbox('${p.preview_url || p.url}')" title="${p.event_title}">
            <button class="media-delete" onclick="adminDeletePhoto(${p.id})" title="Eliminar foto"><i class="fa-solid fa-trash"></i></button>
            <div class="media-info"><strong>${p.event_title}</strong><br>${p.photographer_name}</div>
        </div>
    `).join('') + `</div>`;
}

function renderAdminOrders(orders, targetId) {
    const content = document.getElementById(targetId || 'adminOrdersContent');
    if (!orders || orders.length === 0) { content.innerHTML = '<div class="empty-state"><i class="fa-solid fa-cart-shopping"></i><p>No hay pedidos en la plataforma.</p></div>'; return; }
    content.innerHTML = `<div class="table-wrap"><table class="data-table" style="min-width:700px;">
            <thead>
                <tr>
                    <th style="padding:14px;font-size:12px;text-transform:uppercase;letter-spacing:0.5px;color:var(--text-muted);text-align:left;">#</th>
                    <th style="padding:14px;font-size:12px;text-transform:uppercase;letter-spacing:0.5px;color:var(--text-muted);text-align:left;">Cliente</th>
                    <th style="padding:14px;font-size:12px;text-transform:uppercase;letter-spacing:0.5px;color:var(--text-muted);text-align:left;">Evento</th>
                    <th style="padding:14px;font-size:12px;text-transform:uppercase;letter-spacing:0.5px;color:var(--text-muted);text-align:left;">Fotógrafo</th>
                    <th style="padding:14px;font-size:12px;text-transform:uppercase;letter-spacing:0.5px;color:var(--text-muted);text-align:left;">Monto</th>
                    <th style="padding:14px;font-size:12px;text-transform:uppercase;letter-spacing:0.5px;color:var(--text-muted);text-align:left;">Comisión</th>
                    <th style="padding:14px;font-size:12px;text-transform:uppercase;letter-spacing:0.5px;color:var(--text-muted);text-align:left;">Estado</th>
                </tr>
            </thead>
            <tbody>` + orders.map(o => `
                <tr style="border-bottom:1px solid var(--border-color);">
                    <td style="padding:12px;font-size:13px;color:var(--text-main);">${o.id}</td>
                    <td style="padding:12px;font-size:13px;color:var(--text-main);">${o.customer_name}<br><small style="color:var(--text-muted);">${o.customer_email}</small></td>
                    <td style="padding:12px;font-size:13px;color:var(--text-main);">${o.event_title}</td>
                    <td style="padding:12px;font-size:13px;color:var(--text-main);">${o.photographer_name}</td>
                    <td style="padding:12px;font-size:13px;font-weight:600;color:var(--text-main);">${formatMoney(o.amount)}</td>
                    <td style="padding:12px;font-size:13px;color:#34d399;">${formatMoney(o.commission_amount)}</td>
                    <td style="padding:12px;"><span class="order-status status-${o.status}">${o.status === 'pending' ? 'Pendiente' : o.status === 'approved' ? 'Aprobado' : 'Rechazado'}</span></td>
                </tr>
            `).join('') + `</tbody></table></div>`;
}

function renderAdminSubscriptions(orders, targetId) {
    const content = document.getElementById(targetId || 'adminSubsContent');
    if (!content) return;

    const headerHtml = (targetId === 'subscriptionContent')
        ? `<div class="header"><div><h1>Gestión de Suscripciones</h1><p class="header-sub">Revisa, aprueba o rechaza los pagos reportados por los fotógrafos.</p></div></div>`
        : '';

    if (!orders || orders.length === 0) {
        content.innerHTML = headerHtml + '<div class="empty-state"><i class="fa-solid fa-star"></i><p>No hay órdenes de suscripción registradas.</p></div>';
        return;
    }

    const channelLabels = { nequi: 'Nequi', pagomovil: 'Pago Móvil', zinli: 'Zinli' };

    const rows = orders.map(o => {
        const statusText = o.status === 'pending' ? 'Pendiente' : o.status === 'reported' ? 'Reportado ⚠️' : o.status === 'paid' ? 'Pagado' : 'Rechazado';

        let reportedAmount = '—';
        let reportedRef = '—';
        if (o.webhook_raw) {
            try {
                const raw = typeof o.webhook_raw === 'string' ? JSON.parse(o.webhook_raw) : o.webhook_raw;
                if (raw.reported_amount) reportedAmount = raw.reported_amount;
                if (raw.reported_reference) reportedRef = raw.reported_reference;
            } catch (e) {}
        }
        if (reportedAmount === '—' && o.reference_note && o.reference_note.includes('Monto reportado:')) {
            const m = o.reference_note.match(/Monto reportado: ([^|]+)/);
            if (m) reportedAmount = m[1].trim();
        }
        if (reportedRef === '—' && o.reference_note && o.reference_note.includes('Ref usada:')) {
            const m = o.reference_note.match(/Ref usada: ([^|]+)/);
            if (m) reportedRef = m[1].trim();
        }

        const moneyExpected = formatMoney(o.expected_amount, o.currency);
        const moneyReported = reportedAmount !== '—' ? formatMoney(reportedAmount, o.currency) : '—';
        const isMismatch = reportedAmount !== '—' && Math.abs(parseFloat(reportedAmount) - parseFloat(o.expected_amount)) > 0.01;

        const actions = o.status === 'reported'
            ? `<button class="btn-action" onclick="approveSubOrder(${o.id})" title="Aprobar y activar plan" style="color:#34d399;background:rgba(16,185,129,0.12);"><i class="fa-solid fa-check"></i></button>
               <button class="btn-action" onclick="rejectSubOrder(${o.id})" title="Rechazar" style="color:#f87171;background:rgba(239,68,68,0.12);"><i class="fa-solid fa-xmark"></i></button>`
            : (o.status === 'pending'
                ? `<span style="font-size:12px;color:var(--text-muted);">Esperando pago…</span>`
                : `<span style="font-size:12px;color:var(--text-muted);">—</span>`);

        return `<tr style="border-bottom:1px solid var(--border-color);${o.status === 'reported' ? 'background:rgba(245,158,11,0.07);' : ''}">
            <td style="padding:14px;font-size:13px;font-weight:700;color:var(--text-main);">#${o.id}</td>
            <td style="padding:14px;font-size:13px;color:var(--text-main);">${o.user_name}<br><small style="color:var(--text-muted);">${o.user_email}</small></td>
            <td style="padding:14px;"><span style="background:rgba(99,102,241,0.15);color:#a5b4fc;padding:3px 8px;border-radius:6px;font-size:11px;font-weight:700;">${(o.plan || '').toUpperCase()}</span></td>
            <td style="padding:14px;font-size:13px;font-weight:600;color:var(--text-main);">${moneyExpected}</td>
            <td style="padding:14px;font-size:13px;font-weight:600;color:${isMismatch ? 'var(--danger)' : 'var(--text-main)'};">${moneyReported}</td>
            <td style="padding:14px;font-size:12px;font-family:monospace;color:var(--text-main);">${o.reference_code}<br><small style="color:var(--text-muted);">${reportedRef}</small></td>
            <td style="padding:14px;font-size:13px;color:var(--text-muted);">${channelLabels[o.channel] || o.channel}</td>
            <td style="padding:14px;"><span class="order-status status-${o.status}">${statusText}</span></td>
            <td style="padding:14px;"><div style="display:flex;gap:6px;">${actions}</div></td>
        </tr>`;
    }).join('');

    content.innerHTML = headerHtml + `
        <div class="table-wrap">
            <table class="data-table">
                <thead>
                    <tr>
                        <th style="padding:14px;font-size:12px;text-transform:uppercase;letter-spacing:0.5px;color:var(--text-muted);text-align:left;">#</th>
                        <th style="padding:14px;font-size:12px;text-transform:uppercase;letter-spacing:0.5px;color:var(--text-muted);text-align:left;">Fotógrafo</th>
                        <th style="padding:14px;font-size:12px;text-transform:uppercase;letter-spacing:0.5px;color:var(--text-muted);text-align:left;">Plan</th>
                        <th style="padding:14px;font-size:12px;text-transform:uppercase;letter-spacing:0.5px;color:var(--text-muted);text-align:left;">Monto Esp.</th>
                        <th style="padding:14px;font-size:12px;text-transform:uppercase;letter-spacing:0.5px;color:var(--text-muted);text-align:left;">Monto Rep.</th>
                        <th style="padding:14px;font-size:12px;text-transform:uppercase;letter-spacing:0.5px;color:var(--text-muted);text-align:left;">Código / Ref</th>
                        <th style="padding:14px;font-size:12px;text-transform:uppercase;letter-spacing:0.5px;color:var(--text-muted);text-align:left;">Canal</th>
                        <th style="padding:14px;font-size:12px;text-transform:uppercase;letter-spacing:0.5px;color:var(--text-muted);text-align:left;">Estado</th>
                        <th style="padding:14px;font-size:12px;text-transform:uppercase;letter-spacing:0.5px;color:var(--text-muted);text-align:left;">Acciones</th>
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
        </div>`;
}

async function adminDeleteEvent(id) {
    if (!confirm('⚠️ Como administrador, eliminarás este evento y TODAS sus fotos de cualquier fotógrafo. ¿Continuar?')) return;
    try {
        const res = await fetch(`/api/admin/events/${id}`, { method: 'DELETE', headers: authHeaders() });
        if (res.ok) { alert('Evento eliminado.'); loadAdminEventsAll(); }
        else { const d = await res.json(); alert(d.error); }
    } catch (err) { alert('Error de conexión.'); }
}

async function adminDeletePhoto(id) {
    if (!confirm('⚠️ Eliminarás esta foto permanentemente. ¿Continuar?')) return;
    try {
        const res = await fetch(`/api/admin/photos/${id}`, { method: 'DELETE', headers: authHeaders() });
        if (res.ok) { alert('Foto eliminada.'); loadAdminMedia(); }
        else { const d = await res.json(); alert(d.error); }
    } catch (err) { alert('Error de conexión.'); }
}

// ---------- Suscripciones: aprobar / rechazar ----------
async function approveSubOrder(id) {
    if (!confirm('¿Confirmas que el pago es correcto? Se activará el plan del usuario y se le enviará un correo de confirmación.')) return;
    try {
        const res = await fetch(`/api/admin/subscription-orders/${id}/approve`, { method: 'POST', headers: authHeaders() });
        const data = await res.json();
        if (res.ok) { alert('✅ Plan activado y usuario notificado.'); refreshSubsViews(); }
        else { alert('Error: ' + data.error); }
    } catch (err) { alert('Error de conexión.'); }
}

async function rejectSubOrder(id) {
    const reason = prompt('Motivo del rechazo (opcional):');
    if (reason === null) return;
    try {
        const res = await fetch(`/api/admin/subscription-orders/${id}/reject`, {
            method: 'POST',
            headers: { ...authHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify({ reason })
        });
        const data = await res.json();
        if (res.ok) { alert('Orden rechazada.'); refreshSubsViews(); }
        else { alert('Error: ' + data.error); }
    } catch (err) { alert('Error de conexión.'); }
}

// ---------- GESTIÓN DE USUARIOS ----------
async function loadUsers() {
    if (!currentUser || currentUser.role !== 'admin') { alert('No tienes permisos.'); showSection('events'); return; }
    const tbody = document.getElementById('usersTableBody');
    tbody.innerHTML = '<tr><td colspan="6" style="padding: 20px; text-align: center; color: var(--text-muted);">Cargando usuarios...</td></tr>';
    try {
        const res = await fetch('/api/users', { headers: authHeaders() });
        if (res.ok) {
            const users = await res.json();
            if (users.length === 0) { tbody.innerHTML = '<tr><td colspan="6" style="padding: 20px; text-align: center; color: var(--text-muted);">No hay usuarios registrados aún.</td></tr>'; return; }
            tbody.innerHTML = users.map(u => {
                const fecha = new Date(u.created_at).toLocaleDateString('es-CO', { year: 'numeric', month: 'short', day: 'numeric' });
                const roleBadge = u.role === 'admin' ? '<span style="background: #fef3c7; color: #92400e; padding: 4px 8px; border-radius: 6px; font-size: 12px; font-weight: 600;">Admin</span>' : '<span style="background: #eff6ff; color: #2563eb; padding: 4px 8px; border-radius: 6px; font-size: 12px; font-weight: 600;">Fotógrafo</span>';
                const planBadge = u.plan && u.plan !== 'trial' ? `<span style="background: #d1fae5; color: #065f46; padding: 2px 6px; border-radius: 4px; font-size: 11px; margin-left: 4px;">${u.plan.toUpperCase()}</span>` : '';
                const actionButtons = u.id !== currentUser.id ? `<button onclick="openActivateSubscriptionModal(${u.id}, '${u.name.replace(/'/g, "\\'")}', '${u.plan || 'trial'}')" class="btn-secondary" style="margin-right: 4px; padding: 6px 10px; font-size: 12px;" title="Activar Plan"><i class="fa-solid fa-crown"></i></button><button onclick="openEditUserModal(${u.id}, '${u.name.replace(/'/g, "\\'")}', '${u.email}', '${u.role}')" class="btn-warning" style="margin-right: 4px; padding: 6px 10px; font-size: 12px;" title="Editar"><i class="fa-solid fa-pen"></i></button><button onclick="deleteUser(${u.id})" class="btn-danger" style="padding: 6px 10px; font-size: 12px;" title="Eliminar"><i class="fa-solid fa-trash"></i></button>` : '<span style="font-size: 11px; color: var(--text-muted);">(Tú)</span>';
                return `<tr style="border-bottom: 1px solid var(--border-color);"><td style="padding: 16px; font-size: 14px; font-weight: 500;">${u.name}</td><td style="padding: 16px; font-size: 14px; color: #475569;">${u.email}</td><td style="padding: 16px;">${roleBadge}${planBadge}</td><td style="padding: 16px; font-size: 13px; color: #64748b;">${fecha}</td><td style="padding: 16px;">${actionButtons}</td></tr>`;
            }).join('');
        }
    } catch (err) { tbody.innerHTML = '<tr><td colspan="6" style="padding: 20px; text-align: center; color: var(--danger);">Error al cargar la lista.</td></tr>'; }
}

function openEditUserModal(id, name, email, role) {
    document.getElementById('editUserId').value = id;
    document.getElementById('editUserName').value = name;
    document.getElementById('editUserEmail').value = email;
    document.getElementById('editUserRole').value = role;
    document.getElementById('editUserModal').classList.remove('hidden');
}

function closeEditUserModal() {
    document.getElementById('editUserModal').classList.add('hidden');
}

async function deleteUser(id) {
    if (!confirm('¿Estás seguro de eliminar este usuario? Esta acción no se puede deshacer.')) return;
    try {
        const res = await fetch(`/api/users/${id}`, { method: 'DELETE', headers: authHeaders() });
        if (res.ok) { alert('Usuario eliminado.'); loadUsers(); }
        else { const data = await res.json(); alert(`Error: ${data.error}`); }
    } catch (err) { alert('Error de conexión.'); }
}

document.getElementById('editUserForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('editUserId').value;
    const name = document.getElementById('editUserName').value;
    const email = document.getElementById('editUserEmail').value;
    const role = document.getElementById('editUserRole').value;
    const resDiv = document.getElementById('editUserResult');
    try {
        const res = await fetch(`/api/users/${id}`, { method: 'PUT', headers: jsonHeaders(), body: JSON.stringify({ name, email, role }) });
        const data = await res.json();
        if (res.ok) { resDiv.className = 'alert alert-success'; resDiv.textContent = 'Usuario actualizado.'; setTimeout(() => { closeEditUserModal(); loadUsers(); }, 1500); }
        else { resDiv.className = 'alert alert-error'; resDiv.textContent = data.error; }
    } catch (err) { resDiv.className = 'alert alert-error'; resDiv.textContent = 'Error de conexión.'; }
});

// ---------- MODAL DE ACTIVACIÓN MANUAL DE SUSCRIPCIÓN ----------
function openActivateSubscriptionModal(userId, userName, currentPlan) {
    let modal = document.getElementById('activateSubModal');
    if (!modal) {
        const modalHtml = `
            <div id="activateSubModal" class="modal hidden">
                <div class="modal-content">
                    <div class="modal-header">
                        <h3 class="modal-title"><i class="fa-solid fa-crown"></i> Activar Suscripción Manualmente</h3>
                        <i class="fa-solid fa-xmark close-modal" onclick="closeActivateSubModal()"></i>
                    </div>
                    <form id="activateSubForm">
                        <input type="hidden" id="activateUserId">
                        <div class="form-group">
                            <label>Usuario:</label>
                            <input type="text" id="activateUserName" readonly style="background: rgba(255,255,255,0.05); cursor: not-allowed;">
                        </div>
                        <div class="form-group">
                            <label>Plan a asignar:</label>
                            <select id="activatePlan" required>
                                <option value="trial">Trial (14 días gratis)</option>
                                <option value="basic">Basic</option>
                                <option value="pro">Pro ⭐</option>
                                <option value="studio">Studio</option>
                            </select>
                        </div>
                        <div class="form-group">
                            <label>Duración (días):</label>
                            <input type="number" id="activateDays" value="30" min="1" max="365" required>
                            <small style="color: var(--text-muted); display: block; margin-top: 4px;">
                                Para pruebas rápidas usa 1-7 días. Para producción usa 30.
                            </small>
                        </div>
                        <button type="submit" class="btn-primary" style="width: 100%; margin-top: 12px;">
                            <i class="fa-solid fa-bolt"></i> Activar Ahora
                        </button>
                    </form>
                    <div id="activateSubResult" style="margin-top: 12px;"></div>
                </div>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', modalHtml);
        document.getElementById('activateSubForm').addEventListener('submit', submitActivateSubscription);
    }

    modal = document.getElementById('activateSubModal');
    document.getElementById('activateUserId').value = userId;
    document.getElementById('activateUserName').value = userName;
    document.getElementById('activatePlan').value = currentPlan || 'trial';
    document.getElementById('activateDays').value = 30;
    document.getElementById('activateSubResult').innerHTML = '';
    modal.classList.remove('hidden');
}

function closeActivateSubModal() {
    const modal = document.getElementById('activateSubModal');
    if (modal) modal.classList.add('hidden');
}

async function submitActivateSubscription(e) {
    e.preventDefault();
    const userId = document.getElementById('activateUserId').value;
    const plan = document.getElementById('activatePlan').value;
    const days = document.getElementById('activateDays').value;
    const resultDiv = document.getElementById('activateSubResult');
    try {
        const res = await fetch('/api/admin/activate-subscription', {
            method: 'POST',
            headers: { ...authHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id: parseInt(userId), plan, days: parseInt(days) })
        });
        const data = await res.json();
        if (res.ok && data.success) {
            resultDiv.innerHTML = `<div class="alert alert-success"><i class="fa-solid fa-check-circle"></i> ${data.message}</div>`;
            setTimeout(() => { closeActivateSubModal(); if (typeof loadUsers === 'function') loadUsers(); }, 1500);
        } else {
            resultDiv.innerHTML = `<div class="alert alert-error"><i class="fa-solid fa-circle-exclamation"></i> ${data.error || 'Error desconocido'}</div>`;
        }
    } catch (err) {
        resultDiv.innerHTML = `<div class="alert alert-error"><i class="fa-solid fa-circle-exclamation"></i> Error de conexión: ${err.message}</div>`;
    }
}