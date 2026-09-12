const express = require('express');
const mysql = require('mysql2/promise');
const session = require('express-session');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const path = require('path');
const helmet = require('helmet');
const compression = require('compression'); 
require('dotenv').config();

const app = express();
app.use(compression());

// ==================== ১. ডায়নামিক সিকিউরিটি (CSP) ও মিডলওয়্যার ====================
app.use(
  helmet.contentSecurityPolicy({
    directives: {
      defaultSrc: ["'self'"],
      connectSrc: ["'self'", "http://localhost:*", "https://*", "wss://*", "ws://*"], 
      scriptSrc: [
        "'self'", 
        "'unsafe-inline'", 
        "'unsafe-eval'", 
        "https://cdnjs.cloudflare.com", 
        "https://cdn.jsdelivr.net", 
        "https://cdn.tailwindcss.com",
        "https://unpkg.com" 
      ], 
      scriptSrcAttr: ["'unsafe-inline'"], 
      styleSrc: [
        "'self'", 
        "'unsafe-inline'", 
        "https://cdnjs.cloudflare.com", 
        "https://fonts.googleapis.com",
        "https://cdn.jsdelivr.net", 
        "https://unpkg.com" 
      ],
      imgSrc: [
        "'self'", 
        "data:", 
        "blob:", 
        "https://res.cloudinary.com",
        "https://*.cloudinary.com",
        "https://via.placeholder.com", 
        "https://dummyimage.com", 
        "https://*.dummyimage.com", 
        "https://lh3.googleusercontent.com", 
        "https://*.googleusercontent.com",
        "https://ui-avatars.com",
        "https://images.unsplash.com",
        "https://*.unsplash.com",
        "https://www.svgrepo.com"
      ],
      // এখানে Cloudinary যুক্ত করা হয়েছে 👇
      mediaSrc: [
        "'self'", 
        "data:", 
        "blob:", 
        "https://res.cloudinary.com", 
        "https://*.cloudinary.com"
      ],
      fontSrc: ["'self'", "https://cdnjs.cloudflare.com", "https://fonts.gstatic.com"],
      frameSrc: ["'self'", "https://adminnexkartbd-debug.github.io"], 
    },
  })
);

// বডি পার্সার
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));

// ==================== ২. ডায়নামিক ডাটাবেজ কানেকশন ====================
const db = mysql.createPool({
    host: process.env.DB_HOST || '127.0.0.1',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASS || '',
    database: process.env.DB_NAME || 'nexkart',
    port: process.env.DB_PORT || 3306,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

app.get('/favicon.ico', (req, res) => res.status(204).end());

app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ==================== ৩. সেশন ও পাসপোর্ট সেটআপ ====================
const isProduction = process.env.NODE_ENV === 'production';
app.set('trust proxy', 1);
app.use(session({
    secret: process.env.JWT_SECRET || 'nexkart_super_secret_key_2026',
    resave: false,
    saveUninitialized: false,
    cookie: { 
        maxAge: 24 * 60 * 60 * 1000,
        secure: isProduction,
        sameSite: 'lax'
    }
}));

app.use(passport.initialize());
app.use(passport.session());

// Serialize & Deserialize User
passport.serializeUser((user, done) => {
    const userType = user.user_type || (user.role ? 'admin' : 'user');
    done(null, { id: user.id, type: userType });
});

passport.deserializeUser(async (obj, done) => {
    try {
        if (obj.type === 'user') {
            const [rows] = await db.query("SELECT * FROM users WHERE id = ?", [obj.id]);
            if (rows.length > 0) {
                rows[0].user_type = 'user';
                done(null, rows[0]);
            } else {
                done(null, false);
            }
        } else {
            const [rows] = await db.query("SELECT * FROM admins WHERE id = ?", [obj.id]);
            if (rows.length > 0) {
                rows[0].user_type = 'admin';
                done(null, rows[0]);
            } else {
                done(null, false);
            }
        }
    } catch (err) {
        done(err, null);
    }
});

// Google OAuth Strategy
passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: process.env.GOOGLE_CALLBACK_URL
}, async (accessToken, refreshToken, profile, done) => {
    try {
        const email = profile.emails[0].value;
        const name = profile.displayName;
        const googleId = profile.id;

        const [existing] = await db.query("SELECT * FROM admins WHERE email = ?", [email]);

        if (existing.length > 0) {
            await db.query("UPDATE admins SET google_id = ? WHERE email = ?", [googleId, email]);
            return done(null, existing[0]);
        } else {
            const [result] = await db.query(
                `INSERT INTO admins (google_id, name, email, role, status, super_admin) VALUES (?, ?, ?, 'seller', 'pending', 'pending')`,
                [googleId, name, email]
            );
            const [newUser] = await db.query("SELECT * FROM admins WHERE id = ?", [result.insertId]);
            return done(null, newUser[0]);
        }
    } catch (err) {
        return done(err, null);
    }
}));

// Auth Routes
app.get('/auth/google', passport.authenticate('google', { scope: ['profile', 'email'] }));

