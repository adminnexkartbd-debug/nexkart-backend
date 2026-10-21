"use strict";
const path = require('path');
const VERSION = '2026-10-17';
const pages = {'/data-deletion':'data-deletion.html','/data-deletion.html':'data-deletion.html','/terms':'terms.html','/terms.html':'terms.html','/privacy-policy':'privacy.html','/privacy-policy.html':'privacy.html','/delivery-policy':'delivery-policy.html','/delivery-policy.html':'delivery-policy.html','/contact':'contact.html','/contact.html':'contact.html'};
const orderPaths = new Set(['/place-order','/api/cart/place-order','/paystation/start']);
module.exports = function customerPolicies(req, res, next) {
  const route = req.path.toLowerCase().replace(/\/+$/, '') || '/';
  if ((req.method === 'GET' || req.method === 'HEAD') && pages[route]) {
    return res.sendFile(path.resolve(__dirname, '../../public/users', pages[route]));
  }
  if (req.method === 'POST' && orderPaths.has(route)) {
    if (req.body?.policies_accepted !== true || req.body?.policy_version !== VERSION) {
      return res.status(400).json({success:false, code:'POLICY_ACCEPTANCE_REQUIRED', message:'Please read and accept the Terms & Conditions, Return & Refund Policy and Privacy Policy before ordering.'});
    }
    req.policyAcceptance = {version:VERSION, accepted_at:new Date().toISOString()};
  }
  return next();
};
