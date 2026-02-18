function buildLocalUser(user) {
  if (!user) return null;
  const fallbackName = (user.email || 'User').split('@')[0];
  return {
    id: user.id,
    name: user.name || fallbackName,
    email: user.email,
    role: user.role || 'user'
  };
}

async function safeJson(response) {
  const text = await response.text();
  if (!text || text.trim() === '') {
    throw new Error('Empty response from server');
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error('Invalid JSON response: ' + text.substring(0, 200));
  }
}

async function syncAuthFromServer() {
  try {
    const res = await fetch('/api/auth/me', { credentials: 'same-origin' });
    const result = await safeJson(res);
    if (result && result.success && result.user) {
      localStorage.setItem('user', JSON.stringify(buildLocalUser(result.user)));
      return result.user;
    }
    localStorage.removeItem('user');
    return null;
  } catch {
    return JSON.parse(localStorage.getItem('user') || 'null');
  }
}

function normalizePathname() {
  return (window.location.pathname || '').toLowerCase();
}

function getUserInitials(user) {
  const source = String(user?.name || user?.email || 'U').trim();
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return source.slice(0, 2).toUpperCase();
}

function closeProfileMenus() {
  document.querySelectorAll('.profile-popover').forEach((menu) => {
    menu.style.display = 'none';
  });
}

let isLoggingOut = false;

async function updateProfileName(currentUser) {
  const currentName = currentUser?.name || '';
  const nextName = window.prompt('Update display name:', currentName);
  if (nextName == null) return;
  const cleanName = nextName.trim();
  if (!cleanName) return;
  try {
    const res = await fetch('/api/auth/profile', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: cleanName })
    });
    const data = await safeJson(res);
    if (!data.success) {
      alert(data.error || 'Failed to update profile');
      return;
    }
    const localUser = buildLocalUser(data.user);
    localStorage.setItem('user', JSON.stringify(localUser));
    updateNavbarForUser(localUser);
  } catch (err) {
    alert(err.message || 'Failed to update profile');
  }
}

function updateNavbarForUser(user) {
  const isAdmin = !!(user && user.role === 'admin');
  const adminLinks = document.querySelectorAll('.admin-link');
  adminLinks.forEach((link) => {
    if (isAdmin) {
      link.textContent = 'Dashboard';
      link.setAttribute('href', '/public/admin.html');
    } else {
      link.textContent = 'Admin';
      link.setAttribute('href', '/public/admin-login.html');
    }
  });

  const cartLi = Array.from(document.querySelectorAll('.navbar li')).find((li) => {
    const a = li.querySelector('a');
    return !!a && /\/public\/cart\.html$/i.test(a.getAttribute('href') || '');
  });
  if (cartLi) cartLi.style.display = isAdmin ? 'none' : '';

  const gamesLink = Array.from(document.querySelectorAll('.navbar a')).find((a) =>
    /\/public\/games\.html$/i.test(a.getAttribute('href') || '')
  );
  if (gamesLink) gamesLink.textContent = 'Store';

  const navList = document.querySelector('.navbar ul');
  if (navList) {
    let uploadLi = navList.querySelector('li[data-nav="upload"]');
    if (isAdmin) {
      if (!uploadLi) {
        uploadLi = document.createElement('li');
        uploadLi.setAttribute('data-nav', 'upload');
        uploadLi.innerHTML = '<a href="/public/admin.html#recoverySection">Upload</a>';
        navList.appendChild(uploadLi);
      }
    } else if (uploadLi) {
      uploadLi.remove();
    }

    let profileLi = navList.querySelector('li[data-nav="profile"]');
    const logoutNode = Array.from(navList.querySelectorAll('li')).find((li) => {
      const a = li.querySelector('a.btn');
      return !!a && !a.classList.contains('admin-link');
    });

    if (user) {
      if (!profileLi) {
        profileLi = document.createElement('li');
        profileLi.setAttribute('data-nav', 'profile');
        navList.appendChild(profileLi);
      }
      profileLi.innerHTML = `
        <a href="#" class="profile-chip">
          <span class="profile-avatar">${getUserInitials(user)}</span>
        </a>
        <div class="profile-popover" style="display:none;">
          <strong class="profile-name">${user.name || 'User'}</strong>
          <small class="profile-email">${user.email || ''}</small>
          <button type="button" class="profile-edit-btn">Edit Name</button>
          <button type="button" class="profile-logout-btn">Logout</button>
        </div>
      `;

      const chip = profileLi.querySelector('.profile-chip');
      const menu = profileLi.querySelector('.profile-popover');
      const editBtn = profileLi.querySelector('.profile-edit-btn');
      const logoutBtn = profileLi.querySelector('.profile-logout-btn');
      if (chip && menu) {
        chip.onclick = function (e) {
          e.preventDefault();
          const open = menu.style.display !== 'none';
          closeProfileMenus();
          menu.style.display = open ? 'none' : 'flex';
        };
      }
      if (editBtn) {
        editBtn.onclick = async function () {
          closeProfileMenus();
          await updateProfileName(user);
        };
      }
      if (logoutBtn) {
        logoutBtn.onclick = function (e) {
          e.preventDefault();
          e.stopPropagation();
          if (!window.confirm('Are you sure you want to logout?')) return;
          closeProfileMenus();
          logout();
        };
      }

      if (logoutNode) logoutNode.style.display = 'none';
    } else {
      if (profileLi) profileLi.remove();
      if (logoutNode) logoutNode.style.display = '';
    }
  }

  const navButtons = document.querySelectorAll('.navbar a.btn');
  navButtons.forEach((btn) => {
    if (btn.classList.contains('admin-link')) return;
    if (user) {
      btn.style.display = 'none';
      btn.onclick = null;
    } else {
      btn.style.display = '';
      btn.textContent = 'Login';
      btn.setAttribute('href', '/public/login.html');
      btn.onclick = null;
    }
  });
}

