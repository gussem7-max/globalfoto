// =====================================================
// PANEL DEL FOTÓGRAFO: EVENTOS, FOTOS, PAQUETES, PRECIOS, VENTAS
// =====================================================

let managingEventId = null;

function openModal(eventId = null) {
    document.getElementById('resultadoEvento').textContent = '';
    document.getElementById('eventForm').reset();
    document.getElementById('editEventId').value = '';
    document.getElementById('eventModalTitle').textContent = 'Crear Nuevo Evento';
    document.getElementById('eventSubmitBtn').textContent = 'Guardar Evento';
    document.getElementById('event_status').value = 'published';
    document.getElementById('event_expires').value = '';
    document.getElementById('event_selfie').checked = false;
    if (eventId) {
        const ev = cachedEvents.find(e => e.id === eventId);
        if (ev) {
            document.getElementById('editEventId').value = ev.id;
            document.getElementById('title').value = ev.title;
            document.getElementById('event_date').value = ev.event_date ? ev.event_date.split('T')[0] : '';
            document.getElementById('location').value = ev.location || '';
            document.getElementById('description').value = ev.description || '';
            document.getElementById('event_status').value = ev.status || 'published';
            document.getElementById('event_expires').value = ev.expires_at ? ev.expires_at.slice(0, 16) : '';
            document.getElementById('event_selfie').checked = ev.selfie_required === true;
            document.getElementById('eventModalTitle').textContent = 'Editar Evento';
            document.getElementById('eventSubmitBtn').textContent = 'Actualizar Evento';
        }
    }
    document.getElementById('eventModal').classList.remove('hidden');
}
function closeModal() { document.getElementById('eventModal').classList.add('hidden'); }

function openPackageModal(eventId) {
    document.getElementById('pkgEventId').value = eventId;
    document.getElementById('packageForm').reset();
    document.getElementById('packageResult').textContent = '';
    document.getElementById('packageModal').classList.remove('hidden');
}

document.getElementById('eventForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const editId = document.getElementById('editEventId').value;
    const title = document.getElementById('title').value;
    const rawDate = document.getElementById('event_date').value;
    const location = document.getElementById('location').value;
    const description = document.getElementById('description').value;
    const status = document.getElementById('event_status').value;
    const expires_at = document.getElementById('event_expires').value || null;
    const selfie_required = document.getElementById('event_selfie').checked;
    const resDiv = document.getElementById('resultadoEvento');
    const event_date = rawDate ? new Date(rawDate).toISOString().split('T')[0] : '';
    try {
        const url = editId ? `/api/events/${editId}` : '/api/events';
        const method = editId ? 'PUT' : 'POST';
        const res = await fetch(url, { method, headers: jsonHeaders(), body: JSON.stringify({ title, event_date, location, description, status, expires_at, selfie_required }) });
        const data = await res.json();
        if (res.ok) {
            resDiv.className = 'alert alert-success';
            resDiv.textContent = editId ? 'Evento actualizado.' : '¡Evento creado exitosamente!';
            setTimeout(() => { closeModal(); loadEvents(); if (managingEventId) openManageModal(managingEventId); }, 1000);
        } else { resDiv.className = 'alert alert-error'; resDiv.textContent = data.error || 'Error al guardar el evento.'; }
    } catch (err) { resDiv.className = 'alert alert-error'; resDiv.textContent = 'Error de conexión.'; }
});

document.getElementById('packageForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const eventId = document.getElementById('pkgEventId').value;
    const name = document.getElementById('pkgName').value;
    const photo_limit = document.getElementById('pkgLimit').value;
    const price = document.getElementById('pkgPrice').value;
    const resDiv = document.getElementById('packageResult');
    try {
        const res = await fetch(`/api/events/${eventId}/packages`, { method: 'POST', headers: jsonHeaders(), body: JSON.stringify({ name, photo_limit, price }) });
        const data = await res.json();
        if (res.ok) {
            resDiv.className = 'alert alert-success';
            resDiv.textContent = 'Paquete creado.';
            setTimeout(() => { closePackageModal(); loadPackages(eventId); }, 1000);
        } else { resDiv.className = 'alert alert-error'; resDiv.textContent = data.error; }
    } catch (err) { resDiv.className = 'alert alert-error'; resDiv.textContent = 'Error de conexión.'; }
});

async function loadEventPhotos(eventId) {
    if (cachedPhotos[eventId]) return cachedPhotos[eventId];
    try {
        const res = await fetch(`/api/events/${eventId}/photos`, { headers: authHeaders() });
        if (res.ok) { const data = await res.json(); cachedPhotos[eventId] = data.photos || []; return cachedPhotos[eventId]; }
    } catch (err) { console.error('Error al cargar fotos:', err); }
    return [];
}

