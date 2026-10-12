'use strict';
const axios = require('axios');
function baseUrl() {
  return process.env.PAYSTATION_MODE === 'live'
    ? 'https://api.paystation.com.bd'
    : 'https://sandbox.paystation.com.bd';
}
function merchantId() {
  if (!process.env.PAYSTATION_MERCHANT_ID) throw new Error('PAYSTATION_MERCHANT_ID missing');
  return process.env.PAYSTATION_MERCHANT_ID;
}
async function initiate({ invoice, amount, name, phone, email, address }) {
  if (!process.env.PAYSTATION_PASSWORD) throw new Error('PAYSTATION_PASSWORD missing');
  if (!Number.isInteger(amount) || amount <= 0) throw new Error('Invalid BDT amount');
  const callbackUrl = new URL('/user/paystation/callback', process.env.APP_URL).toString();
  const body = new URLSearchParams({
    merchantId: merchantId(), password: process.env.PAYSTATION_PASSWORD,
    invoice_number: invoice, currency: 'BDT', payment_amount: String(amount),
    pay_with_charge: process.env.PAYSTATION_PAY_WITH_CHARGE === '1' ? '1' : '0',
    cust_name: name, cust_phone: phone, cust_email: email,
    cust_address: address || '', callback_url: callbackUrl
  });
  const { data } = await axios.post(baseUrl() + '/initiate-payment', body.toString(), {
    timeout: 15000, headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }
  });
  if (String(data?.status_code) !== '200' || !data?.payment_url) throw new Error(data?.message || 'Payment initiation failed');
  const url = new URL(data.payment_url);
  if (url.protocol !== 'https:' || !['api.paystation.com.bd','sandbox.paystation.com.bd'].includes(url.hostname)) throw new Error('Untrusted payment URL');
  return data.payment_url;
}
async function verify(invoice) {
  const body = new URLSearchParams({ invoice_number: invoice });
  const { data } = await axios.post(baseUrl() + '/transaction-status', body.toString(), {
    timeout: 15000,
    headers: { merchantId: merchantId(), 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }
  });
  if (String(data?.status_code) !== '200' || !data?.data) throw new Error('Could not verify payment');
  return data.data;
}
module.exports = { initiate, verify };
