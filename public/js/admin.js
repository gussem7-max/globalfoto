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

// === MODAL DE ACTIVACIÓN MANUAL DE SUSCRIPCIÓN ===

function openActivateSubscriptionModal(userId, userName, currentPlan) {
    let modal = document.getElementById('activateSubModal');
    if (!modal) {
        // Crear el modal dinámicamente si no existe
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
        
        // Adjuntar listener al formulario recién creado
        document.getElementById('activateSubForm').addEventListener('submit', submitActivateSubscription);
    }
    
    modal = document.getElementById('activateSubModal');
    
    // Rellenar datos del usuario seleccionado
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
            
            // Recargar lista de usuarios tras 1.5 segundos
            setTimeout(() => {
                closeActivateSubModal();
                if (typeof loadUsers === 'function') loadUsers();
            }, 1500);
        } else {
            resultDiv.innerHTML = `<div class="alert alert-error"><i class="fa-solid fa-circle-exclamation"></i> ${data.error || 'Error desconocido'}</div>`;
        }
    } catch (err) {
        resultDiv.innerHTML = `<div class="alert alert-error"><i class="fa-solid fa-circle-exclamation"></i> Error de conexión: ${err.message}</div>`;
    }
}