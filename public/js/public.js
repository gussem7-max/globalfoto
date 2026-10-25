// =====================================================
// GALERÍA PÚBLICA: VISUALIZACIÓN, SELECCIÓN Y COMPRA
// =====================================================

let pubCurrentEvent = null;
let pubCurrentPhotos = [];
let pubSelectedPhotos = new Set();
let pubPurchaseType = null;
let pubCurrentReceiptFile = null;

async function loadPublicGallery(eventId) {
    try {
        const res = await fetch(`/api/events/${eventId}/public`);
        if (!res.ok) throw new Error('Evento no encontrado');
        const data = await res.json();
        pubCurrentEvent = data.event;
        pubCurrentPhotos = data.photos || [];

        document.getElementById('pubEventTitle').textContent = pubCurrentEvent.title;
        const details = [];
        if (pubCurrentEvent.event_date) details.push(new Date(pubCurrentEvent.event_date).toLocaleDateString('es-CO'));
        if (pubCurrentEvent.location) details.push(pubCurrentEvent.location);
        if (pubCurrentEvent.description) details.push(pubCurrentEvent.description);
        document.getElementById('pubEventDetails').textContent = details.join(' • ');

        if (pubCurrentEvent.status !== 'published') {
            document.getElementById('pubPhotoGrid').innerHTML = `
                <div class="gallery-closed" style="grid-column: 1/-1;">
                    <i class="fa-solid fa-lock"></i>
                    <h3 style="color: white; margin-bottom: 8px;">Galería no disponible</h3>
                    <p style="color: var(--text-muted);">Esta galería está ${pubCurrentEvent.status === 'draft' ? 'en borrador' : 'archivada'}.</p>
                </div>`;
            return;
        }

        if (pubCurrentEvent.expires_at && new Date(pubCurrentEvent.expires_at) < new Date()) {
            document.getElementById('pubPhotoGrid').innerHTML = `
                <div class="gallery-closed" style="grid-column: 1/-1;">
                    <i class="fa-solid fa-clock"></i>
                    <h3 style="color: white; margin-bottom: 8px;">Galería expirada</h3>
                    <p style="color: var(--text-muted);">Esta galería expiró el ${new Date(pubCurrentEvent.expires_at).toLocaleString('es-CO')}.</p>
                </div>`;
            return;
        }

        if (pubCurrentEvent.selfie_required) {
            document.getElementById('selfieGate').classList.remove('hidden');
            document.getElementById('pubPhotoGrid').innerHTML = '';
            document.getElementById('pubPackagesGrid').innerHTML = '';
            document.getElementById('pubPricingBar').classList.add('hidden');
            return;
        }

        renderGallery(pubCurrentPhotos);
        renderPackages();
        renderPricingBar();
    } catch (err) {
        console.error('Error al cargar galería:', err);
        document.getElementById('pubPhotoGrid').innerHTML = `
            <div class="gallery-closed" style="grid-column: 1/-1;">
                <i class="fa-solid fa-circle-exclamation"></i>
                <h3 style="color: white; margin-bottom: 8px;">Error al cargar</h3>
                <p style="color: var(--text-muted);">No se pudo cargar la galería. Verifica el enlace.</p>
            </div>`;
    }
}

function renderGallery(photos) {
    const grid = document.getElementById('pubPhotoGrid');
    if (photos.length === 0) {
        grid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 40px; color: var(--text-muted);"><i class="fa-solid fa-images" style="font-size: 48px; opacity: 0.3; margin-bottom: 16px; display: block;"></i>Aún no hay fotos en esta galería.</div>';
        return;
    }
    grid.innerHTML = photos.map(p => {
        const isSelected = pubSelectedPhotos.has(p.id);
        return `<div class="public-photo-card ${isSelected ? 'selected' : ''}" id="photoCard_${p.id}">
            <div class="public-photo-wrapper" onclick="openLightbox('${p.preview_url || p.url}')">
                <img src="${p.preview_url || p.url}" class="public-photo-img" alt="Foto">
                <div class="photo-watermark">GlobalFoto</div>
                <div class="photo-select-check" onclick="event.stopPropagation(); togglePhotoSelection(${p.id})">
                    <i class="fa-solid ${isSelected ? 'fa-check' : 'fa-plus'}"></i>
                </div>
            </div>
            <div class="public-photo-footer">
                <span class="photo-price-tag">${pubCurrentEvent.price_per_photo ? formatMoney(pubCurrentEvent.price_per_photo) : 'Consultar'}</span>
                <button class="btn-buy-photo" onclick="openPurchaseModal('photo', ${p.id})">
                    <i class="fa-solid fa-cart-shopping"></i> Comprar
                </button>
            </div>
        </div>`;
    }).join('');
}

