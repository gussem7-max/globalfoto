// =====================================================
// GALERÍA PÚBLICA, SELECCIÓN Y COMPRAS
// =====================================================

async function loadPublicGallery(eventId) {
    document.getElementById('authContainer').classList.add('hidden');
    document.getElementById('dashboardContainer').classList.add('hidden');
    document.getElementById('publicView').classList.remove('hidden');
    selectedPhotos.clear();
    try {
        const res = await fetch(`/api/events/${eventId}/public`);
        const data = await res.json();
        if (!res.ok) {
            document.getElementById('pubEventTitle').textContent = 'Galería no disponible';
            document.getElementById('pubEventDetails').innerHTML = `<div class="gallery-closed"><i class="fa-solid fa-lock"></i><p>${data.error || 'Esta galería está cerrada o ha expirado.'}</p></div>`;
            document.getElementById('pubPhotoGrid').innerHTML = '';
            document.getElementById('pubPackagesGrid').innerHTML = '';
            document.getElementById('pubPricingBar').classList.add('hidden');
            return;
        }
        currentPublicEvent = data.event;
        currentPublicEvent.packages = data.packages || [];
        document.getElementById('pubEventTitle').textContent = data.event.title;

        const zipDownloadUrl = `/api/events/${eventId}/download-zip`;
        document.getElementById('pubEventDetails').innerHTML = `<div style="margin-bottom: 16px;">📅 ${data.event.event_date ? data.event.event_date.split('T')[0] : ''} | 📍 ${data.event.location || ''}<br>${data.event.description || ''}</div>${data.photos.length > 0 && !data.event.sales_enabled ? `<a href="${zipDownloadUrl}" class="btn-primary" style="display: inline-flex; align-items: center; gap: 8px; width: auto; padding: 10px 20px; text-decoration: none; margin-top: 8px;"><i class="fa-solid fa-file-zipper"></i> Descargar Todas las Fotos (.ZIP)</a>` : ''}`;

        // 🤳 Si el evento requiere selfie, mostrar gate y NO revelar fotos aún
        if (data.event.selfie_required) {
            document.getElementById('pubPackagesGrid').innerHTML = '';
            document.getElementById('pubPricingBar').classList.add('hidden');
            document.getElementById('pubPhotoGrid').innerHTML = '';
            pendingGalleryPhotos = data.photos;
            showSelfieGate();
            return;
        }

        revealGallery(data.photos);
    } catch (err) { document.getElementById('pubEventTitle').textContent = 'Error de conexión'; }
}

// Revela paquetes + barra de precios + fotos (tras verificación o directo)
function revealGallery(photos) {
    renderPackages();
    renderPricingBar();
    renderPublicPhotos(photos);
    ensureSelectionCounter();
    document.getElementById('publicView').oncontextmenu = (e) => { e.preventDefault(); return false; };
}

function renderPackages() {
    const pkgGrid = document.getElementById('pubPackagesGrid');
    if (currentPublicEvent.packages.length > 0) {
        pkgGrid.innerHTML = currentPublicEvent.packages.map((p, idx) => `
            <div class="package-card ${idx === 0 ? 'featured' : ''}">
                <h3>${p.name}</h3>
                <div class="price">${formatMoney(p.price)}</div>
                <div class="limit">Incluye ${p.photo_limit} fotos a elección</div>
                <div class="howto">💡 Selecciona exactamente <strong>${p.photo_limit} fotos</strong> con el círculo y este precio se aplicará automáticamente al comprar.</div>
            </div>
        `).join('');
    } else { pkgGrid.innerHTML = ''; }
}

function renderPricingBar() {
    const pricingBar = document.getElementById('pubPricingBar');
    if (currentPublicEvent.sales_enabled && (currentPublicEvent.price_per_photo > 0 || currentPublicEvent.price_full_gallery > 0)) {
        pricingBar.classList.remove('hidden');
        document.getElementById('pubPricePhoto').textContent = currentPublicEvent.price_per_photo ? formatMoney(currentPublicEvent.price_per_photo) : 'No definido';
        document.getElementById('pubPriceGallery').textContent = currentPublicEvent.price_full_gallery ? formatMoney(currentPublicEvent.price_full_gallery) : 'No definido';
    } else { pricingBar.classList.add('hidden'); }
}

