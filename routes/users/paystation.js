'use strict';
// Shared by cart and buy-now checkout. Keep this file in public/users/.
async function startPaystationCheckout(checkoutType, formData) {
  if (!['cart', 'buy_now'].includes(checkoutType)) throw new Error('Invalid checkout type');
  const response = await fetch('/user/paystation/start', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({ ...formData, checkout_type: checkoutType })
  });
  const raw = await response.text();
  let result;
  try { result = JSON.parse(raw); } catch {
    console.error('PayStation non-JSON response', response.status, raw.slice(0, 500));
    throw new Error(`Payment API unavailable (HTTP ${response.status}). Check backend route.`);
  }
  if (!response.ok || !result.success || !result.payment_url) {
    throw new Error(result.message || `Payment initiation failed (HTTP ${response.status})`);
  }
  const url = new URL(result.payment_url);
  if (url.protocol !== 'https:') throw new Error('Invalid payment URL');
  window.location.assign(url.href);
}
window.startPaystationCheckout = startPaystationCheckout;
