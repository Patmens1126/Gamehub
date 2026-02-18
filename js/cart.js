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

const PAYSTACK_PUBLIC_KEY = "pk_live_171cde80be8c0cea754506f1fd8f0b62b864932e";
const PAYSTACK_CURRENCY = "GHS";

function loadCart() {
  let cart = JSON.parse(localStorage.getItem("cart")) || [];
  let total = 0;
  const box = document.getElementById("cartItems");

  if (!box) return;

  box.innerHTML = "";

  if (cart.length === 0) {
    box.innerHTML = '<p style="color:#999;">Your cart is empty.</p>';
  }

  cart.forEach(item => {
    total += item.price * item.qty;
    box.innerHTML += `
      <div class="cart-item">
        ${item.title} x ${item.qty}
        <span>¢${item.price * item.qty}</span>
      </div>
    `;
  });

  const totalEl = document.getElementById("total");
  if (totalEl) totalEl.innerText = "Total: ¢" + total;
}

function clearCart() {
  localStorage.removeItem('cart');
  window.dispatchEvent(new Event('cart-updated'));
  loadCart();
}

let pendingCart = null;
let pendingTotal = 0;

function openPaymentModal() {
  const modal = document.getElementById('paymentModal');
  const status = document.getElementById('paymentStatus');
  if (status) status.innerHTML = '';
  if (modal) modal.style.display = 'flex';
}

function closePaymentModal() {
  const modal = document.getElementById('paymentModal');
  if (modal) modal.style.display = 'none';
}

function validatePaymentForm() {
  const email = document.getElementById('payEmail')?.value?.trim();
  const phone = document.getElementById('payPhone')?.value?.trim();
  const method = document.getElementById('payMethod')?.value || 'all';

  if (!email) return 'Email is required';
  if (method === 'mobile_money' && !phone) {
    return 'Phone is required for Mobile Money';
  }
  return null;
}

async function finalizeOrder() {
  try {
    const res = await fetch("../api/orders", {
      method: "POST",
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: pendingCart, total: pendingTotal })
    });

    const result = await safeJson(res);

    if (result && result.success) {
      localStorage.removeItem("cart");
      window.dispatchEvent(new Event('cart-updated'));
      closePaymentModal();
      alert("Payment successful! Order placed.");
      window.location = "/public/games.html";
    } else {
      throw new Error(result.message || 'Unknown error');
    }
  } catch (err) {
    const status = document.getElementById('paymentStatus');
    if (status) status.innerHTML = '<span style="color:#ff6b6b;">Error: ' + err.message + '</span>';
  } finally {
    const btn = document.getElementById('payNowBtn');
    if (btn) btn.disabled = false;
  }
}

async function verifyPaystack(reference, expectedAmountKobo) {
  const res = await fetch("../api/paystack_verify", {
    method: "POST",
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      reference,
      expected_amount: expectedAmountKobo,
      currency: PAYSTACK_CURRENCY
    })
  });
  return safeJson(res);
}

function startPaystackPayment() {
  const hasV2 = !!window.Paystack;
  const hasV1 = !!window.PaystackPop;
  if (!hasV2 && !hasV1) {
    const status = document.getElementById('paymentStatus');
    if (status) status.innerHTML = '<span style="color:#ff6b6b;">Error: Paystack is not loaded</span>';
    return;
  }

  const email = document.getElementById('payEmail')?.value?.trim();
  const phone = document.getElementById('payPhone')?.value?.trim();
  const method = document.getElementById('payMethod')?.value || 'all';
  const amountKobo = Math.round((pendingTotal || 0) * 100);
  const reference = 'GH_' + Date.now() + '_' + Math.floor(Math.random() * 100000);

  const channelsMap = {
    all: ['card', 'bank', 'bank_transfer', 'mobile_money', 'ussd', 'qr'],
    card: ['card'],
    bank: ['bank'],
    bank_transfer: ['bank_transfer'],
    mobile_money: ['mobile_money'],
    ussd: ['ussd'],
    qr: ['qr']
  };

  const channels = channelsMap[method] || channelsMap.all;
  const onVerified = (responseRef) => {
    const status = document.getElementById('paymentStatus');
    if (status) status.innerHTML = '<span style="color:#ffd700;">Verifying payment...</span>';

    verifyPaystack(responseRef, amountKobo)
      .then(result => {
        if (result && result.success) {
          finalizeOrder();
        } else {
          const msg = result && result.message ? result.message : 'Verification failed';
          if (status) status.innerHTML = '<span style="color:#ff6b6b;">Error: ' + msg + '</span>';
          const btn = document.getElementById('payNowBtn');
          if (btn) btn.disabled = false;
        }
      })
      .catch(err => {
        if (status) status.innerHTML = '<span style="color:#ff6b6b;">Error: ' + err.message + '</span>';
        const btn = document.getElementById('payNowBtn');
        if (btn) btn.disabled = false;
      });
  };

  const onCancel = () => {
    const status = document.getElementById('paymentStatus');
    if (status) status.innerHTML = '<span style="color:#ff6b6b;">Payment canceled</span>';
    const btn = document.getElementById('payNowBtn');
    if (btn) btn.disabled = false;
  };

  if (hasV2) {
    const paystack = new window.Paystack();
    paystack.newTransaction({
      key: PAYSTACK_PUBLIC_KEY,
      email,
      amount: amountKobo,
      currency: PAYSTACK_CURRENCY,
      ref: reference,
      channels,
      phone,
      metadata: {
        custom_fields: [
          { display_name: "Phone", variable_name: "phone", value: phone || '' }
        ]
      },
      onSuccess: function(response) {
        onVerified(response.reference);
      },
      onCancel
    });
    return;
  }

  const handler = window.PaystackPop.setup({
    key: PAYSTACK_PUBLIC_KEY,
    email,
    amount: amountKobo,
    currency: PAYSTACK_CURRENCY,
    ref: reference,
    callback: function(response) {
      onVerified(response.reference);
    },
    onClose: onCancel
  });

  handler.openIframe();
}

function processPayment() {
  const status = document.getElementById('paymentStatus');
  const btn = document.getElementById('payNowBtn');
  const error = validatePaymentForm();
  if (error) {
    if (status) status.innerHTML = '<span style="color:#ff6b6b;">Error: ' + error + '</span>';
    return;
  }
  if (btn) btn.disabled = true;
  if (status) status.innerHTML = '<span style="color:#ffd700;">Opening Paystack...</span>';
  startPaystackPayment();
}

async function checkout() {
  let cart = JSON.parse(localStorage.getItem("cart")) || [];
  let total = cart.reduce((s,i)=>s+i.price*i.qty,0);

  if (!cart.length) {
    alert("Your cart is empty.");
    return;
  }

  pendingCart = cart;
  pendingTotal = total;
  openPaymentModal();
}

// auto load cart when page opens
document.addEventListener('DOMContentLoaded', loadCart);