function renderPublicPhotos(photos) {
    const grid = document.getElementById('pubPhotoGrid');
    if (!photos || photos.length === 0) {
        grid.innerHTML = '<p style="color: #94a3b8; grid-column: 1/-1; text-align: center;">Este evento aún no tiene fotografías publicadas.</p>';
        return;
    }
    grid.innerHTML = photos.map(p => {
        const safeUrl = p.preview_url || p.url;
        return `<div class="public-photo-card" id="photoCard_${p.id}">
            <div class="public-photo-wrapper" onclick="openLightbox('${safeUrl}')">
                <img src="${safeUrl}" class="public-photo-img" oncontextmenu="return false;" ondragstart="return false;" style="pointer-events: none; user-select: none;">
                <div class="photo-watermark">GlobalFoto</div>
            </div>
            <button class="photo-select-check" onclick="togglePhotoSelection(${p.id})" title="Seleccionar esta foto">
                <i class="fa-solid fa-check"></i>
            </button>
            <div class="public-photo-footer">
                <span class="photo-price-tag">${currentPublicEvent.price_per_photo ? formatMoney(currentPublicEvent.price_per_photo) : 'Consultar'}</span>
                <button class="btn-buy-photo" onclick="openPurchaseModal('single', ${p.id})"><i class="fa-solid fa-cart-shopping"></i> Comprar</button>
            </div>
        </div>`;
    }).join('');
}

function ensureSelectionCounter() {
    if (!document.getElementById('selectionCounter')) {
        const counter = document.createElement('div');
        counter.id = 'selectionCounter';
        counter.style.cssText = 'position: fixed; bottom: 100px; right: 20px; background: var(--accent); color: white; padding: 12px 20px; border-radius: 12px; box-shadow: 0 10px 25px rgba(0,0,0,0.3); z-index: 999; display: none; font-size: 14px; font-weight: 600; max-width: 260px;';
        document.body.appendChild(counter);
    }
}

function calculateBestPrice() {
    const count = selectedPhotos.size;
    if (count === 0) return null;
    const packages = currentPublicEvent.packages || [];
    const individual = (parseFloat(currentPublicEvent.price_per_photo) || 0) * count;
    const matching = packages.find(p => p.photo_limit === count);
    if (matching) {
        const pkgPrice = parseFloat(matching.price);
        if (pkgPrice <= individual || individual === 0) {
            return { type: 'package', package: matching, amount: pkgPrice, description: `Promoción Paquete: ${matching.name} (${count} fotos)` };
        }
    }
    return { type: 'single', package: null, amount: individual, description: `${count} foto(s) seleccionada(s)` };
}

function getPackageHint(count) {
    const packages = currentPublicEvent.packages || [];
    for (const p of packages) {
        if (p.photo_limit > count) {
            const missing = p.photo_limit - count;
            return `Selecciona ${missing} foto(s) más y aplica el paquete "${p.name}" por ${formatMoney(p.price)}`;
        }
    }
    return null;
}

function updateSelectionCounter() {
    const counter = document.getElementById('selectionCounter');
    if (!counter) return;
    const count = selectedPhotos.size;
    if (count === 0) { counter.style.display = 'none'; return; }
    const best = calculateBestPrice();
    let html = `<i class="fa-solid fa-images"></i> ${count} foto(s) seleccionada(s)`;
    if (best && best.type === 'package') {
        html += `<div style="margin-top:6px; font-size:12px; background:rgba(16,185,129,0.25); padding:6px 8px; border-radius:6px;">🎉 Paquete aplicado: <strong>${best.package.name}</strong></div>`;
    } else {
        const hint = getPackageHint(count);
        if (hint) html += `<div style="margin-top:6px; font-size:11px; opacity:0.95; background:rgba(255,255,255,0.1); padding:6px 8px; border-radius:6px;">💡 ${hint}</div>`;
    }
    html += `<div style="margin-top:6px; font-size:16px; font-weight:700;">Total: ${formatMoney(best.amount)}</div>`;
    html += `<button onclick="openPurchaseModal('multiple')" style="margin-top:8px; background:var(--success); color:white; border:none; padding:8px 16px; border-radius:6px; cursor:pointer; font-size:13px; font-weight:600; width:100%;"><i class="fa-solid fa-cart-shopping"></i> Comprar Seleccionadas</button>`;
    html += `<button onclick="clearSelection()" style="margin-top:4px; background:transparent; color:white; border:1px solid white; padding:6px 12px; border-radius:6px; cursor:pointer; font-size:11px; width:100%;">Limpiar selección</button>`;
    counter.innerHTML = html;
    counter.style.display = 'block';
}

