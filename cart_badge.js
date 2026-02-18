function getCartItems() {
  return JSON.parse(localStorage.getItem('cart') || '[]');
}

function saveCartItems(cart) {
  localStorage.setItem('cart', JSON.stringify(cart));
  window.dispatchEvent(new Event('cart-updated'));
}

function showToast(message) {
  let toast = document.getElementById('cartToast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'cartToast';
    toast.style.position = 'fixed';
    toast.style.right = '16px';
    toast.style.bottom = '16px';
    toast.style.background = '#0d0f12';
    toast.style.border = '1px solid #1f2937';
    toast.style.color = '#e5e7eb';
    toast.style.padding = '10px 14px';
    toast.style.borderRadius = '8px';
    toast.style.boxShadow = '0 8px 20px rgba(0,0,0,0.35)';
    toast.style.zIndex = '999';
    toast.style.fontSize = '14px';
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 150ms ease';
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.style.opacity = '1';
  clearTimeout(toast._hideTimer);
  toast._hideTimer = setTimeout(() => {
    toast.style.opacity = '0';
  }, 1200);
}

function addToCart(id, title, price) {
  const cart = getCartItems();
  const existing = cart.find(item => item.id === id);
  const itemPrice = Number(price) || 0;

  if (existing) {
    existing.qty += 1;
  } else {
    cart.push({ id, title, price: itemPrice, qty: 1 });
  }

  saveCartItems(cart);
  showToast('Added to cart');
}

function updateCartBadge() {
  const badge = document.getElementById('cartCount');
  if (!badge) return;

  const cart = getCartItems();
  const count = cart.length;

  badge.textContent = String(count);
  badge.style.display = count > 0 ? 'inline-flex' : 'none';
}

document.addEventListener('DOMContentLoaded', updateCartBadge);
window.addEventListener('storage', updateCartBadge);
window.addEventListener('cart-updated', updateCartBadge);
