'use strict';
// Call this from BOTH Cart and Buy Now checkout, with the existing validated form fields.
async function startPaystationCheckout(checkoutType, formData) {
  const response=await fetch('/user/paystation/start',{
    method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({...formData,checkout_type:checkoutType})
  });
  const result=await response.json();
  if(!response.ok || !result.success || !result.payment_url) throw new Error(result.message||'Payment could not be started');
  window.location.assign(result.payment_url);
}
window.startPaystationCheckout=startPaystationCheckout;