function renderPricingSection(ev) {
    const isEditing = editingPricingId === ev.id;
    const hasData = ev.price_per_photo > 0 || ev.nequi_phone;
    const salesEnabled = ev.sales_enabled;
    let html = `<div class="pricing-section"><div class="pricing-header"><h4>💰 Configuración de Ventas</h4><label class="toggle-switch"><input type="checkbox" id="salesToggle_${ev.id}" ${salesEnabled ? 'checked' : ''} onchange="toggleSales(${ev.id})"><span class="toggle-slider"></span></label></div>`;
    if (!salesEnabled) { html += `<div style="font-size: 12px; color: var(--text-muted); padding: 12px; background: rgba(2,6,23,0.6); border-radius: 8px; border: 1px dashed var(--border-strong);"><i class="fa-solid fa-lock"></i> Las ventas están desactivadas. Activa el toggle para configurar precios.</div></div>`; return html; }
    if (isEditing) {
        html += `<div class="pricing-card"><div class="pricing-grid">
            <div class="form-group"><label style="font-size: 12px;">Precio por foto (COP)</label><input type="number" id="pricePhoto_${ev.id}" value="${ev.price_per_photo || 0}" min="0" step="1000"></div>
            <div class="form-group"><label style="font-size: 12px;">Galería completa (COP)</label><input type="number" id="priceGallery_${ev.id}" value="${ev.price_full_gallery || 0}" min="0" step="5000"></div>
            <div class="form-group" style="grid-column: 1/-1;"><label style="font-size: 12px;">Número Nequi del fotógrafo</label><input type="text" id="nequiPhone_${ev.id}" value="${ev.nequi_phone || ''}" placeholder="3001234567"></div>
            <div class="form-group" style="grid-column: 1/-1;"><label style="font-size: 12px;">Nombre titular Nequi</label><input type="text" id="nequiName_${ev.id}" value="${ev.nequi_name || ''}" placeholder="Juan Pérez"></div>
        </div>
        <div class="commission-note"><i class="fa-solid fa-circle-info"></i> <strong>Comisión GlobalFoto:</strong> 10% por venta aprobada.</div>
        <div style="display: flex; gap: 8px; margin-top: 12px;">
            <button onclick="savePricing(${ev.id})" class="btn-primary" style="flex: 1;"><i class="fa-solid fa-save"></i> Guardar</button>
            <button onclick="cancelEditPricing(${ev.id})" class="btn-secondary" style="flex: 1;"><i class="fa-solid fa-xmark"></i> Cancelar</button>
        </div><div id="pricingMsg_${ev.id}"></div></div></div>`;
        return html;
    }
    if (hasData) {
        const photoPrice = ev.price_per_photo ? formatMoney(ev.price_per_photo) : 'No definido';
        const galleryPrice = ev.price_full_gallery ? formatMoney(ev.price_full_gallery) : 'No definido';
        const nequiInfo = ev.nequi_phone ? `${ev.nequi_phone} - ${ev.nequi_name || 'Sin nombre'}` : 'No configurado';
        html += `<div class="pricing-view">
            <div class="pricing-view-row"><span class="pricing-view-label">Precio por foto</span><span class="pricing-view-value">${photoPrice}</span></div>
            <div class="pricing-view-row"><span class="pricing-view-label">Galería completa</span><span class="pricing-view-value">${galleryPrice}</span></div>
            <div class="pricing-view-row"><span class="pricing-view-label">Nequi</span><span class="pricing-view-value">${nequiInfo}</span></div>
            <div class="pricing-view-actions"><button onclick="editPricing(${ev.id})" class="btn-secondary"><i class="fa-solid fa-pen"></i> Editar configuración</button></div>
        </div></div>`;
        return html;
    }
    html += `<div class="pricing-card"><p style="font-size: 12px; color: var(--text-muted); margin-bottom: 12px;"><i class="fa-solid fa-circle-info"></i> Configura tus precios y datos de pago para comenzar a vender.</p>
        <div class="pricing-grid">
            <div class="form-group"><label style="font-size: 12px;">Precio por foto (COP)</label><input type="number" id="pricePhoto_${ev.id}" value="0" min="0" step="1000"></div>
            <div class="form-group"><label style="font-size: 12px;">Galería completa (COP)</label><input type="number" id="priceGallery_${ev.id}" value="0" min="0" step="5000"></div>
            <div class="form-group" style="grid-column: 1/-1;"><label style="font-size: 12px;">Número Nequi del fotógrafo</label><input type="text" id="nequiPhone_${ev.id}" value="" placeholder="3001234567"></div>
            <div class="form-group" style="grid-column: 1/-1;"><label style="font-size: 12px;">Nombre titular Nequi</label><input type="text" id="nequiName_${ev.id}" value="" placeholder="Juan Pérez"></div>
        </div>
        <div class="commission-note"><i class="fa-solid fa-circle-info"></i> <strong>Comisión GlobalFoto:</strong> 10% por venta aprobada.</div>
        <button onclick="savePricing(${ev.id})" class="btn-primary" style="margin-top: 12px;"><i class="fa-solid fa-save"></i> Guardar Precios</button>
        <div id="pricingMsg_${ev.id}"></div></div></div>`;
    return html;
}