app.get('/auth/google/callback', 
    passport.authenticate('google', { failureRedirect: '/admin/login.html' }),
    async (req, res) => {
        try {
            const [rows] = await db.query("SELECT status, action FROM admins WHERE id = ?", [req.user.id]);
            
            if (rows.length === 0) {
                return req.logout(() => {
                    res.redirect('/admin/login.html?error=suspended');
                });
            }

            const userStatus = rows[0].status ? rows[0].status.toLowerCase() : '';
            const userAction = rows[0].action ? rows[0].action.toLowerCase() : 'active';

            if (userStatus !== 'approved') {
                return req.logout(() => {
                    res.redirect('/admin/login.html?error=pending');
                });
            }

            if (userAction === 'suspend' || userAction === 'suspended') {
                return req.logout(() => {
                    res.redirect('/admin/login.html?error=suspended');
                });
            }

            req.session.seller_id = req.user.id;
            req.session.admin_id = req.user.id;

            res.redirect('/admin/home.html');

        } catch (err) {
            console.error("Google Auth Callback Error:", err);
            res.redirect('/admin/login.html?error=server');
        }
    }
);

// ==================== ৪. রাউট মাউন্টিং ====================
const adminRoutes = require('./routes/admin/admin');
const userRoutes = require('./routes/users/users');
const inquiryRouter = require('./routes/users/inquiries');
const profileRouter = require('./routes/users/profile'); 
const adminProfileRouter = require('./routes/admin/profile');
const couponRouter = require('./routes/admin/couponRouter');
const sellerProfileRouter = require('./routes/users/seller-profileRouter');
const userInboxRouter = require('./routes/users/userinbox'); 
const myOrderRouter = require('./routes/users/my-orderRouter');
const messageCenterRouter = require('./routes/users/messageCenterRouter');
const edprProductRoutes = require('./routes/admin/edprroutes');
const productRouter = require('./routes/admin/productRoutes'); 
const adminInboxRouter = require('./routes/admin/adminInbox');
const inquariedRouter = require('./routes/admin/Inquaried_sl'); 
const orderListRouter = require('./routes/admin/order-listRouter');
const cartRouter = require('./routes/users/cart.router');
const adminReviewRouter = require('./routes/admin/adminReviewRouter');
const verifyDocumentsRouter = require('./routes/admin/verifyDocuments'); 
const superAdminRouter = require('./routes/admin/superAdminRouter'); 
const iprRouter = require('./routes/users/iprRouter'); 
const withdrawRouter = require('./routes/admin/withdrawRouter');
const returnRefundRouter = require('./routes/admin/returnRefundRoutes');
const adminSettingRoute = require('./routes/admin/AdminSetting');
const returnsRouter = require('./routes/users/returns');
const myCouponRouter = require('./routes/users/my-couponRouter');
const userSettingsRouter = require('./routes/users/settings');
const popRouter = require('./routes/users/popRouter');
const coinRoutes = require('./routes/users/coinRoutes');

const startStockCron = require('./services/stockCalculator'); 
const startMailCron = require('./services/mailService'); 
const startCommissionCron = require('./services/commissionCalculator');
const { initWithdrawCron } = require('./services/sendMailCorn');

app.use('/auth', adminRoutes);

app.use('/admin', adminProfileRouter); 
app.use('/admin', couponRouter);
app.use('/admin/orders-list', orderListRouter);
app.use('/admin', verifyDocumentsRouter);
app.use('/admin', superAdminRouter);
app.use('/admin', withdrawRouter);
app.use('/admin', returnRefundRouter);

app.use('/user', popRouter);
app.use('/user', sellerProfileRouter);
app.use('/user', userInboxRouter);
app.use('/user', cartRouter);
app.use('/user', myOrderRouter);
app.use('/user', userRoutes); 
app.use('/user', profileRouter);
app.use('/user', inquiryRouter);
app.use('/user/returns', returnsRouter);
app.use('/my-coupons', myCouponRouter);
app.use('/settings', userSettingsRouter);

app.use('/api/ipr', iprRouter);
app.use('/api/products', edprProductRoutes);
app.use('/api/products', productRouter);
app.use('/api/admin-inbox', adminInboxRouter);
app.use('/api/admin/inquiries', inquariedRouter);
app.use('/api/admin/reviews', adminReviewRouter);
app.use('/api/message-center', messageCenterRouter);
app.use('/api/admin', adminSettingRoute);
app.use('/api/coins', coinRoutes);

app.use('/admin/uploads', express.static(path.join(__dirname, 'uploads')));

// Background Services
startStockCron();
startMailCron(); 
startCommissionCron();
initWithdrawCron();

// ==================== ৫. পেজ ও এপিআই রাউটস ====================
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'users', 'dashboard.html')); 
});

app.get('/admin/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin', 'login.html'));
});

app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin', 'login.html'));
});

app.get('/adminProduct.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin', 'adminProduct.html'));
});

app.get('/AdminProfile.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin', 'AdminProfile.html'));
});

app.get('/addItem.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin', 'addItem.html'));
});

app.get('/products', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin', 'editProduct.html'));
});

app.get('/home.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin', 'home.html'));
});

app.get('/editProduct.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin', 'editProduct.html'));
});

// Current User Endpoint
app.get('/api/current_user', (req, res) => {
    const currentUser = req.user || (req.session && req.session.admin) || null;

    if (currentUser) {
        res.json(currentUser);
    } else {
        res.status(401).json({ error: "Unauthorized" });
    }
});

// Logout Route
app.get('/logout', (req, res) => {
  if (req.session) {
    req.session.destroy((err) => {
      if (err) {
        console.error('Failed to destroy session during logout:', err);
        return res.status(500).send('Could not log out.');
      }
      res.clearCookie('connect.sid');
      return res.redirect('/login');
    });
  } else {
    return res.redirect('/login');
  }
});

// ==================== ৬. সার্ভার লিসেন (Server Listen) ====================
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`🚀 NexKart Server is running on port ${PORT}`);
});