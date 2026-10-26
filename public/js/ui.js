// =====================================================
// UI: NAVEGACIÓN, ARRANQUE Y UTILIDADES
// =====================================================

function hideLoadingOverlay() {
    const overlay = document.getElementById('loadingOverlay');
    if (overlay) { overlay.classList.add('hidden'); setTimeout(() => overlay.remove(), 300); }
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

    if (section === 'events' && typeof loadEvents === 'function') loadEvents();
    else if (section === 'galleries' && typeof renderGalleriesView === 'function') renderGalleriesView();
    else if (section === 'sales' && typeof loadOrders === 'function') loadOrders();
    else if (section === 'admin') {
        if (typeof currentUser !== 'undefined' && currentUser && currentUser.role === 'admin' && typeof loadAdmin === 'function') loadAdmin();
        else { alert('No tienes permisos.'); showSection('events'); }
    }
    else if (section === 'users') {
        if (typeof currentUser !== 'undefined' && currentUser && currentUser.role === 'admin' && typeof loadUsers === 'function') loadUsers();
        else { alert('No tienes permisos.'); showSection('events'); }
    }
    else if (section === 'settings') {
        if (typeof currentUser !== 'undefined' && currentUser) {
            const n = document.getElementById('cfgName');
            const e = document.getElementById('cfgEmail');
            if (n) n.value = currentUser.name || '';
            if (e) e.value = currentUser.email || '';
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

function closeOrderModal() { const m = document.getElementById('orderModal'); if (m) m.classList.add('hidden'); }
function closePackageModal() { const m = document.getElementById('packageModal'); if (m) m.classList.add('hidden'); }
function closeManageModal() { const m = document.getElementById('manageEventModal'); if (m) m.classList.add('hidden'); if (typeof managingEventId !== 'undefined') managingEventId = null; }
function closeEditUserModal() { const m = document.getElementById('editUserModal'); if (m) m.classList.add('hidden'); const r = document.getElementById('editUserResult'); if (r) r.textContent = ''; }
function closePurchaseModal() { const m = document.getElementById('purchaseModal'); if (m) m.classList.add('hidden'); if (typeof clearSelection === 'function') clearSelection(); }

function openLightbox(url) {
    let safeUrl = url;
    if (url && url.includes('/original/')) safeUrl = url.replace('/original/', '/preview/').replace(/\.\w+$/, '.jpg');
    const img = document.getElementById('lightboxImg');
    if (img) img.src = safeUrl;
    const modal = document.getElementById('lightboxModal');
    if (modal) modal.classList.remove('hidden');
}
function closeLightbox() { const modal = document.getElementById('lightboxModal'); if (modal) modal.classList.add('hidden'); }

function showDashboard() {
    const auth = document.getElementById('authContainer');
    const dash = document.getElementById('dashboardContainer');
    if (auth) auth.classList.add('hidden');
    if (dash) dash.classList.remove('hidden');
    
    if (typeof currentUser !== 'undefined' && currentUser) {
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

        // Sincronizar drawer de perfil
        const drawerAvatar = document.getElementById('drawerAvatar');
        const drawerUserName = document.getElementById('drawerUserName');
        const drawerUserRole = document.getElementById('drawerUserRole');
        if (drawerAvatar) drawerAvatar.textContent = currentUser.name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
        if (drawerUserName) drawerUserName.textContent = currentUser.name;
        if (drawerUserRole) drawerUserRole.textContent = currentUser.role === 'admin' ? 'Administrador' : 'Fotógrafo';

        const drawerAdmin = document.getElementById('drawerAdmin');
        const drawerUsers = document.getElementById('drawerUsers');
        if (currentUser.role === 'admin') {
            if (drawerAdmin) drawerAdmin.classList.remove('hidden');
            if (drawerUsers) drawerUsers.classList.remove('hidden');
        } else {
            if (drawerAdmin) drawerAdmin.classList.add('hidden');
            if (drawerUsers) drawerUsers.classList.add('hidden');
        }
    }
    
    if (typeof loadEvents === 'function') loadEvents();
    if (typeof loadPendingOrdersCount === 'function') loadPendingOrdersCount();
    if (typeof loadUserLogo === 'function') loadUserLogo();
}

function logout() { localStorage.removeItem('token'); window.location.href = '/'; }

// ===== FUNCIONES GLOBALES PARA LA BARRA MÓVIL Y DRAWER =====
window.switchMobileTab = function(selectedBtn) {
    const allPills = document.querySelectorAll('.nav-pill');
    allPills.forEach(pill => {
        pill.classList.remove('active', 'bg-purple-600', 'text-white', 'shadow-md', 'shadow-purple-500/30', 'px-4');
        pill.classList.add('text-slate-400', 'px-3.5');
        const label = pill.querySelector('.tab-label');
        if (label) label.classList.add('hidden');
    });
    selectedBtn.classList.add('active', 'bg-purple-600', 'text-white', 'shadow-md', 'shadow-purple-500/30', 'px-4');
    selectedBtn.classList.remove('text-slate-400', 'px-3.5');
    const activeLabel = selectedBtn.querySelector('.tab-label');
    if (activeLabel) activeLabel.classList.remove('hidden');
};

window.openProfileDrawer = function() {
    const drawer = document.getElementById('profileDrawer');
    const overlay = document.getElementById('profileDrawerOverlay');
    if (drawer) drawer.classList.add('open');
    if (overlay) overlay.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
};

window.closeProfileDrawer = function() {
    const drawer = document.getElementById('profileDrawer');
    const overlay = document.getElementById('profileDrawerOverlay');
    if (drawer) drawer.classList.remove('open');
    if (overlay) overlay.classList.add('hidden');
    document.body.style.overflow = '';
};

// ===== ARRANQUE DE LA APLICACIÓN =====
window.addEventListener('DOMContentLoaded', async () => {
    const token = typeof getToken === 'function' ? getToken() : localStorage.getItem('token');
    const pathname = window.location.pathname;
    const urlParams = new URLSearchParams(window.location.search);

    let galeriaId = null;
    const galleryMatch = pathname.match(/^\/g\/(\d+)/);
    if (galleryMatch) galeriaId = galleryMatch[1];
    else if (urlParams.get('galeria')) galeriaId = urlParams.get('galeria');

    if (galeriaId) { 
        console.log('Cargando galería pública:', galeriaId);
        if (typeof loadPublicGallery === 'function') {
            try {
                await loadPublicGallery(galeriaId);
            } catch (err) {
                console.error('Error galería:', err);
                const grid = document.getElementById('pubPhotoGrid');
                if (grid) {
                    grid.innerHTML = `<div class="gallery-closed" style="grid-column: 1/-1;"><i class="fa-solid fa-circle-exclamation"></i><h3 style="color: white; margin-bottom: 8px;">Error al cargar</h3><p style="color: var(--text-muted);">${err.message}</p></div>`;
                }
            }
        }
        hideLoadingOverlay();
        return; 
    }

    if (urlParams.get('tab') === 'register') switchTab('register');
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
        const response = await fetch('/api/auth/me', { method: 'GET', headers: typeof authHeaders === 'function' ? authHeaders() : { 'Authorization': `Bearer ${token}` } });
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
        console.error('Error sesión:', error);
        localStorage.removeItem('token');
        const auth = document.getElementById('authContainer');
        const dash = document.getElementById('dashboardContainer');
        if (auth) auth.classList.remove('hidden');
        if (dash) dash.classList.add('hidden');
    } finally {
        hideLoadingOverlay();
    }
});