async function loadEvents() {
    try {
        const res = await fetch('/api/events', { headers: authHeaders() });
        cachedEvents = await res.json();
        document.getElementById('statEventsCount').textContent = cachedEvents.length;
        let totalPhotos = 0; cachedEvents.forEach(ev => { if (ev.photosCount) totalPhotos += parseInt(ev.photosCount, 10); });
        document.getElementById('statPhotosCount').textContent = totalPhotos;
        const eventList = document.getElementById('eventList');
        if (cachedEvents.length === 0) { eventList.innerHTML = '<p style="color: var(--text-muted);">No tienes eventos registrados aún.</p>'; return; }
        eventList.innerHTML = cachedEvents.map(ev => {
            const statusClass = `status-${ev.status || 'published'}`;
            const statusText = ev.status === 'published' ? 'Publicada' : ev.status === 'draft' ? 'Borrador' : 'Archivada';
            const expiryText = ev.expires_at ? `<span style="color: var(--warning);"><i class="fa-solid fa-clock"></i> Expira: ${new Date(ev.expires_at).toLocaleString('es-CO')}</span>` : '';
            const selfieBadge = ev.selfie_required ? ' <span class="event-status-badge" style="background: rgba(168,85,247,0.15); color: #d8b4fe;">🤳 Selfie</span>' : '';
            return `<div class="event-card">
                <div class="event-header">
                    <div>
                        <div class="event-title">${ev.title} <span class="event-status-badge ${statusClass}">${statusText}</span>${selfieBadge}</div>
                        <div class="event-meta"><span><i class="fa-solid fa-calendar"></i> ${ev.event_date ? ev.event_date.split('T')[0] : ''}</span><span><i class="fa-solid fa-location-dot"></i> ${ev.location || 'Sin ubicación'}</span></div>
                        <div class="event-summary">
                            <span><i class="fa-solid fa-images"></i> <span id="eventSummary_${ev.id}">${ev.photosCount || 0} fotos</span></span>
                            ${ev.price_per_photo ? `<span><i class="fa-solid fa-tag"></i> ${formatMoney(ev.price_per_photo)} / foto</span>` : ''}
                            ${expiryText}
                        </div>
                    </div>
                    <div class="event-actions">
                        <button class="btn-action" onclick="openManageModal(${ev.id})" title="Gestionar evento"><i class="fa-solid fa-pen"></i></button>
                    </div>
                </div>
                <div class="event-thumbs" id="eventThumbs_${ev.id}"></div>
            </div>`;
        }).join('');
        cachedEvents.forEach(async (ev) => {
            const photos = await loadEventPhotos(ev.id);
            renderPhotosPreview(ev.id, photos);
        });
    } catch (err) { console.error('Error al cargar eventos:', err); }
}

// ===== MODAL DE GESTIÓN DE EVENTO =====
function openManageModal(eventId) {
    const ev = cachedEvents.find(e => e.id === eventId);
    if (!ev) return;
    managingEventId = eventId;
    const publicUrl = `${window.location.origin}${ev.event_code ? '/e/' + ev.event_code : '/g/' + ev.id}`;
    document.getElementById('manageEventTitle').textContent = `Gestionar: ${ev.title}`;
    document.getElementById('manageEventBody').innerHTML = `
        <div class="event-manage-actions">
            <button class="btn-secondary" onclick="openModal(${ev.id})"><i class="fa-solid fa-pen"></i> Editar datos</button>
            <button class="btn-danger" onclick="deleteEvent(${ev.id})"><i class="fa-solid fa-trash"></i> Eliminar evento</button>
        </div>
        <div style="display: flex; gap: 6px; align-items: center; margin-bottom: 10px;">
            <span class="code-chip">${ev.event_code || 'SIN-CODIGO'}</span>
            <button class="btn-action" onclick="copyText('${ev.event_code || ''}')" title="Copiar código"><i class="fa-solid fa-copy"></i></button>
        </div>
        <div class="manage-label">Enlace público:</div>
        <div style="display: flex; gap: 6px; margin-bottom: 14px;">
            <input type="text" readonly value="${publicUrl}" id="eventUrl_${ev.id}" class="manage-url">
            <button class="btn-action" onclick="copyEventUrl(${ev.id})" title="Copiar enlace"><i class="fa-solid fa-copy"></i></button>
            <button class="btn-action" onclick="openQrModal(${ev.id}, '${publicUrl}')" title="Generar QR"><i class="fa-solid fa-qrcode"></i></button>
        </div>
        <div class="upload-box">
            <form onsubmit="uploadPhotos(event, ${ev.id})" style="display: flex; width: 100%; gap: 8px;">
                <input type="file" id="fileInput_${ev.id}" multiple accept="image/*" class="file-input" onchange="updateFileLabel(${ev.id})">
                <label for="fileInput_${ev.id}" class="file-label" id="fileLabel_${ev.id}">Seleccionar fotos</label>
                <button type="submit" class="btn-upload">Subir</button>
            </form>
        </div>
        <div id="uploadProgress_${ev.id}"></div>
        <div class="photos-preview">
            <div class="photos-preview-title"><span><i class="fa-solid fa-images"></i> Fotos del evento</span><span id="photosCount_${ev.id}">Cargando...</span></div>
            <div class="photos-grid" id="photosGrid_${ev.id}"></div>
        </div>
        <div class="packages-section">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                <strong style="font-size: 13px;">📦 Paquetes</strong>
                <button class="btn-primary" style="width: auto; padding: 4px 10px; font-size: 11px;" onclick="openPackageModal(${ev.id})">+ Agregar</button>
            </div>
            <div id="packagesList_${ev.id}">Cargando...</div>
        </div>
        ${renderPricingSection(ev)}
    `;
    document.getElementById('manageEventModal').classList.remove('hidden');
    renderPhotosPreview(eventId, cachedPhotos[eventId] || []);
    loadPackages(eventId);
}