function renderPackages() {
    const grid = document.getElementById('pubPackagesGrid');
    if (!pubCurrentEvent.packages || pubCurrentEvent.packages.length === 0) { grid.innerHTML = ''; return; }
    grid.innerHTML = pubCurrentEvent.packages.map(p => `
        <div class="package-card ${p.featured ? 'featured' : ''}">
            <h3>${p.name}</h3>
            <div class="price">${formatMoney(p.price)}</div>
            <div class="limit">${p.photo_limit} fotos</div>
            <div class="howto">Selecciona ${p.photo_limit} fotos y paga el paquete completo.</div>
            <button class="btn-buy-photo" style="margin-top: 12px; width: 100%; justify-content: center; padding: 10px;" onclick="openPurchaseModal('package', null, ${p.id})">
                <i class="fa-solid fa-cart-shopping"></i> Elegir paquete
            </button>
        </div>
    `).join('');
}

function renderPricingBar() {
    const bar = document.getElementById('pubPricingBar');
    if (!pubCurrentEvent.price_per_photo && !pubCurrentEvent.price_full_gallery) { bar.classList.add('hidden'); return; }
    bar.classList.remove('hidden');
    document.getElementById('pubPricePhoto').textContent = pubCurrentEvent.price_per_photo ? formatMoney(pubCurrentEvent.price_per_photo) : '—';
    document.getElementById('pubPriceGallery').textContent = pubCurrentEvent.price_full_gallery ? formatMoney(pubCurrentEvent.price_full_gallery) : '—';
}

function togglePhotoSelection(photoId) {
    if (pubSelectedPhotos.has(photoId)) pubSelectedPhotos.delete(photoId);
    else pubSelectedPhotos.add(photoId);
    const card = document.getElementById(`photoCard_${photoId}`);
    if (card) {
        const check = card.querySelector('.photo-select-check i');
        card.classList.toggle('selected');
        check.className = `fa-solid ${pubSelectedPhotos.has(photoId) ? 'fa-check' : 'fa-plus'}`;
    }
}

function clearSelection() {
    pubSelectedPhotos.clear();
    document.querySelectorAll('.public-photo-card.selected').forEach(c => {
        c.classList.remove('selected');
        const check = c.querySelector('.photo-select-check i');
        if (check) check.className = 'fa-solid fa-plus';
    });
}

function revealGallery(photos) {
    pubCurrentPhotos = photos;
    document.getElementById('selfieGate').classList.add('hidden');
    renderGallery(photos);
    renderPackages();
    renderPricingBar();
}

