'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');

// Keep authentication on the existing main origin so existing sessions,
// Google callback URLs and signup remain compatible without shared cookies.
module.exports = function createLoginSubdomain(root) {
  const loginPaths = new Set(['/', '/index.html', '/user/cslogin', '/users/cslogin.html']);
  return async function loginSubdomain(req, res, next) {
    if (req.hostname.toLowerCase() !== 'login.nexkartbd.com' ||
        !['GET', 'HEAD'].includes(req.method) || !loginPaths.has(req.path)) return next();
    try {
      let html = await fs.readFile(path.join(root, 'public', 'users', 'cslogin.html'), 'utf8');
      // Explicit destinations prevent login and signup from creating a session
      // confined to login.nexkartbd.com. Local images and policy modals still
      // use this same backend's existing static routes.
      html = html.replace('action="/user/login"', 'action="https://www.nexkartbd.com/user/login"')
        .replace('href="/user/auth/facebook"', 'href="https://www.nexkartbd.com/user/auth/facebook"')
        .replace('href="/user/auth/google"', 'href="https://www.nexkartbd.com/user/auth/google"')
        .replace('href="/user/cssignup"', 'href="https://www.nexkartbd.com/user/cssignup"')
        .replace('href="/user/psrst"', 'href="https://www.nexkartbd.com/user/psrst"');
      res.set('X-Robots-Tag', 'noindex, nofollow');
      res.set('Cache-Control', 'no-store');
      return res.type('html').send(html);
    } catch (error) { return next(error); }
  };
};