function applyRouteGuards(user) {
  const path = normalizePathname();
  const isAdmin = !!(user && user.role === 'admin');

  if (path.endsWith('/public/admin.html') && !isAdmin) {
    window.location.href = '/public/admin-login.html';
    return;
  }
  if (path.endsWith('/public/admin-login.html') && isAdmin) {
    window.location.href = '/public/admin.html';
    return;
  }
  if (path.endsWith('/public/login.html') && user) {
    window.location.href = isAdmin ? '/public/admin.html' : '/public/games.html';
    return;
  }
  if (path.endsWith('/public/register.html') && user) {
    window.location.href = isAdmin ? '/public/admin.html' : '/public/games.html';
    return;
  }
  if (path.endsWith('/public/cart.html') && isAdmin) {
    window.location.href = '/public/admin.html';
  }
}

function showLoginHint() {
  const hint = document.getElementById('loginHint');
  if (!hint) return;
  if (location.protocol === 'file:') {
    hint.textContent = 'Please open this app via the Node server (e.g., http://localhost:3000).';
    return;
  }
  hint.textContent = '';
}

async function register() {
  const name = document.getElementById('name')?.value?.trim();
  const email = document.getElementById('email')?.value?.trim();
  const password = document.getElementById('password')?.value;
  const password_confirm = document.getElementById('password_confirm')?.value;
  const statusEl = document.getElementById('registerStatus');

  if (!name || !email || !password || !password_confirm) {
    statusEl.innerHTML = '<span style="color: #ff6b6b;">Ã¢ÂÅ’ All fields are required</span>';
    return;
  }
  if (password !== password_confirm) {
    statusEl.innerHTML = '<span style="color: #ff6b6b;">Ã¢ÂÅ’ Passwords do not match</span>';
    return;
  }

  statusEl.innerHTML = '<span style="color: #ffd700;">Ã¢ÂÂ³ Creating account...</span>';

  try {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, password, password_confirm })
    });
    const result = await safeJson(res);
    if (!result.success) {
      statusEl.innerHTML = '<span style="color: #ff6b6b;">Ã¢ÂÅ’ ' + (result.error || 'Registration failed') + '</span>';
      return;
    }
    localStorage.removeItem('user');
    statusEl.innerHTML = '<span style="color: #00ff00;">Ã¢Å“â€œ Registration successful! Please login...</span>';
    setTimeout(() => {
      window.location.href = '/public/login.html';
    }, 1500);
  } catch (error) {
    statusEl.innerHTML = '<span style="color: #ff6b6b;">Ã¢ÂÅ’ Error: ' + error.message + '</span>';
  }
}

