const express = require('express');
const router = express.Router();
const db = require('../../db'); 
const bcrypt = require('bcryptjs');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;

// Passport Google Strategy (Product Callback URL সহ)
passport.use('google-user-product', new GoogleStrategy({
    clientID: '45851651755-mqq8rap3sv2rc46p8265hrc8kgc2rbuh.apps.googleusercontent.com',
    clientSecret: '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',
    callbackURL: 'http://localhost:5000/user/auth/google/callback/product'
}, async (accessToken, refreshToken, profile, done) => {
    try {
        const email = profile.emails && profile.emails[0] ? profile.emails[0].value : null;
        const name = profile.displayName;

        let profile_image = null;
        if (profile.photos && profile.photos.length > 0) {
            profile_image = profile.photos[0].value;
        }

        // Admin ইমেইল চেক
        const [adminCheck] = await db.query("SELECT * FROM admins WHERE email = ?", [email]);
        if (adminCheck.length > 0) {
            return done(null, false, { message: 'Admin email cannot register as User!' });
        }

        const [existingUser] = await db.query("SELECT * FROM users WHERE email = ?", [email]);

        if (existingUser.length > 0) {
            if (!existingUser[0].profile_image && profile_image) {
                await db.query("UPDATE users SET profile_image = ? WHERE id = ?", [profile_image, existingUser[0].id]);
                existingUser[0].profile_image = profile_image;
            }
            existingUser[0].user_type = 'user';
            return done(null, existingUser[0]);
        } else {
            const [result] = await db.query(
                `INSERT INTO users (name, email, profile_image, is_verified, created_at) VALUES (?, ?, ?, 1, NOW())`,
                [name, email, profile_image]
            );
            const [newUser] = await db.query("SELECT * FROM users WHERE id = ?", [result.insertId]);
            newUser[0].user_type = 'user';
            return done(null, newUser[0]);
        }
    } catch (err) {
        console.error("Google Auth Error:", err);
        return done(err, null);
    }
}));

// ১. ফ্রন্টএন্ড থেকে প্রোডাক্ট পেজের রিডাইরেক্ট URL সেশনে সেভ করার রাউট
router.post('/save-redirect-url', (req, res) => {
    if (req.body.redirectTo) {
        req.session.redirectTo = req.body.redirectTo;
    }
    res.json({ success: true });
});

// ২. Google Login Initiate
router.get('/auth/google', passport.authenticate('google-user-product', { scope: ['profile', 'email'] }));

// ৩. Product Page-এর জন্য Google Login Callback Route (সেশন থেকে ইউআরএল নিয়ে বা ব্যাক করে রিফ্রেশ করবে)
router.get('/auth/google/callback/product', 
    passport.authenticate('google-user-product', { failureRedirect: '/user/cslogin?error=admin_email' }),
    (req, res) => {
        if (req.user) {
            req.session.user = { id: req.user.id, user_type: 'user' };
            req.session.userId = req.user.id;
        }
        
        // ড্যাশবোর্ডে পাঠানোর কোড বাদ দিয়ে সেশনের ইউআরএল অথবা ব্রাউজারের 'back' এ রিডাইরেক্ট করা হলো
        const targetUrl = req.session.redirectTo || 'back';
        delete req.session.redirectTo; 

        res.redirect(targetUrl);
    }
);

