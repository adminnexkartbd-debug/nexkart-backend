const express = require('express');
const router = express.Router();
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const db = require('../../config/db'); // আপনার ডাটাবেস কনফিগারেশন পাথ অনুযায়ী অ্যাডজাস্ট করুন

// ==================== [ POPUP GOOGLE PASSPORT STRATEGY ] ====================
passport.use('google-popup', new GoogleStrategy({
    clientID: '532557505629-04dk1t4k3cmihggqjsaqv00nnsdacqj0.apps.googleusercontent.com',
    clientSecret: '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',
    callbackURL: 'https://www.nexkart.2bd.net/user/auth/google/popup/callback'
  },
  async (accessToken, refreshToken, profile, done) => {
    try {
      const email = profile.emails && profile.emails[0] ? profile.emails[0].value : null;
      if (!email) {
        return done(new Error('No email found from Google'), null);
      }

      // Check if user exists
      const [users] = await db.query('SELECT * FROM users WHERE email = ?', [email]);
      let user;

      if (users.length > 0) {
        user = users[0];
      } else {
        // New user creation
        const [result] = await db.query(
          'INSERT INTO users (name, email, google_id) VALUES (?, ?, ?)',
          [profile.displayName, email, profile.id]
        );
        user = { id: result.insertId, name: profile.displayName, email: email };
      }

      user.user_type = 'user';
      return done(null, user);
    } catch (err) {
      return done(err, null);
    }
  }
));

// ==================== [ ROUTES ] ====================

// ১. Google Login Trigger Route
router.get('/auth/google/popup', passport.authenticate('google-popup', { 
    scope: ['profile', 'email'],
    prompt: 'select_account' 
}));

// ২. Google Login Callback Route
router.get('/auth/google/popup/callback', (req, res, next) => {
  passport.authenticate('google-popup', (err, user, info) => {
    if (err || !user) {
      return res.send(`
        <script>
          alert("গুগল লগইন ব্যর্থ হয়েছে!");
          window.close();
        </script>
      `);
    }

    req.login(user, (loginErr) => {
      if (loginErr) {
        return res.send(`
          <script>
            alert("সেশন আপডেট করতে সমস্যা হয়েছে!");
            window.close();
          </script>
        `);
      }

      req.session.user = { id: user.id, user_type: 'user' };
      req.session.userId = user.id;

      // ড্যাশবোর্ডে রিডাইরেক্ট না করে পপআপ বন্ধ করা এবং মেইন পেজকে জানান দেয়া
      return res.send(`
        <script>
          if (window.opener) {
            window.opener.postMessage({ status: 'success', message: 'login_completed' }, '*');
          }
          window.close();
        </script>
      `);
    });
  })(req, res, next);
});

module.exports = router;