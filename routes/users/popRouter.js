const express = require('express');
const router = express.Router();
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const db = require('../../db'); // Apnar database configuration path onujayi adjust korun

// ==================== [ POPUP GOOGLE PASSPORT STRATEGY ] ====================
passport.use('google-popup', new GoogleStrategy({
    clientID: process.env.GOOGLE_USER_CLIENT_ID,
    clientSecret: process.env.GOOGLE_USER_CLIENT_SECRET,
    callbackURL: process.env.GOOGLE_USER_POPUP_CALLBACK_URL
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

// 1. Google Login Trigger Route
router.get('/auth/google/popup', passport.authenticate('google-popup', { 
    scope: ['profile', 'email'],
    prompt: 'select_account' 
}));

// 2. Google Login Callback Route
router.get('/auth/google/popup/callback', (req, res, next) => {
  passport.authenticate('google-popup', (err, user, info) => {
    if (err || !user) {
      return res.send(`
        <script>
          alert("Google login vyartha hoyeche!");
          window.close();
        </script>
      `);
    }

    req.login(user, (loginErr) => {
      if (loginErr) {
        return res.send(`
          <script>
            alert("Session update korte samasya hoyeche!");
            window.close();
          </script>
        `);
      }

      req.session.user = { id: user.id, user_type: 'user' };
      req.session.userId = user.id;

      // Dashboard-e redirect na kore popup bondho kora ebong main page-ke janano
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