function closeManageModal() {
    document.getElementById('manageEventModal').classList.add('hidden');
    managingEventId = null;
}

function renderPhotosPreview(eventId, photos) {
    const grid = document.getElementById(`photosGrid_${eventId}`);
    const countLabel = document.getElementById(`photosCount_${eventId}`);
    const summary = document.getElementById(`eventSummary_${eventId}`);
    const thumbsRow = document.getElementById(`eventThumbs_${eventId}`);

    if (summary) summary.textContent = `${photos.length} foto${photos.length !== 1 ? 's' : ''}`;

    if (thumbsRow) {
        if (photos.length === 0) {
            thumbsRow.innerHTML = '<span class="thumb-empty">Sin fotos aún</span>';
        } else {
            const maxRow = 5;
            const shown = photos.slice(0, maxRow).map(p =>
                `<img src="${p.preview_url || p.url}" onclick="openLightbox('${p.preview_url || p.url}')" title="Ver foto">`
            ).join('');
            const remaining = photos.length - maxRow;
            const more = remaining > 0 ? `<div class="thumb-more">+${remaining}</div>` : '';
            thumbsRow.innerHTML = shown + more;
        }
    }

    if (!grid) return;
    if (photos.length === 0) { grid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 12px; font-size: 12px; color: var(--text-muted);">Sin fotos aún. ¡Sube la primera!</div>'; if (countLabel) countLabel.textContent = '0 fotos'; return; }
    const thumbs = photos.map(p => `<div class="photo-thumb" style="position: relative;">
        <img src="${p.preview_url || p.url}" onclick="openLightbox('${p.preview_url || p.url}')" title="Ver foto">
        <button class="delete-photo" onclick="deletePhoto(${p.id}, ${eventId})" title="Eliminar foto"><i class="fa-solid fa-xmark"></i></button>
    </div>`).join('');
    grid.innerHTML = thumbs;
    if (countLabel) countLabel.textContent = `${photos.length} foto${photos.length !== 1 ? 's' : ''}`;
}

async function deletePhoto(photoId, eventId) {
    if (!confirm('¿Eliminar esta foto?')) return;
    try {
        const res = await fetch(`/api/events/photos/${photoId}`, { method: 'DELETE', headers: authHeaders() });
        if (res.ok) {
            delete cachedPhotos[eventId];
            const photos = await loadEventPhotos(eventId);
            renderPhotosPreview(eventId, photos);
            loadEvents();
        } else { const data = await res.json(); alert(data.error || 'Error al eliminar.'); }
    } catch (err) { alert('Error de conexión.'); }
}

function updateFileLabel(eventId) {
    const input = document.getElementById(`fileInput_${eventId}`);
    const label = document.getElementById(`fileLabel_${eventId}`);
    if (input.files.length > 0) label.textContent = `${input.files.length} foto(s) seleccionada(s)`;
    else label.textContent = 'Seleccionar fotos';
}

async function normalizeImageFile(file) {
    try {
        const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
        const canvas = document.createElement('canvas');
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(bitmap, 0, 0);
        if (bitmap.close) bitmap.close();
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.92));
        if (blob) {
            return new File([blob], file.name.replace(/\.\w+$/, '.jpg'), { type: 'image/jpeg' });
        }
    } catch (e) {
        console.warn('No se pudo normalizar la orientación; se sube el original:', e);
    }
    return file;
}