async function openPurchaseModal(type, photoId = null, packageId = null) {
    pubPurchaseType = type;
    const modal = document.getElementById('purchaseModal');
    const body = document.getElementById('purchaseModalBody');
    const title = document.getElementById('purchaseModalTitle');

    let summaryHtml = '';
    let total = 0;

    if (type === 'photo' && photoId) {
        const photo = pubCurrentPhotos.find(p => p.id === photoId);
        if (!photo) return;
        title.textContent = 'Comprar Foto';
        total = pubCurrentEvent.price_per_photo || 0;
        summaryHtml = `
            <div class="purchase-summary">
                <div class="purchase-summary-row"><span>Foto individual</span><span>${formatMoney(total)}</span></div>
                <div class="purchase-summary-row total"><span>Total</span><span>${formatMoney(total)}</span></div>
            </div>`;
    } else if (type === 'gallery') {
        title.textContent = 'Comprar Galería Completa';
        total = pubCurrentEvent.price_full_gallery || 0;
        summaryHtml = `
            <div class="purchase-summary">
                <div class="purchase-summary-row"><span>Galería completa (${pubCurrentPhotos.length} fotos)</span><span>${formatMoney(total)}</span></div>
                <div class="purchase-summary-row total"><span>Total</span><span>${formatMoney(total)}</span></div>
            </div>`;
    } else if (type === 'package' && packageId) {
        const pkg = pubCurrentEvent.packages.find(p => p.id === packageId);
        if (!pkg) return;
        title.textContent = `Paquete: ${pkg.name}`;
        total = pkg.price;
        summaryHtml = `
            <div class="purchase-summary">
                <div class="purchase-summary-row"><span>${pkg.name} (${pkg.photo_limit} fotos)</span><span>${formatMoney(total)}</span></div>
                <div class="purchase-summary-row total"><span>Total</span><span>${formatMoney(total)}</span></div>
            </div>`;
    }

    body.innerHTML = `
        ${summaryHtml}
        <div class="nequi-info">
            <h4><i class="fa-solid fa-mobile-screen"></i> Datos para pagar por Nequi</h4>
            <p><strong>Número:</strong> ${pubCurrentEvent.nequi_phone || 'No configurado'}</p>
            <p><strong>Titular:</strong> ${pubCurrentEvent.nequi_name || '—'}</p>
            <p style="font-size: 12px; color: var(--text-muted); margin-top: 8px;">Haz la transferencia y sube el comprobante abajo.</p>
        </div>
        <div class="form-group">
            <label>Tu nombre</label>
            <input type="text" id="purchaseName" placeholder="Tu nombre completo" required>
        </div>
        <div class="form-group">
            <label>Tu correo electrónico</label>
            <input type="email" id="purchaseEmail" placeholder="tu@email.com" required>
        </div>
        <div class="form-group">
            <label>Comprobante de pago</label>
            <div class="receipt-upload" onclick="document.getElementById('receiptInput').click()">
                <i class="fa-solid fa-cloud-arrow-up"></i>
                <p>Haz clic para subir el comprobante</p>
                <input type="file" id="receiptInput" accept="image/*" style="display: none;" onchange="onReceiptChosen(event)">
                <img id="receiptPreview" class="receipt-preview hidden">
            </div>
        </div>
        <button class="btn-primary" onclick="submitPurchase(${photoId || 'null'}, ${packageId || 'null'})" id="purchaseSubmitBtn">
            <i class="fa-solid fa-paper-plane"></i> Enviar pedido
        </button>
        <div id="purchaseResult"></div>
    `;
    modal.classList.remove('hidden');
}

function closePurchaseModal() {
    document.getElementById('purchaseModal').classList.add('hidden');
    clearSelection();
    pubCurrentReceiptFile = null;
}

function onReceiptChosen(e) {
    const file = e.target.files[0];
    if (!file) return;
    pubCurrentReceiptFile = file;
    const preview = document.getElementById('receiptPreview');
    preview.src = URL.createObjectURL(file);
    preview.classList.remove('hidden');
}

async function submitPurchase(photoId, packageId) {
    const name = document.getElementById('purchaseName').value.trim();
    const email = document.getElementById('purchaseEmail').value.trim();
    const resultDiv = document.getElementById('purchaseResult');
    const btn = document.getElementById('purchaseSubmitBtn');

    if (!name || !email) {
        resultDiv.className = 'alert alert-error';
        resultDiv.textContent = 'Completa tu nombre y correo.';
        return;
    }
    if (!pubCurrentReceiptFile) {
        resultDiv.className = 'alert alert-error';
        resultDiv.textContent = 'Sube el comprobante de pago.';
        return;
    }

    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Enviando...';

    const formData = new FormData();
    formData.append('event_id', pubCurrentEvent.id);
    formData.append('customer_name', name);
    formData.append('customer_email', email);
    formData.append('order_type', pubPurchaseType);
    formData.append('amount', pubCurrentEvent[pubPurchaseType === 'gallery' ? 'price_full_gallery' : 'price_per_photo'] || 0);
    if (photoId) formData.append('photo_ids', JSON.stringify([photoId]));
    if (packageId) formData.append('package_id', packageId);
    formData.append('receipt', pubCurrentReceiptFile);

    try {
        const res = await fetch('/api/orders', { method: 'POST', headers: authHeaders(), body: formData });
        const data = await res.json();
        if (res.ok) {
            resultDiv.className = 'alert alert-success';
            resultDiv.innerHTML = '<i class="fa-solid fa-circle-check"></i> ¡Pedido enviado! Recibirás un email cuando el fotógrafo apruebe el pago.';
            clearSelection();
            setTimeout(() => closePurchaseModal(), 3000);
        } else {
            resultDiv.className = 'alert alert-error';
            resultDiv.textContent = data.error || 'Error al enviar el pedido.';
        }
    } catch (err) {
        resultDiv.className = 'alert alert-error';
        resultDiv.textContent = 'Error de conexión.';
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Enviar pedido';
    }
}