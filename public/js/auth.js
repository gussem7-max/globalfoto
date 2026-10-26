// =====================================================
// AUTENTICACIÓN: LOGIN, REGISTRO, PERFIL, CONTRASEÑA, LOGO
// =====================================================

document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('loginEmail').value;
    const password = document.getElementById('loginPassword').value;
    const resDiv = document.getElementById('resultadoLogin');
    try {
        const res = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
        const data = await res.json();
        if (res.ok) { currentUser = data.user; localStorage.setItem('token', data.token); showDashboard(); }
        else { resDiv.className = 'alert alert-error'; resDiv.textContent = data.error; }
    } catch (err) { resDiv.className = 'alert alert-error'; resDiv.textContent = 'Error de conexión.'; }
});

document.getElementById('registerForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('name').value.trim();
    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;
    const country = (document.getElementById('regCountry')?.value || 'XX').toUpperCase();
    const prefix = (document.getElementById('phonePrefix')?.textContent || '').trim();
    const national = (document.getElementById('regPhone')?.value || '').trim();
    const resDiv = document.getElementById('resultado');

    if (!national) { resDiv.className = 'alert alert-error'; resDiv.textContent = 'Introduce tu número de teléfono.'; return; }

    // El chip (+57) y el input están separados en pantalla; los uno para enviar el teléfono completo
    const phone = (prefix + ' ' + national).replace(/\s+/g, ' ').trim();

    try {
        const res = await fetch('/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, email, password, country, phone }) });
        const data = await res.json();
        if (res.ok) {
            resDiv.className = 'alert alert-success';
            resDiv.textContent = '¡Cuenta creada con éxito! Ya puedes iniciar sesión.';
            e.target.reset();
            // reset() pone el hidden en VE pero NO toca el chip/trigger (son JS); los reconcilio:
            if (typeof renderTrigger === 'function' && typeof getCountry === 'function') renderTrigger(getCountry('VE'));
        }
        else { resDiv.className = 'alert alert-error'; resDiv.textContent = data.error; }
    } catch (err) { resDiv.className = 'alert alert-error'; resDiv.textContent = 'Error de conexión.'; }
});

document.getElementById('profileForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('cfgName').value;
    const email = document.getElementById('cfgEmail').value;
    const resDiv = document.getElementById('resProfile');
    try {
        const res = await fetch('/api/auth/profile', { method: 'PUT', headers: jsonHeaders(), body: JSON.stringify({ name, email }) });
        const data = await res.json();
        if (res.ok) {
            currentUser = data.user;
            document.getElementById('userName').textContent = currentUser.name;
            document.getElementById('userAvatar').textContent = currentUser.name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
            resDiv.className = 'alert alert-success'; resDiv.textContent = data.mensaje;
            setTimeout(() => { resDiv.textContent = ''; resDiv.className = ''; }, 3000);
        } else { resDiv.className = 'alert alert-error'; resDiv.textContent = data.error; }
    } catch (err) { resDiv.className = 'alert alert-error'; resDiv.textContent = 'Error de conexión.'; }
});

document.getElementById('passwordForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const currentPassword = document.getElementById('currentPassword').value;
    const newPassword = document.getElementById('newPassword').value;
    const resDiv = document.getElementById('resPassword');
    try {
        const res = await fetch('/api/auth/password', { method: 'PUT', headers: jsonHeaders(), body: JSON.stringify({ currentPassword, newPassword }) });
        const data = await res.json();
        if (res.ok) { resDiv.className = 'alert alert-success'; resDiv.textContent = data.mensaje; e.target.reset(); setTimeout(() => { resDiv.textContent = ''; resDiv.className = ''; }, 3000); }
        else { resDiv.className = 'alert alert-error'; resDiv.textContent = data.error; }
    } catch (err) { resDiv.className = 'alert alert-error'; resDiv.textContent = 'Error de conexión.'; }
});

async function uploadLogo(e) {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { alert('El logo debe pesar menos de 2MB.'); return; }
    
    const resultDiv = document.getElementById('logoResult');
    resultDiv.innerHTML = '<div class="alert" style="background:#eff6ff;color:#1e40af;">Subiendo logo...</div>';
    
    const formData = new FormData();
    formData.append('logo', file);
    
    try {
        const res = await fetch('/api/auth/logo', { method: 'PUT', headers: { 'Authorization': `Bearer ${getToken()}` }, body: formData });
        const data = await res.json();
        if (res.ok) {
            currentUser.logo_url = data.logo_url;
            const preview = document.getElementById('currentLogo');
            preview.src = data.logo_url;
            preview.style.display = 'block';
            resultDiv.innerHTML = '<div class="alert alert-success">✅ Logo actualizado. Aparecerá en los QR de tus galerías.</div>';
            setTimeout(() => { resultDiv.innerHTML = ''; }, 3000);
            loadUserLogo();
        } else {
            resultDiv.innerHTML = `<div class="alert alert-error">${data.error}</div>`;
        }
    } catch (err) {
        resultDiv.innerHTML = '<div class="alert alert-error">Error de conexión.</div>';
    }
}

async function loadUserLogo() {
    if (!currentUser) return;
    try {
        const res = await fetch('/api/auth/me', { headers: authHeaders() });
        if (res.ok) {
            const data = await res.json();
            currentUser = data.user;
            if (currentUser.logo_url) {
                const avatar = document.getElementById('userAvatar');
                if (avatar) {
                    avatar.innerHTML = `<img src="${currentUser.logo_url}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">`;
                }
                const preview = document.getElementById('currentLogo');
                if (preview) {
                    preview.src = currentUser.logo_url;
                    preview.style.display = 'block';
                }
            }
        }
    } catch (err) { console.error('Error cargando logo:', err); }
}