async function uploadPhotos(e, eventId) {
    e.preventDefault();
    const input = document.getElementById(`fileInput_${eventId}`);
    if (!input.files || input.files.length === 0) { alert('Por favor selecciona al menos una foto.'); return; }
    const progressDiv = document.getElementById(`uploadProgress_${eventId}`);
    progressDiv.innerHTML = '<div class="upload-progress"><i class="fa-solid fa-spinner fa-spin"></i> Preparando y subiendo fotos... Por favor espera.</div>';
    const formData = new FormData();
    formData.append('event_id', eventId);
    for (let i = 0; i < input.files.length; i++) {
        const normalized = await normalizeImageFile(input.files[i]);
        formData.append('photos', normalized);
    }
    try {
        const res = await fetch('/api/photos/upload', { method: 'POST', headers: authHeaders(), body: formData });
        const data = await res.json();
        if (res.ok) {
            progressDiv.innerHTML = `<div class="upload-progress success"><i class="fa-solid fa-check"></i> ${data.mensaje || 'Fotos subidas exitosamente'}</div>`;
            delete cachedPhotos[eventId];
            const photos = await loadEventPhotos(eventId);
            renderPhotosPreview(eventId, photos);
            loadEvents();
            setTimeout(() => { const p = document.getElementById(`uploadProgress_${eventId}`); if (p) p.innerHTML = ''; }, 2000);
        } else {
            progressDiv.innerHTML = `<div class="upload-progress error"><i class="fa-solid fa-xmark"></i> Error: ${data.error || 'Desconocido'}</div>`;
        }
    } catch (err) {
        progressDiv.innerHTML = '<div class="upload-progress error"><i class="fa-solid fa-xmark"></i> Error de conexión. Verifica tu internet.</div>';
    } finally {
        input.value = '';
        const lbl = document.getElementById(`fileLabel_${eventId}`);
        if (lbl) lbl.textContent = 'Seleccionar fotos';
    }
}

async function deleteEvent(id) {
    if (!confirm('¿Estás seguro de eliminar este evento y todas sus fotos?')) return;
    try {
        const res = await fetch(`/api/events/${id}`, { method: 'DELETE', headers: authHeaders() });
        if (res.ok) { closeManageModal(); loadEvents(); }
        else alert('No se pudo eliminar el evento.');
    } catch (err) { alert('Error de conexión.'); }
}

async function loadPackages(eventId) {
    try {
        const res = await fetch(`/api/events/${eventId}/packages`, { headers: authHeaders() });
        const packages = await res.json();
        const container = document.getElementById(`packagesList_${eventId}`);
        if (!container) return;
        if (packages.length === 0) { container.innerHTML = '<small style="color: var(--text-muted);">Sin paquetes</small>'; return; }
        container.innerHTML = packages.map(p => `<div class="package-item"><span><strong>${p.name}</strong> (${p.photo_limit} fotos) - ${formatMoney(p.price)}</span><button class="btn-danger" style="padding: 4px 8px;" onclick="deletePackage(${p.id}, ${eventId})"><i class="fa-solid fa-trash"></i></button></div>`).join('');
    } catch (err) { console.error('Error cargando paquetes:', err); }
}

async function deletePackage(packageId, eventId) {
    if (!confirm('¿Eliminar paquete?')) return;
    await fetch(`/api/events/packages/${packageId}`, { method: 'DELETE', headers: authHeaders() });
    loadPackages(eventId);
}

function renderGalleriesView() {
    const grid = document.getElementById('galleriesGrid');
    if (cachedEvents.length === 0) { grid.innerHTML = '<p style="color: var(--text-muted);">No hay galerías disponibles.</p>'; return; }
    grid.innerHTML = cachedEvents.map(ev => {
        const publicUrl = `${window.location.origin}${ev.event_code ? '/e/' + ev.event_code : '/g/' + ev.id}`;
        const statusText = ev.status === 'published' ? 'Publicada' : ev.status === 'draft' ? 'Borrador' : 'Archivada';
        return `<div class="event-card">
            <div class="event-header" style="cursor: default;"><div><div class="event-title">${ev.title} <span class="event-status-badge status-${ev.status}">${statusText}</span></div><div class="event-meta"><span>${ev.event_date ? ev.event_date.split('T')[0] : ''}</span></div></div></div>
            <div class="event-thumbs" id="galleryThumbs_${ev.id}"></div>
            <div class="event-body"><a href="${publicUrl}" target="_blank" class="btn-primary" style="text-align: center; text-decoration: none; display: block;">Visitar Galería Pública <i class="fa-solid fa-external-link-alt"></i></a></div>
        </div>`;
    }).join('');
    cachedEvents.forEach(async (ev) => {
        const photos = await loadEventPhotos(ev.id);
        const row = document.getElementById(`galleryThumbs_${ev.id}`);
        if (row) {
            row.innerHTML = photos.length === 0
                ? '<span class="thumb-empty">Sin fotos aún</span>'
                : photos.slice(0, 5).map(p => `<img src="${p.preview_url || p.url}">`).join('') + (photos.length > 5 ? `<div class="thumb-more">+${photos.length - 5}</div>` : '');
        }
    });
}

