// =====================================================
// PANEL DE ADMINISTRACIÓN Y GESTIÓN DE USUARIOS
// =====================================================

async function loadAdmin() {
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
        adminTab('events');
    } catch (err) { console.error('Error loadAdmin:', err); }
}

async function adminTab(tab) {
    ['events', 'photos', 'orders'].forEach(t => {
        const btn = document.getElementById('tabAdmin' + t.charAt(0).toUpperCase() + t.slice(1));
        if (btn) btn.classList.toggle('active', t === tab);
    });
    const content = document.getElementById('adminContent');
    content.innerHTML = '<p style="color: var(--text-muted); padding: 20px;">Cargando...</p>';
    try {
        const res = await fetch(`/api/admin/${tab}`, { headers: authHeaders() });
        const data = await res.json();
        if (tab === 'events') renderAdminEvents(data);
        else if (tab === 'photos') renderAdminPhotos(data);
        else renderAdminOrders(data);
    } catch (err) {
        content.innerHTML = '<div class="alert alert-error">Error al cargar la información.</div>';
    }
}

function renderAdminEvents(events) {
    const content = document.getElementById('adminContent');
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

function renderAdminPhotos(photos) {
    const content = document.getElementById('adminContent');
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

function renderAdminOrders(orders) {
    const content = document.getElementById('adminContent');
    if (!orders || orders.length === 0) { content.innerHTML = '<div class="empty-state"><i class="fa-solid fa-cart-shopping"></i><p>No hay pedidos en la plataforma.</p></div>'; return; }
    content.innerHTML = `<div style="background:white;border-radius:12px;border:1px solid var(--border-color);overflow-x:auto;">
        <table style="width:100%;border-collapse:collapse;text-align:left;min-width:700px;">
            <thead style="background:#f8fafc;border-bottom:1px solid var(--border-color);">
                <tr>
                    <th style="padding:14px;font-size:12px;color:var(--text-muted);">#</th>
                    <th style="padding:14px;font-size:12px;color:var(--text-muted);">Cliente</th>
                    <th style="padding:14px;font-size:12px;color:var(--text-muted);">Evento</th>
                    <th style="padding:14px;font-size:12px;color:var(--text-muted);">Fotógrafo</th>
                    <th style="padding:14px;font-size:12px;color:var(--text-muted);">Monto</th>
                    <th style="padding:14px;font-size:12px;color:var(--text-muted);">Comisión</th>
                    <th style="padding:14px;font-size:12px;color:var(--text-muted);">Estado</th>
                </tr>
            </thead>
            <tbody>` + orders.map(o => `
                <tr style="border-bottom:1px solid var(--border-color);">
                    <td style="padding:12px;font-size:13px;">${o.id}</td>
                    <td style="padding:12px;font-size:13px;">${o.customer_name}<br><small style="color:var(--text-muted);">${o.customer_email}</small></td>
                    <td style="padding:12px;font-size:13px;">${o.event_title}</td>
                    <td style="padding:12px;font-size:13px;">${o.photographer_name}</td>
                    <td style="padding:12px;font-size:13px;font-weight:600;">${formatMoney(o.amount)}</td>
                    <td style="padding:12px;font-size:13px;color:#065f46;">${formatMoney(o.commission_amount)}</td>
                    <td style="padding:12px;"><span class="order-status status-${o.status}">${o.status === 'pending' ? 'Pendiente' : o.status === 'approved' ? 'Aprobado' : 'Rechazado'}</span></td>
                </tr>
            `).join('') + `</tbody></table></div>`;
}

async function adminDeleteEvent(id) {
    if (!confirm('⚠️ Como administrador, eliminarás este evento y TODAS sus fotos de cualquier fotógrafo. ¿Continuar?')) return;
    try {
        const res = await fetch(`/api/admin/events/${id}`, { method: 'DELETE', headers: authHeaders() });
        if (res.ok) { alert('Evento eliminado.'); loadAdmin(); }
        else { const d = await res.json(); alert(d.error); }
    } catch (err) { alert('Error de conexión.'); }
}

async function adminDeletePhoto(id) {
    if (!confirm('⚠️ Eliminarás esta foto permanentemente. ¿Continuar?')) return;
    try {
        const res = await fetch(`/api/admin/photos/${id}`, { method: 'DELETE', headers: authHeaders() });
        if (res.ok) { alert('Foto eliminada.'); adminTab('photos'); }
        else { const d = await res.json(); alert(d.error); }
    } catch (err) { alert('Error de conexión.'); }
}

// ---------- GESTIÓN DE USUARIOS ----------
async function loadUsers() {
    if (!currentUser || currentUser.role !== 'admin') { alert('No tienes permisos.'); showSection('events'); return; }
    const tbody = document.getElementById('usersTableBody');
    tbody.innerHTML = '<tr><td colspan="5" style="padding: 20px; text-align: center; color: var(--text-muted);">Cargando usuarios...</td></tr>';
    try {
        const res = await fetch('/api/users', { headers: authHeaders() });
        if (res.ok) {
            const users = await res.json();
            if (users.length === 0) { tbody.innerHTML = '<tr><td colspan="5" style="padding: 20px; text-align: center; color: var(--text-muted);">No hay usuarios registrados aún.</td></tr>'; return; }
            tbody.innerHTML = users.map(u => {
                const fecha = new Date(u.created_at).toLocaleDateString('es-CO', { year: 'numeric', month: 'short', day: 'numeric' });
                const roleBadge = u.role === 'admin' ? '<span style="background: #fef3c7; color: #92400e; padding: 4px 8px; border-radius: 6px; font-size: 12px; font-weight: 600;">Admin</span>' : '<span style="background: #eff6ff; color: #2563eb; padding: 4px 8px; border-radius: 6px; font-size: 12px; font-weight: 600;">Fotógrafo</span>';
                const actionButtons = u.id !== currentUser.id ? `<button onclick="openEditUserModal(${u.id}, '${u.name.replace(/'/g, "\\'")}', '${u.email}', '${u.role}')" class="btn-warning" style="margin-right: 4px;"><i class="fa-solid fa-pen"></i></button><button onclick="deleteUser(${u.id})" class="btn-danger"><i class="fa-solid fa-trash"></i></button>` : '<span style="font-size: 11px; color: var(--text-muted);">(Tú)</span>';
                return `<tr style="border-bottom: 1px solid var(--border-color);"><td style="padding: 16px; font-size: 14px; font-weight: 500;">${u.name}</td><td style="padding: 16px; font-size: 14px; color: #475569;">${u.email}</td><td style="padding: 16px;">${roleBadge}</td><td style="padding: 16px; font-size: 13px; color: #64748b;">${fecha}</td><td style="padding: 16px;">${actionButtons}</td></tr>`;
            }).join('');
        }
    } catch (err) { tbody.innerHTML = '<tr><td colspan="5" style="padding: 20px; text-align: center; color: var(--danger);">Error al cargar la lista.</td></tr>'; }
}

function openEditUserModal(id, name, email, role) {
    document.getElementById('editUserId').value = id;
    document.getElementById('editUserName').value = name;
    document.getElementById('editUserEmail').value = email;
    document.getElementById('editUserRole').value = role;
    document.getElementById('editUserModal').classList.remove('hidden');
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