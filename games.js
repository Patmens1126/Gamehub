// Safe JSON parsing helper
async function safeJson(response) {
  const text = await response.text();
  console.log('[DEBUG] Raw response text:', text.substring(0, 100), 'Length:', text.length);
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

function buildSportybetLink(code) {
  return 'https://www.sportybet.com/?code=' + encodeURIComponent(code);
}

function renderBookingCodes(data) {
  const grid = document.getElementById('gameGrid');
  if (!grid) return;

  const user = JSON.parse(localStorage.getItem('user') || 'null');
  const isAdmin = !!(user && user.role === 'admin');

  grid.innerHTML = '';
  if (!Array.isArray(data) || data.length === 0) {
    data = getFallbackCodes();
  }

  data.forEach((g) => {
    const owned = !!g.owned;
    const title = g.title || 'Booking Code';
    const code = g.booking_code || '';
    const codeHtml = owned
      ? `<p class="booking-code"><a href="${buildSportybetLink(code)}" target="_blank" rel="noopener noreferrer">${code || 'View on Sportybet'}</a></p>`
      : '<p class="booking-code">Booking code hidden until purchase</p>';

    const actionHtml = isAdmin
      ? '<button disabled title="Cart is disabled for admin">Admin View</button>'
      : `<button onclick="addToCart(${g.id}, '${title.replace(/'/g, "\\'")}', ${g.price})">Add to Cart</button>`;

    grid.innerHTML += `
     <div class="game-card">
       <h3 class="match-title">${title}</h3>
       <p class="match-league">Sportybet Booking Code</p>
       ${codeHtml}
       <p class="game-price">Â¢${g.price}</p>
       ${actionHtml}
     </div>
    `;
  });
}

function getFallbackCodes() {
  return [
    { id: 9001, title: 'Weekend Bankers', booking_code: 'WKND7XQ', price: 5, owned: false },
    { id: 9002, title: 'Top Odds Combo', booking_code: 'ODDS9LM', price: 8, owned: false },
    { id: 9003, title: 'Sure 2 Odds', booking_code: 'SURE2AA', price: 3, owned: false },
    { id: 9004, title: 'Premium Tips', booking_code: 'PRM45ZT', price: 12, owned: false }
  ];
}

function loadBookingCodes() {
  fetch('../api/games')
    .then((r) => safeJson(r))
    .then((data) => renderBookingCodes(data))
    .catch((err) => {
      renderBookingCodes(getFallbackCodes());
      console.error('Booking code load error:', err);
    });
}

// Load booking codes when page loads
document.addEventListener('DOMContentLoaded', loadBookingCodes);

// Reload every 5 seconds to show admin updates in real-time
setInterval(loadBookingCodes, 5000);