async function toggleSales(eventId) {
    const checkbox = document.getElementById(`salesToggle_${eventId}`);
    const salesEnabled = checkbox.checked;
    if (!salesEnabled) {
        const ev = cachedEvents.find(e => e.id === eventId);
        if (ev && (ev.price_per_photo > 0 || ev.nequi_phone)) {
            if (!confirm('¿Desactivar las ventas? Los precios configurados se mantendrán guardados.')) { checkbox.checked = true; return; }
        }
    }
    try {
        const res = await fetch(`/api/events/${eventId}/pricing`, { method: 'PUT', headers: jsonHeaders(), body: JSON.stringify({ price_per_photo: 0, price_full_gallery: 0, currency: 'COP', nequi_phone: '', nequi_name: '', sales_enabled: salesEnabled, qr_code_url: '' }) });
        if (res.ok) { await loadEvents(); if (managingEventId) openManageModal(managingEventId); }
        else { alert('Error al actualizar.'); checkbox.checked = !salesEnabled; }
    } catch (err) { alert('Error de conexión.'); checkbox.checked = !salesEnabled; }
}

function editPricing(eventId) { editingPricingId = eventId; if (managingEventId) openManageModal(managingEventId); }
function cancelEditPricing(eventId) { editingPricingId = null; if (managingEventId) openManageModal(managingEventId); }

