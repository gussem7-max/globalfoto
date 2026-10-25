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
}

function logout() { localStorage.removeItem('token'); window.location.href = '/'; }

window.addEventListener('DOMContentLoaded', async () => {
    const token = getToken();
    const urlParams = new URLSearchParams(window.location.search);
    const galeriaId = urlParams.get('galeria');

    if (galeriaId) { await loadPublicGallery(galeriaId); hideLoadingOverlay(); return; }

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