// ৪. Email & Password দিয়ে AJAX Login Route (Product Page / Popup-এর জন্য)
router.post('/cslogin-ajax', async (req, res) => {
    const { email, password } = req.body;

    try {
        if (!email || !password) {
            return res.status(400).json({ success: false, message: "ইমেইল এবং পাসওয়ার্ড প্রদান করুন!" });
        }

        const [adminCheck] = await db.query('SELECT * FROM admins WHERE email = ?', [email]);
        if (adminCheck.length > 0) {
            return res.status(400).json({ success: false, message: "এডমিন ইমেইল দিয়ে ইউজার লগইন সম্ভব নয়!" });
        }

        const [users] = await db.query('SELECT * FROM users WHERE email = ?', [email]);
        if (users.length === 0) {
            return res.status(400).json({ success: false, message: "ইমেইল বা পাসওয়ার্ড ভুল হয়েছে!" });
        }

        const user = users[0];
        user.user_type = 'user';

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(400).json({ success: false, message: "ইমেইল বা পাসওয়ার্ড ভুল হয়েছে!" });
        }

        req.login(user, (err) => {
            if (err) {
                return res.status(500).json({ success: false, message: "লগইন সেশন তৈরি করতে সমস্যা হয়েছে!" });
            }
            
            req.session.user = { id: user.id, user_type: 'user' }; 
            req.session.userId = user.id; 

            return res.json({ 
                success: true, 
                message: "লগইন সফল হয়েছে!",
                user: { id: user.id, name: user.name, email: user.email }
            });
        });

    } catch (err) {
        console.error("AJAX Login Error:", err);
        return res.status(500).json({ success: false, message: "সার্ভার ত্রুটি! আবার চেষ্টা করুন।" });
    }
});

// অর্ডার প্লেস করার রাউটার
router.post('/place-order', async (req, res) => {
    try {
        const userId = req.user ? req.user.id : (req.session && req.session.user ? req.session.user.id : (req.session && req.session.userId ? req.session.userId : null));
        
        if (!userId) {
            return res.status(401).json({ success: false, message: 'Unauthorized: Please login first!' });
        }

        const { product_id, quantity, payment_method, name, email, phone, district, address } = req.body;

        if (!product_id || !quantity || !name || !phone || !district || !address) {
            return res.status(400).json({ success: false, message: 'Essential order information is missing!' });
        }

        const [products] = await db.query('SELECT * FROM products WHERE id = ? OR product_id = ?', [product_id, product_id]);
        if (products.length === 0) {
            return res.status(404).json({ success: false, message: 'Product not found!' });
        }

        const product = products[0];
        const seller_id = product.admin_id || 0;
        const salePrice = parseFloat(product.sale_price || 0);
        
        let baseDeliveryCharge = Number(product.delivery_charge) || 60;
        const deliveryLimit = Number(product.delivery_limit) || 1;

        if (Number(product.free_shipping) === 1) {
            baseDeliveryCharge = 0;
        }

        let deliveryCharge = baseDeliveryCharge;
        if (deliveryLimit > 0 && baseDeliveryCharge > 0) {
            const multiplier = Math.ceil(quantity / deliveryLimit);
            deliveryCharge = baseDeliveryCharge * multiplier;
        }

        const subtotal = salePrice * quantity;
        const totalAmount = subtotal + deliveryCharge;
        const paymentStatus = payment_method === 'online' ? 'Paid (bKash Sandbox)' : 'Pending';
        const fullAddress = `${district}, ${address}`;

        const insertQuery = `
            INSERT INTO orders (user_id, product_id, seller_id, quantity, subtotal_price, delivery_charge, total_amount, payment_method, payment_status, customer_name, customer_email, customer_phone, shipping_address, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
        `;

        await db.query(insertQuery, [
            userId,
            product.id,
            seller_id,
            quantity,
            subtotal,
            deliveryCharge,
            totalAmount,
            payment_method,
            paymentStatus,
            name,
            email,
            phone,
            fullAddress
        ]);

        return res.json({ success: true, message: 'Order placed successfully!' });
    } catch (error) {
        console.error("Place Order Error:", error);
        return res.status(500).json({ success: false, message: 'Server Error during order placement!' });
    }
});

// বিকাশ স্যান্ডবক্স সাকসেস পেজ
router.get('/bkash-sandbox-success', async (req, res) => {
    res.send(`
        <div style="text-align:center; margin-top:100px; font-family:Poppins, sans-serif;">
            <h1 style="color: #28a745;">bKash Sandbox Payment Successful!</h1>
            <p>আপনার পেমেন্ট সফলভাবে সম্পন্ন হয়েছে। কিছুক্ষণের মধ্যে আপনার অর্ডারটি কনফার্ম করা হবে।</p>
            <a href="/user/dashboard" style="padding: 10px 20px; background: #ff4b6e; color: #fff; text-decoration: none; border-radius: 8px; display:inline-block; margin-top:20px;">ড্যাশবোর্ডে ফিরে যান</a>
        </div>
    `);
});

module.exports = router;