async function login() {
  showLoginHint();
  const email = document.getElementById('email')?.value?.trim();
  const password = document.getElementById('password')?.value;
  const statusEl = document.getElementById('loginStatus');

  if (!email || !password) {
    statusEl.innerHTML = '<span style="color: #ff6b6b;">Ã¢ÂÅ’ Email and password required</span>';
    return;
  }

  statusEl.innerHTML = '<span style="color: #ffd700;">Ã¢ÂÂ³ Logging in...</span>';

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const result = await safeJson(res);
    if (!result.success) {
      statusEl.innerHTML = '<span style="color: #ff6b6b;">Ã¢ÂÅ’ ' + (result.error || 'Login failed') + '</span>';
      return;
    }

    const localUser = buildLocalUser(result.user);
    if (localUser) localStorage.setItem('user', JSON.stringify(localUser));

    statusEl.innerHTML = '<span style="color: #00ff00;">Ã¢Å“â€œ Welcome back! Redirecting...</span>';
    setTimeout(() => {
      if (localUser && localUser.role === 'admin') {
        window.location.href = '/public/admin.html';
      } else {
        window.location.href = '/public/games.html';
      }
    }, 1500);
  } catch (error) {
    statusEl.innerHTML = '<span style="color: #ff6b6b;">Ã¢ÂÅ’ Error: ' + error.message + '</span>';
  }
}

async function loginAdmin() {
  showLoginHint();
  const email = document.getElementById('email')?.value?.trim();
  const password = document.getElementById('password')?.value;
  const statusEl = document.getElementById('loginStatus');

  if (!email || !password) {
    statusEl.innerHTML = '<span style="color: #ff6b6b;">Ã¢ÂÅ’ Email and password required</span>';
    return;
  }

  statusEl.innerHTML = '<span style="color: #ffd700;">Ã¢ÂÂ³ Logging in...</span>';

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const result = await safeJson(res);
    if (!result.success) {
      statusEl.innerHTML = '<span style="color: #ff6b6b;">Ã¢ÂÅ’ ' + (result.error || 'Login failed') + '</span>';
      return;
    }

    const localUser = buildLocalUser(result.user);
    if (!localUser || localUser.role !== 'admin') {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
      localStorage.removeItem('user');
      statusEl.innerHTML = '<span style="color: #ff6b6b;">Ã¢ÂÅ’ Admin access required</span>';
      return;
    }

    localStorage.setItem('user', JSON.stringify(localUser));
    statusEl.innerHTML = '<span style="color: #00ff00;">Ã¢Å“â€œ Welcome back! Redirecting...</span>';
    setTimeout(() => {
      window.location.href = '/public/admin.html';
    }, 1200);
  } catch (error) {
    statusEl.innerHTML = '<span style="color: #ff6b6b;">Ã¢ÂÅ’ Error: ' + error.message + '</span>';
  }
}

async function logout() {
  if (isLoggingOut) return;
  isLoggingOut = true;
  const currentUser = JSON.parse(localStorage.getItem('user') || 'null');
  const redirectTo = currentUser && currentUser.role === 'admin'
    ? '/public/games.html'
    : '/public/login.html';
  try {
    await fetch('/api/auth/logout', {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store'
    });
  } finally {
    localStorage.removeItem('user');
    sessionStorage.removeItem('user');
    window.location.replace(redirectTo);
  }
}

function checkAuth() {
  const user = JSON.parse(localStorage.getItem('user') || 'null');
  return user;
}

function isAdmin() {
  const user = checkAuth();
  return user && user.role === 'admin';
}

document.addEventListener('DOMContentLoaded', async () => {
  document.addEventListener('click', (e) => {
    const target = e.target;
    if (!(target instanceof Element)) return;
    if (!target.closest('li[data-nav="profile"]')) closeProfileMenus();
  });
  showLoginHint();
  const user = await syncAuthFromServer();
  updateNavbarForUser(user);
  applyRouteGuards(user);
});

