// =====================================================
// UTILIDADES DE UI, NAVEGACIÓN Y ARRANQUE
// =====================================================

function hideLoadingOverlay() {
    const overlay = document.getElementById('loadingOverlay');
    if (overlay) { 
        overlay.classList.add('hidden'); 
        setTimeout(() => overlay.remove(), 300); 
    }
}

function showSection(section) {
    ['events', 'galleries', 'sales', 'users', 'settings', 'admin'].forEach(s => {
        const sec = document.getElementById(`section${s.charAt(0).toUpperCase() + s.slice(1)}`);
        const nav = document.getElementById(`nav${s.charAt(0).toUpperCase() + s.slice(1)}`);
        if (sec) sec.classList.add('hidden');
        if (nav) nav.classList.remove('active');
    });
    const targetSec = document.getElementById(`section${section.charAt(0).toUpperCase() + section.slice(1)}`);
    const targetNav = document.getElementById(`nav${section.charAt(0).toUpperCase() + section.slice(1)}`);
    if (targetSec) targetSec.classList.remove('hidden');
    if (targetNav) targetNav.classList.add('active');

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
    const reg = document.getElementById('registerSection');
    const log = document.getElementById('loginSection');
    if (reg) reg.classList.toggle('hidden', tab !== 'register');
    if (log) log.classList.toggle('hidden', tab !== 'login');
    document.querySelectorAll('.tab').forEach((t, i) => {
        t.classList.toggle('active', (tab === 'login' && i === 0) || (tab === 'register' && i === 1));
    });
}

function closeOrderModal() { document.getElementById('orderModal').classList.add('hidden'); }
function closePackageModal() { document.getElementById('packageModal').classList.add('hidden'); }
function closeManageModal() { 
    document.getElementById('manageEventModal').classList.add('hidden'); 
    managingEventId = null; 
}
function closeEditUserModal() { 
    document.getElementById('editUserModal').classList.add('hidden'); 
    const r = document.getElementById('editUserResult');
    if (r) r.textContent = ''; 
}

function closePurchaseModal() {
    document.getElementById('purchaseModal').classList.add('hidden');
    clearSelection();
}

function openLightbox(url) {
    let safeUrl = url;
    if (url && url.includes('/original/')) safeUrl = url.replace('/original/', '/preview/').replace(/\.\w+$/, '.jpg');
    const img = document.getElementById('lightboxImg');
    if (img) img.src = safeUrl;
    const modal = document.getElementById('lightboxModal');
    if (modal) modal.classList.remove('hidden');
}
function closeLightbox() { 
    const modal = document.getElementById('lightboxModal');
    if (modal) modal.classList.add('hidden'); 
}

function showDashboard() {
    const auth = document.getElementById('authContainer');
    const dash = document.getElementById('dashboardContainer');
    if (auth) auth.classList.add('hidden');
    if (dash) dash.classList.remove('hidden');
    
    const nameEl = document.getElementById('userName');
    const avatarEl = document.getElementById('userAvatar');
    const roleEl = document.getElementById('userRole');
    const welcomeEl = document.getElementById('welcomeTitle');
    
    if (nameEl) nameEl.textContent = currentUser.name;
    if (avatarEl) avatarEl.textContent = currentUser.name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
    if (roleEl) roleEl.textContent = currentUser.role === 'admin' ? 'Administrador' : 'Fotógrafo';
    if (welcomeEl) welcomeEl.textContent = `¡Hola de nuevo, ${currentUser.name}!`;
    
    const navUsers = document.getElementById('navUsers');
    const navAdmin = document.getElementById('navAdmin');
    if (currentUser.role === 'admin') {
        if (navUsers) navUsers.classList.remove('hidden');
        if (navAdmin) navAdmin.classList.remove('hidden');
    } else {
        if (navUsers) navUsers.classList.add('hidden');
        if (navAdmin) navAdmin.classList.add('hidden');
    }
    loadEvents();
    loadPendingOrdersCount();
    loadUserLogo();
    
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

    // Detectar galería pública: /g/ID o ?galeria=ID
    let galeriaId = null;
    const galleryMatch = pathname.match(/^\/g\/(\d+)/);
    if (galleryMatch) galeriaId = galleryMatch[1];
    else if (urlParams.get('galeria')) galeriaId = urlParams.get('galeria');

    if (galeriaId) { 
        console.log('Cargando galería pública:', galeriaId);
        try {
            await loadPublicGallery(galeriaId);
        } catch (err) {
            console.error('Error cargando galería:', err);
            const grid = document.getElementById('pubPhotoGrid');
            if (grid) {
                grid.innerHTML = `
                    <div class="gallery-closed" style="grid-column: 1/-1;">
                        <i class="fa-solid fa-circle-exclamation"></i>
                        <h3 style="color: white; margin-bottom: 8px;">Error al cargar</h3>
                        <p style="color: var(--text-muted);">${err.message || 'Error desconocido'}</p>
                    </div>`;
            }
        } finally {
            hideLoadingOverlay();
        }
        return; 
    }

    // Detectar tab de registro
    const requestedTab = urlParams.get('tab');
    if (requestedTab === 'register') switchTab('register');
    
    const plan = urlParams.get('plan');
    if (plan) localStorage.setItem('selected_plan', plan);

    if (!token) {
        const auth = document.getElementById('authContainer');
        const dash = document.getElementById('dashboardContainer');
        if (auth) auth.classList.remove('hidden');
        if (dash) dash.classList.add('hidden');
        hideLoadingOverlay();
        return;
    }

    try {
        const response = await fetch('/api/auth/me', { method: 'GET', headers: authHeaders() });
        if (response.ok) {
            const data = await response.json();
            currentUser = data.user;
            showDashboard();
        } else {
            localStorage.removeItem('token');
            const auth = document.getElementById('authContainer');
            const dash = document.getElementById('dashboardContainer');
            if (auth) auth.classList.remove('hidden');
            if (dash) dash.classList.add('hidden');
        }
    } catch (error) {
        console.error('Error al verificar la sesión:', error);
        localStorage.removeItem('token');
        const auth = document.getElementById('authContainer');
        const dash = document.getElementById('dashboardContainer');
        if (auth) auth.classList.remove('hidden');
        if (dash) dash.classList.add('hidden');
    } finally {
        hideLoadingOverlay();
    }
});