function togglePhotoSelection(photoId) {
    if (!currentPublicEvent) return;
    const card = document.getElementById(`photoCard_${photoId}`);
    if (!card) return;
    if (selectedPhotos.has(photoId)) {
        selectedPhotos.delete(photoId);
        card.classList.remove('selected');
    } else {
        selectedPhotos.add(photoId);
        card.classList.add('selected');
    }
    updateSelectionCounter();
}

function clearSelection() {
    selectedPhotos.clear();
    document.querySelectorAll('.public-photo-card').forEach(c => c.classList.remove('selected'));
    const counter = document.getElementById('selectionCounter');
    if (counter) counter.style.display = 'none';
}

function openPurchaseModal(type, id = null) {
    if (!currentPublicEvent) return;
    const modal = document.getElementById('purchaseModal');
    const title = document.getElementById('purchaseModalTitle');
    const body = document.getElementById('purchaseModalBody');
    let orderType = type, photoIds = [], amount = 0, description = '', packageId = null;

    if (type === 'gallery') {
        orderType = 'gallery'; amount = parseFloat(currentPublicEvent.price_full_gallery) || 0; description = `Galería completa: ${currentPublicEvent.title}`;
        title.innerHTML = '<i class="fa-solid fa-images"></i> Comprar Galería Completa';
    } else if (type === 'multiple') {
        photoIds = Array.from(selectedPhotos);
        if (photoIds.length === 0) { alert('Selecciona al menos una foto haciendo clic en el círculo de cada foto.'); return; }
        const best = calculateBestPrice();
        orderType = best.type === 'package' ? 'package' : 'single';
        amount = best.amount;
        description = best.description;
        packageId = best.package ? best.package.id : null;
        title.innerHTML = best.type === 'package' ? `<i class="fa-solid fa-box-open"></i> Comprar con Paquete` : `<i class="fa-solid fa-cart-shopping"></i> Comprar ${photoIds.length} foto(s)`;
        clearSelection();
    } else {
        photoIds = [id]; orderType = 'single'; amount = parseFloat(currentPublicEvent.price_per_photo) || 0; description = '1 foto';
        title.innerHTML = '<i class="fa-solid fa-cart-shopping"></i> Comprar Foto';
    }

    if (amount <= 0) { alert('Los precios no están configurados para este evento.'); return; }

    body.innerHTML = `
        <div class="purchase-summary">
            <div class="purchase-summary-row"><span>Evento:</span><strong>${currentPublicEvent.title}</strong></div>
            <div class="purchase-summary-row"><span>Tipo:</span><span>${description}</span></div>
            ${orderType === 'single' ? `<div class="purchase-summary-row"><span>Precio unitario:</span><span>${formatMoney(currentPublicEvent.price_per_photo)}</span></div>` : ''}
            <div class="purchase-summary-row total"><span>Total a pagar:</span><span style="color: var(--accent);">${formatMoney(amount)}</span></div>
        </div>
        <div class="nequi-info">
            <h4><i class="fa-solid fa-mobile-screen"></i> Datos para transferir por Nequi</h4>
            <p><strong>Número:</strong> ${currentPublicEvent.nequi_phone || 'No configurado'}</p>
            <p><strong>Titular:</strong> ${currentPublicEvent.nequi_name || 'No configurado'}</p>
            <p style="font-size: 12px; color: var(--text-muted); margin-top: 8px;"><i class="fa-solid fa-circle-info"></i> Transfiere exactamente <strong>${formatMoney(amount)}</strong> y sube el comprobante abajo.</p>
        </div>
        <form id="purchaseForm">
            <div class="form-group"><label>Nombre Completo *</label><input type="text" id="customerName" required placeholder="Tu nombre"></div>
            <div class="form-group"><label>Correo Electrónico * (aquí recibirás las fotos)</label><input type="email" id="customerEmail" required placeholder="tu@email.com"></div>
            <div class="form-group"><label>Comprobante de Pago * (captura de pantalla)</label><label for="receiptFile" class="receipt-upload" id="receiptUploadLabel"><i class="fa-solid fa-cloud-arrow-up"></i><p>Haz clic o arrastra tu comprobante aquí</p><p style="font-size: 11px; margin-top: 4px;">JPG, PNG (máx. 5MB)</p><input type="file" id="receiptFile" accept="image/*" required style="display: none;" onchange="previewReceipt(event)"></label><img id="receiptPreview" class="receipt-preview hidden"></div>
            <button type="submit" class="btn-primary" id="submitPurchaseBtn"><i class="fa-solid fa-paper-plane"></i> Enviar Pedido</button>
            <div id="purchaseResult"></div>
        </form>
        <p style="font-size: 11px; color: var(--text-muted); text-align: center; margin-top: 16px;"><i class="fa-solid fa-shield-halved"></i> El fotógrafo revisará tu comprobante y te enviará las fotos por email en las próximas horas.</p>
    `;
    body.dataset.orderType = orderType;
    body.dataset.photoIds = JSON.stringify(photoIds);
    body.dataset.packageId = packageId || '';
    body.dataset.amount = amount;
    document.getElementById('purchaseForm').addEventListener('submit', submitPurchase);
    modal.classList.remove('hidden');
}

