// =====================================================
// AUTENTICACIÓN: LOGIN, REGISTRO, PERFIL, CONTRASEÑA
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
    const name = document.getElementById('name').value;
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    const role = document.getElementById('role').value;
    const resDiv = document.getElementById('resultado');
    try {
        const res = await fetch('/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, email, password, role }) });
        const data = await res.json();
        if (res.ok) { resDiv.className = 'alert alert-success'; resDiv.textContent = '¡Cuenta creada con éxito! Ya puedes iniciar sesión.'; e.target.reset(); }
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