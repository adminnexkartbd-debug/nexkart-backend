'use strict';
const express = require('express');
const axios = require('axios');
const crypto = require('node:crypto');
const db = require('../../db');
const router = express.Router();
const ORIGIN = 'https://www.nexkartbd.com';
const errors = {
 config: 'Facebook login is not configured. Please contact support.',
 state: 'Your login session expired. Please try again.',
 cancelled: 'Facebook login was cancelled. Please try again.',
 email: 'Facebook did not share an email address. Allow email access or use Google / email signup.',
 existing: 'This email already has an account. Sign in using Google or your password, then use Connect Facebook below.',
 admin: 'Please use the admin login for this account.',
 linked: 'This Facebook account is already connected to another customer.',
 server: 'Facebook login could not be completed. Please try again later.'
};
function safeTarget(value) {
 try {
  if (typeof value !== 'string' || /[\\\r\n]/.test(value)) return '/user/dashboard';
  const url = new URL(value, ORIGIN);
  if (url.origin !== ORIGIN || !url.pathname.startsWith('/user/') || /\/auth\//.test(url.pathname)) return '/user/dashboard';
  return url.pathname + url.search;
 } catch { return '/user/dashboard'; }
}
function settings() {
 const id = process.env.FACEBOOK_APP_ID_LOGIN;
 const secret = process.env.FACEBOOK_APP_SECRET_LOGIN;
 const callback = process.env.FACEBOOK_CALLBACK_URL_LOGIN;
 const version = process.env.FACEBOOK_GRAPH_VERSION_LOGIN || 'v25.0';
 if (!id || !secret || callback !== ORIGIN + '/user/auth/facebook/callback' || !/^v\d+\.0$/.test(version)) return null;
 return { id, secret, callback, version };
}
function failure(res, key, popup = false) {
 const message = errors[key] || errors.server;
 if (popup) return popupResult(res, false, '/user/cslogin', message);
 return res.redirect('/user/cslogin?facebook_error=' + encodeURIComponent(key));
}
function popupResult(res, success, target, message = '') {
 // Values are server-generated or allowlisted; no OAuth tokens enter HTML.
 const nonce = crypto.randomBytes(18).toString('base64');
 const data = JSON.stringify({status: success ? 'success' : 'error', message: success ? 'login_completed' : message, provider: 'facebook'}).replace(/</g, '\\u003c');
 res.set('Cache-Control', 'no-store');
 res.set('Content-Security-Policy', `default-src 'none'; script-src 'nonce-${nonce}'; base-uri 'none'; frame-ancestors 'none'`);
 return res.type('html').send(`<!doctype html><meta charset="utf-8"><title>Facebook login</title><p>${success ? 'Login successful. You can return to your product.' : 'Facebook login failed. Return to the login window and try again.'}</p><script nonce="${nonce}">if(window.opener){window.opener.postMessage(${data},${JSON.stringify(ORIGIN)});window.close();}else{window.location.replace(${JSON.stringify(target).replace(/</g, '\\u003c')});}</script>`);
}
router.get('/auth/facebook', (req, res) => {
 const cfg = settings();
 const popup = req.query.popup === '1';
 if (!cfg) return failure(res, 'config', popup);
 const linkUserId = req.query.link === '1' && req.user && req.user.user_type === 'user' ? req.user.id : null;
 if (req.query.link === '1' && !linkUserId) return failure(res, 'existing', popup);
 const state = crypto.randomBytes(32).toString('hex');
 req.session.facebookLogin = {state, time: Date.now(), popup, target: safeTarget(req.query.returnTo || req.session.redirectTo), linkUserId};
 const params = new URLSearchParams({client_id: cfg.id, redirect_uri: cfg.callback, state, response_type: 'code', scope: 'public_profile,email', auth_type: 'rerequest'});
 req.session.save(err => err ? failure(res, 'server', popup) : res.redirect(`https://www.facebook.com/${cfg.version}/dialog/oauth?${params}`));
});
router.get('/auth/facebook/callback', async (req, res) => {
 res.set('Cache-Control', 'no-store');
 const flow = req.session.facebookLogin;
 delete req.session.facebookLogin;
 const state = typeof req.query.state === 'string' ? req.query.state : '';
 if (!/^[a-f0-9]{64}$/.test(state) || !flow || Date.now() - flow.time > 10 * 60 * 1000 || state.length !== flow.state.length || !crypto.timingSafeEqual(Buffer.from(state), Buffer.from(flow.state))) return failure(res, 'state');
 const cfg = settings();
 if (!cfg) return failure(res, 'config', flow.popup);
 if (req.query.error || typeof req.query.code !== 'string') return failure(res, 'cancelled', flow.popup);
 // Persist state consumption before exchanging the single-use code.
 try {
  await new Promise((resolve, reject) => req.session.save(e => e ? reject(e) : resolve()));
  const tokenResult = await axios.get(`https://graph.facebook.com/${cfg.version}/oauth/access_token`, {params: {client_id: cfg.id, client_secret: cfg.secret, redirect_uri: cfg.callback, code: req.query.code}, timeout: 15000});
  const token = tokenResult.data.access_token;
  if (!token) throw new Error('No access token');
  const proof = crypto.createHmac('sha256', cfg.secret).update(token).digest('hex');
  const profileResult = await axios.get(`https://graph.facebook.com/${cfg.version}/me`, {headers: {Authorization: `Bearer ${token}`}, params: {fields: 'id,name,email', appsecret_proof: proof}, timeout: 15000});
  const profile = profileResult.data;
  if (!/^\d{1,64}$/.test(String(profile.id || ''))) throw new Error('Invalid identity');
  const email = typeof profile.email === 'string' ? profile.email.trim().toLowerCase() : '';
  if (email) {
   const [admins] = await db.query('SELECT id FROM admins WHERE email = ? LIMIT 1', [email]);
   if (admins.length) return failure(res, 'admin', flow.popup);
  }
  const [identities] = await db.query('SELECT u.* FROM customer_facebook_login f JOIN users u ON u.id = f.user_id WHERE f.facebook_id = ? LIMIT 1', [profile.id]);
  let user = identities[0];
  if (flow.linkUserId) {
   if (!req.user || req.user.user_type !== 'user' || String(req.user.id) !== String(flow.linkUserId)) return failure(res, 'state', flow.popup);
   if (user && String(user.id) !== String(flow.linkUserId)) return failure(res, 'linked', flow.popup);
   if (!user) {
    const [already] = await db.query('SELECT facebook_id FROM customer_facebook_login WHERE user_id = ?', [flow.linkUserId]);
    if (already.length) return failure(res, 'linked', flow.popup);
    await db.query('INSERT INTO customer_facebook_login (facebook_id, user_id) VALUES (?, ?)', [profile.id, flow.linkUserId]);
    user = req.user;
   }
  } else if (!user) {
   if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return failure(res, 'email', flow.popup);
   const conn = await db.getConnection();
   try {
    await conn.beginTransaction();
    const [existing] = await conn.query('SELECT id FROM users WHERE email = ? LIMIT 1 FOR UPDATE', [email]);
    if (existing.length) { await conn.rollback(); return failure(res, 'existing', flow.popup); }
    const [insert] = await conn.query('INSERT INTO users (name, email, is_verified, created_at) VALUES (?, ?, 1, NOW())', [String(profile.name || 'Facebook Customer').slice(0, 100), email]);
    await conn.query('INSERT INTO customer_facebook_login (facebook_id, user_id) VALUES (?, ?)', [profile.id, insert.insertId]);
    const [rows] = await conn.query('SELECT * FROM users WHERE id = ?', [insert.insertId]);
    user = rows[0];
    await conn.commit();
   } catch (error) { await conn.rollback(); throw error; } finally { conn.release(); }
  }
  user.user_type = 'user';
  // Passport regenerates the session; capture the validated destination first.
  req.logIn(user, err => {
   if (err) return failure(res, 'server', flow.popup);
   req.session.user = {id: user.id, user_type: 'user'};
   req.session.userId = user.id;
   delete req.session.redirectTo;
   req.session.save(saveErr => {
    if (saveErr) return failure(res, 'server', flow.popup);
    return flow.popup ? popupResult(res, true, flow.target) : res.redirect(flow.target);
   });
  });
 } catch (error) {
  // Never log Axios errors: their request config can contain secrets and tokens.
  console.error('[Facebook Login] Failed:', error.code || 'AUTH_FAILED');
  return failure(res, 'server', flow.popup);
 }
});
module.exports = router;