function previewReceipt(event) {
    const file = event.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = (e) => {
            const preview = document.getElementById('receiptPreview');
            preview.src = e.target.result; preview.classList.remove('hidden');
            document.getElementById('receiptUploadLabel').querySelector('p').textContent = file.name;
        };
        reader.readAsDataURL(file);
    }
}

async function submitPurchase(e) {
    e.preventDefault();
    const body = document.getElementById('purchaseModalBody');
    const orderType = body.dataset.orderType;
    const photoIds = JSON.parse(body.dataset.photoIds);
    const packageId = body.dataset.packageId;
    const amount = body.dataset.amount;
    const customerName = document.getElementById('customerName').value;
    const customerEmail = document.getElementById('customerEmail').value;
    const receiptFile = document.getElementById('receiptFile').files[0];
    const resultDiv = document.getElementById('purchaseResult');
    const submitBtn = document.getElementById('submitPurchaseBtn');
    if (!receiptFile) { resultDiv.className = 'alert alert-error'; resultDiv.textContent = 'Debes subir el comprobante de pago.'; return; }
    submitBtn.disabled = true; submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Enviando...';
    const formData = new FormData();
    formData.append('event_id', currentPublicEvent.id);
    formData.append('customer_email', customerEmail);
    formData.append('customer_name', customerName);
    formData.append('order_type', orderType);
    formData.append('photo_ids', JSON.stringify(photoIds));
    formData.append('package_id', packageId);
    formData.append('receipt', receiptFile);
    try {
        const res = await fetch('/api/orders/create', { method: 'POST', body: formData });
        const data = await res.json();
        if (res.ok) {
            resultDiv.className = 'alert alert-success';
            resultDiv.innerHTML = `<i class="fa-solid fa-circle-check"></i> <strong>¡Pedido enviado con éxito!</strong><br><span style="font-size: 12px;">El fotógrafo revisará tu comprobante y te enviará las fotos a <strong>${customerEmail}</strong> en las próximas horas.</span>`;
            setTimeout(() => { closePurchaseModal(); resultDiv.className = ''; resultDiv.innerHTML = ''; }, 4000);
        } else { resultDiv.className = 'alert alert-error'; resultDiv.textContent = data.error || 'Error al enviar el pedido.'; }
    } catch (err) { resultDiv.className = 'alert alert-error'; resultDiv.textContent = 'Error de conexión.'; }
    finally { submitBtn.disabled = false; submitBtn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Enviar Pedido'; }
}