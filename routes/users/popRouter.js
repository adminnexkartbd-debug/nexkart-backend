const express = require('express');
const router = express.Router();
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const db = require('../../db'); // আপনার প্রজেক্টের ডাটাবেস কনফিগারেশন পাথ

// ==================== [ POPUP GOOGLE PASSPORT STRATEGY ] ====================
passport.use('google-popup', new GoogleStrategy({
    clientID: process.env.GOOGLE_USER_CLIENT_ID || '532557505629-04dk1t4k3cmihggqjsaqv00nnsdacqj0.apps.googleusercontent.com',
    clientSecret: process.env.GOOGLE_USER_CLIENT_SECRET || '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',
    callbackURL: process.env.GOOGLE_POPUP_CALLBACK_URL || 'https://www.nexkart.2bd.net/user/auth/google/popup/callback'
  },
  async (accessToken, refreshToken, profile, done) => {
    try {
      const email = profile.emails && profile.emails[0] ? profile.emails[0].value : null;
      if (!email) {
        return done(new Error('No email found from Google'), null);
      }

      // ১. অ্যাডমিন ইমেইল চেক (পপআপের ক্ষেত্রেও সুরক্ষা)
      const [adminCheck] = await db.query("SELECT * FROM admins WHERE email = ?", [email]);
      if (adminCheck.length > 0) {
        return done(null, false, { message: 'Admin email cannot register as User!' });
      }

      // ২. ইউজার ডাটাবেসে চেক করা
      const [existingUser] = await db.query("SELECT * FROM users WHERE email = ?", [email]);
      let user;

      if (existingUser.length > 0) {
        user = existingUser[0];
      } else {
        // নতুন ইউজার রেজিস্টার করা
        const profileImage = (profile.photos && profile.photos.length > 0) ? profile.photos[0].value : null;
        const [result] = await db.query(
          'INSERT INTO users (name, email, profile_image, is_verified, created_at) VALUES (?, ?, ?, 1, NOW())',
          [profile.displayName, email, profileImage]
        );
        const [newUser] = await db.query("SELECT * FROM users WHERE id = ?", [result.insertId]);
        user = newUser[0];
      }

      user.user_type = 'user';
      return done(null, user);
    } catch (err) {
      console.error("Popup Google Auth Error:", err);
      return done(err, null);
    }
  }
));

// ==================== [ POPUP AUTH ROUTES ] ====================

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

      // সেশন আপডেট
      req.session.user = { id: user.id, user_type: 'user' };
      req.session.userId = user.id;

      // মূল উইন্ডোতে 'success' মেসেজ পাঠিয়ে পপআপ বন্ধ করা
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
