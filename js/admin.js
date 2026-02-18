// Safe JSON parsing helper
async function safeJson(response) {
  const text = await response.text();
  console.log('[DEBUG] Raw response text:', text, 'Length:', text.length);
  if (!text || text.trim() === '') {
    throw new Error('Empty response from server');
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    console.error('[DEBUG] JSON parse error:', e, 'Text:', text);
    throw new Error('Invalid JSON response: ' + text.substring(0, 100));
  }
}

// Check if user is admin before allowing access
document.addEventListener('DOMContentLoaded', async function() {
  try {
    const res = await fetch('/api/auth/me', { credentials: 'same-origin' });
    const data = await safeJson(res);
    const user = data && data.success ? data.user : null;
    if (!user || user.role !== 'admin') {
      localStorage.removeItem('user');
      alert('âŒ Access Denied: Admin privileges required');
      window.location.href = '/public/admin-login.html';
      return;
    }
    localStorage.setItem('user', JSON.stringify({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role
    }));
    refreshAdminList();
    refreshRecoveryList();
  } catch {
    window.location.href = '/public/admin-login.html';
  }
});

function addGame() {
  const bookingCodeRaw = document.getElementById('bookingCode')?.value?.trim();
  const bookingCode = bookingCodeRaw ? bookingCodeRaw.toUpperCase() : '';
  const title = document.getElementById('title')?.value?.trim();
  const price = parseFloat(document.getElementById('price')?.value);
  const statusEl = document.getElementById('addGameStatus') || document.querySelector('div[id="addStatus"]') || createStatusElement();

  if (!bookingCode || !price) {
    statusEl.innerHTML = '<span style="color: #ff6b6b;">âŒ Booking code and price are required</span>';
    return;
  }

  statusEl.innerHTML = '<span style="color: #ffd700;">â³ Adding booking code...</span>';

  fetch("../api/admin", {
    method: "POST",
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: "add",
      booking_code: bookingCode,
      title: title || ('Booking Code: ' + bookingCode),
      home_team: '-',
      away_team: '-',
      score: '0:0',
      league: 'Booking Codes',
      price: price,
      description: document.getElementById('description')?.value
    })
  })
  .then(r => safeJson(r))
  .then(data => {
    if (data.success) {
      const match = data.match;
      statusEl.innerHTML = '<span style="color: #00ff00;">âœ“ ' + match.title + ' added successfully! Price: ' + match.price + '</span>';

      document.getElementById('title').value = '';
      document.getElementById('bookingCode').value = '';
      document.getElementById('price').value = '';
      document.getElementById('description').value = '';

      refreshAdminList();
      setTimeout(() => { statusEl.innerHTML = ''; }, 5000);
    } else {
      statusEl.innerHTML = '<span style="color: #ff6b6b;">âŒ Error: ' + (data.error || 'Failed to add game') + '</span>';
    }
  })
  .catch(err => {
    statusEl.innerHTML = '<span style="color: #ff6b6b;">âŒ Error: ' + err.message + '</span>';
  });
}

function createStatusElement() {
  const div = document.createElement('div');
  div.id = 'addGameStatus';
  div.style = 'margin-top: 15px; min-height: 20px; text-align: center;';
  document.querySelector('.form')?.appendChild(div);
  return div;
}

function refreshAdminList() {
  fetch("../api/admin?action=list")
    .then(r => safeJson(r))
    .then(data => {
      const gamesEl = document.getElementById('games');
      if (!gamesEl) return;

      gamesEl.innerHTML = "";
      if (!Array.isArray(data) || data.length === 0) {
        gamesEl.innerHTML = '<p style="color: #999;">No games added yet</p>';
        return;
      }

      data.forEach(g => {
        const code = g.booking_code ? g.booking_code : 'N/A';
        gamesEl.innerHTML += `
          <div>
            ${g.title} - ${code} - $${g.price}
            <button onclick="deleteGame(${g.id})">X</button>
          </div>`;
      });
    })
    .catch(err => {
      console.error('Error loading games:', err);
    });
}

function deleteGame(id) {
  fetch("../api/admin", {
    method: "POST",
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: "delete", id })
  })
  .then(r => safeJson(r))
  .then(data => {
    if (data.success) {
      refreshAdminList();
    }
  })
  .catch(err => {
    console.error('Error deleting game:', err);
  });
}

// Recovery flows
async function uploadRecovery() {
  const bookingCodeRaw = document.getElementById('recBookingCode')?.value?.trim();
  const bookingCode = bookingCodeRaw ? bookingCodeRaw.toUpperCase() : '';
  const status = document.getElementById('recoveryStatus');

  if (!bookingCode) {
    status.innerHTML = '<span style="color:#ff6b6b;">âŒ Booking code required</span>';
    return;
  }

  status.innerHTML = '<span style="color:#ffd700;">â³ Uploading to recovery...</span>';

  fetch('../api/recovery', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'add', booking_code: bookingCode })
  })
  .then(r => safeJson(r))
  .then(data => {
    if (data.success) {
      status.innerHTML = '<span style="color:#00ff00;">âœ“ Uploaded to recovery</span>';
      document.getElementById('recBookingCode').value = '';
      refreshRecoveryList();
      setTimeout(() => { status.innerHTML = ''; }, 4000);
    } else {
      status.innerHTML = '<span style="color:#ff6b6b;">âŒ ' + (data.error || 'Failed') + '</span>';
    }
  })
  .catch(err => { status.innerHTML = '<span style="color:#ff6b6b;">âŒ ' + err.message + '</span>'; });
}

function refreshRecoveryList() {
  fetch('../api/recovery')
    .then(r => safeJson(r))
    .then(data => {
      const el = document.getElementById('recoveryList');
      if (!el) return;
      el.innerHTML = '';
      if (!Array.isArray(data) || data.length === 0) {
        el.innerHTML = '<p style="color:#999;">No recovery games</p>';
        return;
      }
      data.forEach(item => {
        const approved = item.approved ? true : false;
        const label = item.booking_code ? ('Booking Code: ' + item.booking_code) : (item.title || 'Recovery Item');
        el.innerHTML += `
         <div>
          ${label} ${approved ? '<span style="color:#0a0;">(Approved)</span>' : '<span style="color:#aa0;">(Pending)</span>'}
          ${approved ? `<button onclick="importRecovery(${item.id})">Try Import</button>` : `<button onclick="approveRecovery(${item.id})">Approve</button>`}
          <button onclick="deleteRecovery(${item.id})">Remove</button>
         </div>`;
      });
    })
    .catch(err => console.error('Recovery list error', err));
}

function importRecovery(id) {
  fetch('../api/recovery', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'import', id })
  })
  .then(r => safeJson(r))
  .then(data => {
    if (data.success) {
      refreshAdminList();
      refreshRecoveryList();
      alert('Imported successfully');
    } else {
      alert('Import failed: ' + (data.error || 'Unknown'));
    }
  })
  .catch(err => alert('Error: ' + err.message));
}

function deleteRecovery(id) {
  fetch('../api/recovery', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'delete', id })
  })
  .then(r => safeJson(r))
  .then(() => refreshRecoveryList())
  .catch(err => console.error('Delete recovery error', err));
}

function approveRecovery(id) {
  fetch('../api/recovery', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'approve', id })
  })
  .then(r => safeJson(r))
  .then(data => {
    if (data.success) refreshRecoveryList();
    else alert('Approve failed: ' + (data.error || 'Unknown'));
  })
  .catch(err => alert('Error: ' + err.message));
}