async function savePricing(eventId) {
    const msgDiv = document.getElementById(`pricingMsg_${eventId}`);
    const btn = msgDiv ? msgDiv.previousElementSibling : null;
    const data = {
        price_per_photo: parseFloat(document.getElementById(`pricePhoto_${eventId}`).value) || 0,
        price_full_gallery: parseFloat(document.getElementById(`priceGallery_${eventId}`).value) || 0,
        currency: 'COP',
        nequi_phone: document.getElementById(`nequiPhone_${eventId}`).value.trim(),
        nequi_name: document.getElementById(`nequiName_${eventId}`).value.trim(),
        sales_enabled: true, qr_code_url: ''
    };
    if (btn) { btn.disabled = true; btn.style.opacity = '0.6'; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Guardando...'; }
    try {
        const res = await fetch(`/api/events/${eventId}/pricing`, { method: 'PUT', headers: jsonHeaders(), body: JSON.stringify(data) });
        const result = await res.json();
        if (res.ok) {
            editingPricingId = null;
            if (msgDiv) { msgDiv.className = 'alert alert-success'; msgDiv.innerHTML = '<i class="fa-solid fa-circle-check"></i> ✓ Configuración guardada'; }
            setTimeout(() => { loadEvents(); if (managingEventId) openManageModal(managingEventId); }, 800);
        } else { if (msgDiv) { msgDiv.className = 'alert alert-error'; msgDiv.textContent = `Error: ${result.error}`; } }
    } catch (err) { if (msgDiv) { msgDiv.className = 'alert alert-error'; msgDiv.textContent = `Error de red: ${err.message}`; } }
    finally { if (btn) { btn.disabled = false; btn.style.opacity = ''; btn.innerHTML = '<i class="fa-solid fa-save"></i> Guardar'; } }
}

// ---------- VENTAS / PEDIDOS ----------
async function loadPendingOrdersCount() {
    try {
        const res = await fetch('/api/orders/photographer?status=pending', { headers: authHeaders() });
        if (res.ok) {
            const data = await res.json();
            const count = data.orders.length;
            const badge = document.getElementById('pendingOrdersBadge');
            if (count > 0) { badge.textContent = count; badge.classList.remove('hidden'); } else { badge.classList.add('hidden'); }
        }
    } catch (err) { console.error('Error al cargar pedidos pendientes:', err); }
}

async function loadOrders() {
    try {
        const res = await fetch('/api/orders/photographer', { headers: authHeaders() });
        if (!res.ok) throw new Error('Error al cargar pedidos');
        const data = await res.json();
        cachedOrders = data.orders;
        const pending = cachedOrders.filter(o => o.status === 'pending').length;
        const approved = cachedOrders.filter(o => o.status === 'approved').length;
        const totalRevenue = cachedOrders.filter(o => o.status === 'approved').reduce((sum, o) => sum + parseFloat(o.photographer_net || 0), 0);
        document.getElementById('pendingCount').textContent = pending;
        document.getElementById('approvedCount').textContent = approved;
        document.getElementById('totalRevenue').textContent = formatMoney(totalRevenue);
        const ordersList = document.getElementById('ordersList');
        if (cachedOrders.length === 0) { ordersList.innerHTML = '<div class="empty-state"><i class="fa-solid fa-cart-shopping"></i><p>No hay pedidos aún</p></div>'; return; }
        ordersList.innerHTML = cachedOrders.map(order => {
            const statusClass = `status-${order.status}`;
            const statusText = order.status === 'pending' ? 'Pendiente' : order.status === 'approved' ? 'Aprobado' : 'Rechazado';
            const date = new Date(order.created_at).toLocaleDateString('es-CO');
            return `<div class="order-card">
                <img src="${order.receipt_url}" class="order-receipt" onclick="viewOrderDetails(${order.id})" title="Ver comprobante">
                <div class="order-details">
                    <div class="order-header">
                        <div><div class="order-title">Pedido #${order.id} - ${order.event_title}</div>
                        <div class="order-info"><strong>Cliente:</strong> ${order.customer_name || order.customer_email}<br><strong>Email:</strong> ${order.customer_email}<br><strong>Tipo:</strong> ${order.order_type === 'gallery' ? 'Galería completa' : order.order_type === 'package' ? 'Paquete' : `${(JSON.parse(order.photo_ids || '[]')).length} foto(s)`}<br><strong>Fecha:</strong> ${date}</div></div>
                        <span class="order-status ${statusClass}">${statusText}</span>
                    </div>
                    <div class="order-info"><strong>Monto:</strong> ${formatMoney(order.amount)} | <strong>Tu ganancia:</strong> ${formatMoney(order.photographer_net)}</div>
                    ${order.status === 'pending' ? `<div class="order-actions"><button onclick="approveOrder(${order.id})" class="btn-success"><i class="fa-solid fa-check"></i> Aprobar</button><button onclick="rejectOrder(${order.id})" class="btn-danger"><i class="fa-solid fa-xmark"></i> Rechazar</button><button onclick="viewOrderDetails(${order.id})" class="btn-secondary" style="width: auto; padding: 10px 16px;"><i class="fa-solid fa-eye"></i> Ver detalles</button></div>` : ''}
                </div>
            </div>`;
        }).join('');
    } catch (err) { console.error('Error al cargar pedidos:', err); document.getElementById('ordersList').innerHTML = '<div class="alert alert-error">Error al cargar los pedidos.</div>'; }
}

function viewOrderDetails(orderId) {
    const order = cachedOrders.find(o => o.id === orderId);
    if (!order) return;
    const modalContent = document.getElementById('orderModalContent');
    modalContent.innerHTML = `
        <div style="margin-bottom: 20px;"><img src="${order.receipt_url}" style="width: 100%; max-height: 400px; object-fit: contain; border-radius: 8px; border: 1px solid var(--border-strong);"></div>
        <div style="background: rgba(2,6,23,0.6); padding: 16px; border-radius: 12px; margin-bottom: 20px; border: 1px solid var(--border-color);">
            <h4 style="margin-bottom: 12px; color: var(--text-main);">Información del Pedido</h4>
            <p style="font-size: 13px; color: var(--text-muted); margin-bottom: 8px;"><strong>Cliente:</strong> ${order.customer_name || 'No especificado'}</p>
            <p style="font-size: 13px; color: var(--text-muted); margin-bottom: 8px;"><strong>Email:</strong> ${order.customer_email}</p>
            <p style="font-size: 13px; color: var(--text-muted); margin-bottom: 8px;"><strong>Evento:</strong> ${order.event_title}</p>
            <p style="font-size: 13px; color: var(--text-muted); margin-bottom: 8px;"><strong>Tipo:</strong> ${order.order_type === 'gallery' ? 'Galería completa' : order.order_type === 'package' ? 'Paquete' : `${(JSON.parse(order.photo_ids || '[]')).length} foto(s)`}</p>
            <p style="font-size: 13px; color: var(--text-muted); margin-bottom: 8px;"><strong>Monto total:</strong> ${formatMoney(order.amount)}</p>
            <p style="font-size: 13px; color: var(--text-muted); margin-bottom: 8px;"><strong>Tu ganancia (90%):</strong> ${formatMoney(order.photographer_net)}</p>
            <p style="font-size: 13px; color: var(--text-muted);"><strong>Comisión GlobalFoto (10%):</strong> ${formatMoney(order.commission_amount)}</p>
        </div>
        ${order.status === 'pending' ? `<div style="display: flex; gap: 8px;"><button onclick="approveOrder(${order.id}); closeOrderModal();" class="btn-success" style="flex: 1;"><i class="fa-solid fa-check"></i> Aprobar Pedido</button><button onclick="rejectOrder(${order.id}); closeOrderModal();" class="btn-danger" style="flex: 1;"><i class="fa-solid fa-xmark"></i> Rechazar</button></div>` : `<div class="alert ${order.status === 'approved' ? 'alert-success' : 'alert-error'}">Pedido ${order.status === 'approved' ? 'aprobado' : 'rechazado'}</div>`}
    `;
    document.getElementById('orderModal').classList.remove('hidden');
}

async function approveOrder(orderId) {
    if (!confirm('¿Aprobar este pedido? Se enviará un email al cliente con los enlaces de descarga.')) return;
    const btn = event.target.closest('button');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Procesando...'; }
    try {
        const res = await fetch(`/api/orders/${orderId}/approve`, { method: 'PUT', headers: authHeaders() });
        const data = await res.json();
        if (res.ok) { alert('✅ Pedido aprobado. Email enviado al cliente.'); await loadOrders(); await loadPendingOrdersCount(); }
        else { alert(`Error: ${data.error || 'Error desconocido'}`); if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-check"></i> Aprobar'; } }
    } catch (err) { console.error('Error al aprobar:', err); alert('Error de conexión.'); if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-check"></i> Aprobar'; } }
}

async function rejectOrder(orderId) {
    const reason = prompt('Motivo del rechazo (opcional):');
    if (reason === null) return;
    try {
        const res = await fetch(`/api/orders/${orderId}/reject`, { method: 'PUT', headers: jsonHeaders(), body: JSON.stringify({ reason: reason || 'Sin motivo especificado' }) });
        if (res.ok) { alert('❌ Pedido rechazado. Cliente notificado.'); loadOrders(); loadPendingOrdersCount(); }
        else { const data = await res.json(); alert(`Error: ${data.error}`); }
    } catch (err) { alert('Error de conexión.'); }
}

// ---------- COPIAR ENLACE, QR Y UTILIDADES ----------
async function copyEventUrl(eventId) {
    const input = document.getElementById(`eventUrl_${eventId}`);
    if (!input) return;
    try {
        await navigator.clipboard.writeText(input.value);
        const btn = input.nextElementSibling;
        if (btn) {
            const original = btn.innerHTML;
            btn.innerHTML = '<i class="fa-solid fa-check" style="color: var(--success);"></i>';
            setTimeout(() => { btn.innerHTML = original; }, 1500);
        }
    } catch (err) {
        input.select();
        document.execCommand('copy');
        alert('Enlace copiado: ' + input.value);
    }
}

async function copyText(text) {
    if (!text) return;
    try {
        await navigator.clipboard.writeText(text);
    } catch (err) {
        const tmp = document.createElement('textarea');
        tmp.value = text;
        document.body.appendChild(tmp);
        tmp.select();
        document.execCommand('copy');
        tmp.remove();
    }
}

let currentQrUrl = '';

function openQrModal(eventId, url) {
    currentQrUrl = url;
    document.getElementById('qrModal').classList.remove('hidden');
    generateQr(url);
}

function closeQrModal() {
    document.getElementById('qrModal').classList.add('hidden');
}

async function generateQr(url) {
    const container = document.getElementById('qrCanvasContainer');
    container.innerHTML = '';
    const canvas = document.createElement('canvas');
    canvas.id = 'qrCanvas';
    canvas.width = 400;
    canvas.height = 400;
    container.appendChild(canvas);
    const statusMsg = document.createElement('p');
    statusMsg.style.cssText = 'color: var(--text-muted); margin: 10px 0;';
    statusMsg.textContent = 'Generando QR...';
    canvas.style.display = 'none';
    container.appendChild(statusMsg);
    const timeout = setTimeout(() => {
        statusMsg.textContent = '⚠️ El QR tardó demasiado. Intenta de nuevo.';
        statusMsg.style.color = 'var(--danger)';
    }, 10000);
    try {
        if (typeof QRCode !== 'undefined') {
            await QRCode.toCanvas(canvas, url, { width: 400, margin: 3, color: { dark: '#0f172a', light: '#ffffff' }, errorCorrectionLevel: 'H' });
            canvas.style.display = 'block';
            if (statusMsg.parentNode) statusMsg.remove();
            clearTimeout(timeout);
            return;
        }
        throw new Error('QRCode no disponible');
    } catch (err) {
        console.warn('Librería QR falló, usando API pública:', err.message);
        try {
            const qrApiUrl = `https://api.qrserver.com/v1/create-qr-code/?size=400x400&margin=15&color=0f172a&bgcolor=ffffff&ecc=H&data=${encodeURIComponent(url)}`;
            const img = new Image();
            img.crossOrigin = 'anonymous';
            await new Promise((resolve, reject) => {
                img.onload = () => {
                    canvas.width = 400; canvas.height = 400;
                    const ctx = canvas.getContext('2d');
                    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, 400, 400);
                    ctx.drawImage(img, 0, 0, 400, 400);
                    resolve();
                };
                img.onerror = () => reject(new Error('No se pudo cargar la imagen QR'));
                img.src = qrApiUrl;
            });
            canvas.style.display = 'block';
            if (statusMsg.parentNode) statusMsg.remove();
            clearTimeout(timeout);
        } catch (fallbackErr) {
            console.error('Error en fallback QR:', fallbackErr);
            clearTimeout(timeout);
            statusMsg.textContent = '⚠️ No se pudo generar el QR. Verifica tu conexión.';
            statusMsg.style.color = 'var(--danger)';
        }
    }
}

function downloadQr() {
    const canvas = document.getElementById('qrCanvas');
    const link = document.createElement('a');
    link.download = `globalfoto-qr-${Date.now()}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
}