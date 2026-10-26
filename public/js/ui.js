// =====================================================
// UTILIDADES DE UI, NAVEGACIÓN Y ARRANQUE
// =====================================================

function hideLoadingOverlay() {
    const overlay = document.getElementById('loadingOverlay');
    if (overlay) { overlay.classList.add('hidden'); setTimeout(() => overlay.remove(), 300); }
}

function showSection(section) {
    ['events', 'galleries', 'sales', 'users', 'settings', 'admin'].forEach(s => {
        document.getElementById(`section${s.charAt(0).toUpperCase() + s.slice(1)}`).classList.add('hidden');
        document.getElementById(`nav${s.charAt(0).toUpperCase() + s.slice(1)}`).classList.remove('active');
    });
    document.getElementById(`section${section.charAt(0).toUpperCase() + section.slice(1)}`).classList.remove('hidden');
    document.getElementById(`nav${section.charAt(0).toUpperCase() + section.slice(1)}`).classList.add('active');

    if (section === 'events') loadEvents();
    else if (section === 'galleries') renderGalleriesView();
    else if (section === 'sales') loadOrders();
    else if (section === 'admin') {
        if (currentUser && currentUser.role === 'admin') loadAdmin();
        else { alert('No tienes permisos.'); showSection('events'); }
    }
    else if (section === 'users') {
        if (currentUser && currentUser.role === 'admin') loadUsers();
        else { alert('No tienes permisos.'); showSection('events'); }
    }
    else if (section === 'settings') {
        if (currentUser) {
            document.getElementById('cfgName').value = currentUser.name || '';
            document.getElementById('cfgEmail').value = currentUser.email || '';
        }
    }
}

function switchTab(tab) {
    document.getElementById('registerSection').classList.toggle('hidden', tab !== 'register');
    document.getElementById('loginSection').classList.toggle('hidden', tab !== 'login');
    document.querySelectorAll('.tab').forEach((t, i) => t.classList.toggle('active', (tab === 'login' && i === 0) || (tab === 'register' && i === 1)));
}

function closeOrderModal() { document.getElementById('orderModal').classList.add('hidden'); }
function closePackageModal() { document.getElementById('packageModal').classList.add('hidden'); }
function closeEditUserModal() { document.getElementById('editUserModal').classList.add('hidden'); document.getElementById('editUserResult').textContent = ''; }

function closePurchaseModal() {
    document.getElementById('purchaseModal').classList.add('hidden');
    clearSelection();
}

function openLightbox(url) {
    let safeUrl = url;
    if (url && url.includes('/original/')) safeUrl = url.replace('/original/', '/preview/').replace(/\.\w+$/, '.jpg');
    document.getElementById('lightboxImg').src = safeUrl;
    document.getElementById('lightboxModal').classList.remove('hidden');
}
function closeLightbox() { document.getElementById('lightboxModal').classList.add('hidden'); }

function showDashboard() {
    document.getElementById('authContainer').classList.add('hidden');
    document.getElementById('dashboardContainer').classList.remove('hidden');
    document.getElementById('userName').textContent = currentUser.name;
    document.getElementById('userAvatar').textContent = currentUser.name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
    document.getElementById('userRole').textContent = currentUser.role === 'admin' ? 'Administrador' : 'Fotógrafo';
    document.getElementById('welcomeTitle').textContent = `¡Hola de nuevo, ${currentUser.name}!`;
    if (currentUser.role === 'admin') {
        document.getElementById('navUsers').classList.remove('hidden');
        document.getElementById('navAdmin').classList.remove('hidden');
    } else {
        document.getElementById('navUsers').classList.add('hidden');
        document.getElementById('navAdmin').classList.add('hidden');
    }
    loadEvents();
    loadPendingOrdersCount();
    loadUserLogo();
    
    // Mostrar plan seleccionado si viene de la landing
    const selectedPlan = localStorage.getItem('selected_plan');
    if (selectedPlan) {
        showPlanNotification(selectedPlan);
        localStorage.removeItem('selected_plan');
    }
}

function showPlanNotification(planName) {
    const planNames = {
        'free': 'Prueba Gratis (14 días)',
        'basic': 'Básico',
        'pro': 'Pro (Más popular)',
        'studio': 'Estudio'
    };
    const notification = document.createElement('div');
    notification.style.cssText = 'position: fixed; top: 24px; right: 24px; background: linear-gradient(135deg, #6366f1, #a855f7); color: white; padding: 16px 24px; border-radius: 12px; box-shadow: 0 10px 30px rgba(168, 85, 247, 0.4); z-index: 9999; max-width: 320px; animation: slideIn 0.4s ease-out;';
    notification.innerHTML = `
        <div style="display: flex; align-items: center; gap: 12px;">
            <i class="fa-solid fa-gift" style="font-size: 24px;"></i>
            <div>
                <div style="font-size: 12px; opacity: 0.9;">Plan seleccionado</div>
                <div style="font-size: 15px; font-weight: 700;">${planNames[planName] || planName}</div>
                <div style="font-size: 11px; opacity: 0.9; margin-top: 2px;">14 días gratis de prueba</div>
            </div>
        </div>
    `;
    document.body.appendChild(notification);
    setTimeout(() => {
        notification.style.animation = 'slideIn 0.4s ease-out reverse';
        setTimeout(() => notification.remove(), 400);
    }, 5000);
}

function logout() { 
    localStorage.removeItem('token'); 
    window.location.href = '/'; 
}

// Estilos para la animación de notificación
const style = document.createElement('style');
style.textContent = `
    @keyframes slideIn {
        from { transform: translateX(120%); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
    }
`;
document.head.appendChild(style);

window.addEventListener('DOMContentLoaded', async () => {
    const token = getToken();
    const pathname = window.location.pathname;
    const urlParams = new URLSearchParams(window.location.search);

    // Detectar galería pública: /g/ID o ?galeria=ID (compatibilidad)
    let galeriaId = null;
    const galleryMatch = pathname.match(/^\/g\/(\d+)/);
    if (galleryMatch) galeriaId = galleryMatch[1];
    else if (urlParams.get('galeria')) galeriaId = urlParams.get('galeria');

    if (galeriaId) { 
        await loadPublicGallery(galeriaId); 
        hideLoadingOverlay(); 
        return; 
    }

    // Detectar tab de registro desde landing: /panel?tab=register&plan=pro
    const requestedTab = urlParams.get('tab');
    if (requestedTab === 'register') {
        switchTab('register');
    }
    
    // Guardar plan seleccionado para mostrarlo después del login/registro
    const plan = urlParams.get('plan');
    if (plan) {
        localStorage.setItem('selected_plan', plan);
    }

    if (!token) {
        document.getElementById('authContainer').classList.remove('hidden');
        document.getElementById('dashboardContainer').classList.add('hidden');
        hideLoadingOverlay();
        return;
    }

    try {
        const response = await fetch('/api/auth/me', { method: 'GET', headers: authHeaders() });
        if (response.ok) {
            const data = await response.json();
            currentUser = data.user;
            document.getElementById('authContainer').classList.add('hidden');
            document.getElementById('dashboardContainer').classList.remove('hidden');
            showDashboard();
        } else {
            localStorage.removeItem('token');
            document.getElementById('authContainer').classList.remove('hidden');
            document.getElementById('dashboardContainer').classList.add('hidden');
        }
    } catch (error) {
        console.error('Error al verificar la sesión:', error);
        localStorage.removeItem('token');
        document.getElementById('authContainer').classList.remove('hidden');
        document.getElementById('dashboardContainer').classList.add('hidden');
    } finally {
        hideLoadingOverlay();
    }
});