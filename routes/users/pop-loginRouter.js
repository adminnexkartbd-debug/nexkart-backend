const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const db = require('../../db');

// ==========================================
// ১. পপ-আপের জন্য Google Strategy সেটআপ
// ==========================================
passport.use('google-pop', new GoogleStrategy({
    clientID: process.env.GOOGLE_POP_CLIENT_ID || process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_POP_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: process.env.GOOGLE_POP_CALLBACK_URL, 
    proxy: true 
  },
  async (accessToken, refreshToken, profile, done) => {
    try {
      const email = profile.emails && profile.emails[0] ? profile.emails[0].value : null;
      const googleId = profile.id;
      const name = profile.displayName;
      const profilePic = profile.photos && profile.photos[0] ? profile.photos[0].value : '';

      if (!email) {
        return done(null, false, { message: 'No email associated with Google account' });
      }

      const [existingUsers] = await db.query('SELECT * FROM users WHERE email = ?', [email]);

      if (existingUsers.length > 0) {
        let user = existingUsers[0];
        if (!user.google_id) {
          await db.query('UPDATE users SET google_id = ? WHERE id = ?', [googleId, user.id]);
          user.google_id = googleId;
        }
        return done(null, user);
      } else {
        const [result] = await db.query(
          'INSERT INTO users (name, email, google_id, profile_image, created_at) VALUES (?, ?, ?, ?, NOW())',
          [name, email, googleId, profilePic]
        );
        const newUser = { id: result.insertId, name, email, google_id: googleId, profile_image: profilePic };
        return done(null, newUser);
      }
    } catch (err) {
      console.error("Google Strategy Pop Error:", err);
      return done(err, null);
    }
  }
));

passport.deserializeUser(async (id, done) => {
    try {
        const [users] = await db.query('SELECT * FROM users WHERE id = ?', [id]);
        done(null, users[0] || null);
    } catch (err) {
        done(err, null);
    }
});

// ম্যানুয়াল মডাল লগইন রাউট
router.post('/pop-login', async (req, res) => {
    const { email, password } = req.body;

    try {
        const [users] = await db.query('SELECT * FROM users WHERE email = ?', [email]);
        if (users.length === 0) {
            return res.json({ success: false, message: 'ইউজার পাওয়া যায়নি!' });
        }

        const user = users[0];
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.json({ success: false, message: 'পাসওয়ার্ড ভুল হয়েছে!' });
        }

        req.login(user, (err) => {
            if (err) {
                console.error("Pop-up Login Session Error:", err);
                return res.json({ success: false, message: 'লগইন সেশন তৈরি করতে সমস্যা হয়েছে!' });
            }

            req.session.user = { id: user.id, email: user.email, user_type: 'user' };
            req.session.userId = user.id;

            const redirectUrl = req.session.redirectTo || null;
            delete req.session.redirectTo;

            return res.json({ 
                success: true, 
                message: 'লগইন সফল হয়েছে!',
                redirectUrl: redirectUrl 
            });
        });
    } catch (error) {
        console.error("Pop Login Error:", error);
        res.status(500).json({ success: false, message: 'সার্ভার এরর তৈরি হয়েছে!' });
    }
});

// ১. গুগল লগইন ট্রিগার
router.get('/auth/google/pop', (req, res, next) => {
    // বর্তমান পেজের URL ধরা
    const redirectTo = req.query.redirectTo || req.headers.referer || '/';
    req.session.redirectTo = redirectTo;

    passport.authenticate('google-pop', { 
        scope: ['profile', 'email'],
        state: redirectTo
    })(req, res, next);
});

// ২. গুগল কলব্যাক রুট
router.get('/auth/google/pop/callback', 
  passport.authenticate('google-pop', { failureRedirect: '/login-failure' }),
  (req, res) => {
    req.session.user = { id: req.user.id, email: req.user.email, user_type: 'user' };
    req.session.userId = req.user.id;

    // রিডাইরেক্ট URL বের করা
    let targetUrl = req.query.state || req.session.redirectTo || '/';
    delete req.session.redirectTo;

    // Localhost এবং Live Domain সংক্রান্ত URL mismatch হ্যান্ডেল করা
    if (targetUrl.includes('localhost')) {
        const urlObj = new URL(targetUrl);
        targetUrl = urlObj.pathname + urlObj.search; // শুধুমাত্র /user/product-details?id=... অংশটি নিবে
    }

    // ক্লায়েন্ট-সাইড স্ক্রিপ্ট দিয়ে পেজ রিফ্রেশ ও উইন্ডো ক্লোজ
    res.send(`
        <!DOCTYPE html>
        <html>
        <head><title>Authentication Success</title></head>
        <body>
            <script>
                const target = "${targetUrl}";
                if (window.opener && !window.opener.closed) {
                    window.opener.location.href = target;
                    window.close();
                } else {
                    window.location.href = target;
                }
            </script>
        </body>
        </html>
    `);
});

module.exports = router;