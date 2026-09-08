const express = require('express');
const router = express.Router();
const path = require('path');
const db = require('../../db'); 
const nodemailer = require('nodemailer');
const bcrypt = require('bcryptjs');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const crypto = require('crypto');
const multer = require('multer');
const axios = require('axios');

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'public/uploads/');
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + path.extname(file.originalname));
    }
});
const upload = multer({ storage: storage });

passport.use('google-user', new GoogleStrategy({
    clientID: process.env.GOOGLE_USER_CLIENT_ID,
    clientSecret: process.env.GOOGLE_USER_CLIENT_SECRET,
    callbackURL: process.env.GOOGLE_USER_CALLBACK_URL,
    proxy: true // ক্লাউড বা রিভার্স প্রক্সির জন্য যুক্ত করা হলো
}, async (accessToken, refreshToken, profile, done) => {
    try {
        const email = profile.emails && profile.emails[0] ? profile.emails[0].value : null;
        const name = profile.displayName;

        let profile_image = null;
        if (profile.photos && profile.photos.length > 0) {
            profile_image = profile.photos[0].value;
        }

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

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});


// ১.৩ AJAX এর মাধ্যমে রিডাইরেক্ট URL সেশনে সেভ করার রাউট
router.post('/save-redirect-url', (req, res) => {
    if (req.body && req.body.redirectTo) {
        req.session.returnTo = req.body.redirectTo;
        return res.json({ success: true });
    }
    return res.status(400).json({ success: false });
});

// ==================== [ HELPER: INVOICE EMAIL SENDER ] ====================
async function sendInvoiceEmail(orderData, productTitle) {
    if (!orderData.customer_email) return;

    const emailTemplate = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e0e0e0; border-radius: 10px; padding: 20px; background-color: #ffffff;">
            <div style="text-align: center; border-bottom: 2px solid #ff4b6e; padding-bottom: 10px;">
                <h1 style="color: #ff4b6e; margin: 0;">NexKart</h1>
                <p style="color: #666; font-size: 14px; margin-top: 5px;">Order Invoice / Receipt</p>
            </div>
            
            <div style="margin-top: 20px; color: #333;">
                <p>Hello <strong>${orderData.customer_name}</strong>,</p>
                <p>Thank you for shopping with NexKart! Your order has been placed successfully.</p>
                
                <table style="width: 100%; border-collapse: collapse; margin-top: 15px; font-size: 14px;">
                    <tr style="background-color: #f8f9fa;">
                        <td style="padding: 8px; border: 1px solid #ddd;"><strong>Order ID:</strong></td>
                        <td style="padding: 8px; border: 1px solid #ddd; color: #ff4b6e; font-weight: bold;">${orderData.order_id}</td>
                    </tr>
                    <tr>
                        <td style="padding: 8px; border: 1px solid #ddd;"><strong>Payment Method:</strong></td>
                        <td style="padding: 8px; border: 1px solid #ddd; text-transform: uppercase;">${orderData.payment_method} ${orderData.selected_gateway ? '(' + orderData.selected_gateway + ')' : ''}</td>
                    </tr>
                    <tr style="background-color: #f8f9fa;">
                        <td style="padding: 8px; border: 1px solid #ddd;"><strong>Payment Status:</strong></td>
                        <td style="padding: 8px; border: 1px solid #ddd;">${orderData.payment_status}</td>
                    </tr>
                </table>

                <h3 style="color: #ff4b6e; margin-top: 25px; border-bottom: 1px solid #eee; padding-bottom: 5px;">Order Details</h3>
                <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
                    <thead>
                        <tr style="background-color: #ff4b6e; color: white;">
                            <th style="padding: 8px; border: 1px solid #ddd; text-align: left;">Product</th>
                            <th style="padding: 8px; border: 1px solid #ddd; text-align: center;">Qty</th>
                            <th style="padding: 8px; border: 1px solid #ddd; text-align: right;">Total</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td style="padding: 8px; border: 1px solid #ddd;">
                                ${productTitle}
                                ${orderData.variant ? `<br><small style="color: #777;">Variant: ${orderData.variant}</small>` : ''}
                            </td>
                            <td style="padding: 8px; border: 1px solid #ddd; text-align: center;">${orderData.quantity}</td>
                            <td style="padding: 8px; border: 1px solid #ddd; text-align: right;">৳${orderData.subtotal_price}</td>
                        </tr>
                        <tr>
                            <td colspan="2" style="padding: 8px; border: 1px solid #ddd; text-align: right;"><strong>Delivery Charge:</strong></td>
                            <td style="padding: 8px; border: 1px solid #ddd; text-align: right;">৳${orderData.delivery_charge}</td>
                        </tr>
                        <tr style="background-color: #fff0f3;">
                            <td colspan="2" style="padding: 8px; border: 1px solid #ddd; text-align: right;"><strong>Grand Total:</strong></td>
                            <td style="padding: 8px; border: 1px solid #ddd; text-align: right; color: #ff4b6e; font-weight: bold;">৳${orderData.total_amount}</td>
                        </tr>
                    </tbody>
                </table>

                <h3 style="color: #ff4b6e; margin-top: 25px; border-bottom: 1px solid #eee; padding-bottom: 5px;">Shipping Information</h3>
                <p style="font-size: 13px; color: #555; line-height: 1.6; background-color: #f8f9fa; padding: 10px; border-radius: 5px;">
                    <strong>Phone:</strong> ${orderData.customer_phone}<br>
                    <strong>Address:</strong> ${orderData.shipping_address}
                </p>
            </div>

            <div style="text-align: center; margin-top: 30px; border-top: 1px solid #eee; padding-top: 15px; color: #999; font-size: 12px;">
                <p>If you have any questions, please contact our support team.</p>
                <p>© ${new Date().getFullYear()} NexKart. All rights reserved.</p>
            </div>
        </div>
    `;

    try {
        await transporter.sendMail({
            from: process.env.EMAIL_USER || 'mehedi.hasantanvir78@gmail.com',
            to: orderData.customer_email,
            subject: `NexKart Invoice - Order #${orderData.order_id}`,
            html: emailTemplate
        });
    } catch (err) {
        console.error("Failed to send invoice email:", err);
    }
}

let temporaryUserData = {};

router.get('/cssignup', (req, res) => {
    res.sendFile(path.join(process.cwd(), 'public', 'users', 'cssignup.html'));
});
router.get('/psrst', (req, res) => {
    res.sendFile(path.join(process.cwd(), 'public', 'users', 'psrst.html'));
});
router.get('/forgot-password', (req, res) => {
    res.sendFile(path.join(process.cwd(), 'public', 'users', 'psrst.html'));
});
router.get('/reset-password', (req, res) => {
    res.sendFile(path.join(process.cwd(), 'public', 'users', 'reset-password.html'));
});
router.get('/cslogin', (req, res) => {
    res.sendFile(path.join(process.cwd(), 'public', 'users', 'cslogin.html'));
});

// ড্যাশবোর্ড রাউট
router.get('/dashboard', async (req, res) => {
    try {
        if (!req.session.visitorId) {
            req.session.visitorId = 'visitor_' + Math.random().toString(36).substring(2, 15) + Date.now().toString(36);
        }
        const visitorId = req.session.visitorId;

        const [existingVisit] = await db.query('SELECT * FROM site_visits WHERE visitor_identifier = ?', [visitorId]);

        if (existingVisit.length > 0) {
            await db.query(
                'UPDATE site_visits SET visit_count = visit_count + 1, last_visited_at = NOW() WHERE visitor_identifier = ?',
                [visitorId]
            );
        } else {
            await db.query(
                'INSERT INTO site_visits (visitor_identifier, visit_count, last_visited_at) VALUES (?, 1, NOW())',
                [visitorId]
            );
        }
    } catch (trackError) {
        console.error("Visit Tracking Error:", trackError);
    }

    res.sendFile(path.join(process.cwd(), 'public', 'users', 'dashboard.html'));
});

router.get('/message-center.html', (req, res) => {
    res.sendFile(path.join(process.cwd(), 'public', 'users', 'message-center.html'));
});

router.get('/My-Coupons.html', (req, res) => {
    res.sendFile(path.join(process.cwd(), 'public', 'users', 'My-Coupons.html'));
});

router.get(['/penalties', '/penalties.html'], (req, res) => {
    res.sendFile(path.join(process.cwd(), 'public', 'users', 'penalties.html'));
});

router.get(['/return-policy', '/return-policy.html'], (req, res) => {
    res.sendFile(path.join(process.cwd(), 'public', 'users', 'return-policy.html'));
});

router.get('/settings', (req, res) => res.sendFile(path.join(process.cwd(), 'public', 'users', 'settings.html')));
router.get('/settings.html', (req, res) => res.sendFile(path.join(process.cwd(), 'public', 'users', 'settings.html')));
router.get('/profile', (req, res) => res.sendFile(path.join(process.cwd(), 'public', 'users', 'profile.html')));
router.get('/profile.html', (req, res) => res.sendFile(path.join(process.cwd(), 'public', 'users', 'profile.html')));
router.get('/product-details', (req, res) => res.sendFile(path.join(process.cwd(), 'public', 'users', 'product-details.html')));
router.get('/product-details.html', (req, res) => res.sendFile(path.join(process.cwd(), 'public', 'users', 'product-details.html')));
router.get('/checkout', (req, res) => res.sendFile(path.join(process.cwd(), 'public', 'users', 'checkout.html')));
router.get('/seller-profile', (req, res) => res.sendFile(path.join(process.cwd(), 'public', 'users', 'seller-profile.html')));
router.get('/cart-html', (req, res) => res.sendFile(path.join(process.cwd(), 'public', 'users', 'cart-html.html')));
router.get('/customer-inbox', (req, res) => res.sendFile(path.join(process.cwd(), 'public', 'users', 'customer-inbox.html')));
router.get('/store/:id', (req, res) => res.sendFile(path.join(process.cwd(), 'public', 'users', 'seller-profile.html')));
router.get('/my-Order', (req, res) => res.sendFile(path.join(process.cwd(), 'public', 'users', 'my-Order.html')));
router.get('/Return-Refund-Requests', (req, res) => res.sendFile(path.join(process.cwd(), 'public', 'users', 'Return-Refund-Requests.html')));

router.get('/ipr-report', (req, res) => res.sendFile(path.join(process.cwd(), 'public', 'users', 'ipr-report.html')));

router.get('/banner-products', async (req, res) => {
    try {
        const query = `
            SELECT p.*, CONCAT('/uploads/', (SELECT image_path FROM product_images WHERE product_id = p.id LIMIT 1)) AS primary_image
            FROM products p ORDER BY RAND() LIMIT 5
        `;
        const [products] = await db.query(query);
        return res.json({ success: true, products: products });
    } catch (error) {
        console.error("Banner Products Error:", error);
        return res.status(500).json({ success: false, message: "Server Error" });
    }
});

router.get('/get-coupons', async (req, res) => {
    try {
        const [coupons] = await db.query('SELECT * FROM coupons WHERE expiry_date >= NOW() ORDER BY id DESC');
        return res.json({ success: true, coupons: coupons });
    } catch (err) {
        console.error("Get Coupons Error:", err);
        return res.status(500).json({ success: false, message: "Server Error" });
    }
});

// ==================== [ AI ASSISTANT API ROUTE ] ====================
router.post('/api/ai-chat', async (req, res) => {
    try {
        const { message, product_id } = req.body;
        if (!message) {
            return res.status(400).json({ success: false, message: 'Message is required!' });
        }

        let productContext = '';
        if (product_id) {
            const [products] = await db.query('SELECT title, description, sale_price, regular_price, category FROM products WHERE id = ? OR product_id = ?', [product_id, product_id]);
            if (products.length > 0) {
                const p = products[0];
                productContext = `Product Context: Name: ${p.title}, Price: ৳${p.sale_price}, Category: ${p.category}, Description: ${p.description}. `;
            }
        }

        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            return res.json({ 
                success: true, 
                reply: "AI Assistant is running in basic mode. How can I help you with NexKart products today?" 
            });
        }

        const promptText = `You are NexKart AI Shopping Assistant. Be helpful, concise, and friendly. ${productContext}User question: ${message}`;
        
        const response = await axios.post(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${apiKey}`,
            {
                contents: [{ parts: [{ text: promptText }] }]
            },
            { headers: { 'Content-Type': 'application/json' } }
        );

        const aiReply = response.data?.candidates?.[0]?.content?.parts?.[0]?.text || "I am currently unable to answer. Please try again.";
        return res.json({ success: true, reply: aiReply });

    } catch (error) {
        console.error("AI Chat Error:", error.message);
        return res.json({ 
            success: true, 
            reply: "Hello! I am your NexKart AI Assistant. Feel free to ask me anything about this product or delivery process!" 
        });
    }
});

// ==================== [ CART ROUTES ] ====================

// ১. কার্টে পণ্য যোগ করা
router.post('/add-to-cart', async (req, res) => {
    try {
        const userId = req.user ? req.user.id : (req.session && req.session.user ? req.session.user.id : (req.session && req.session.userId ? req.session.userId : null));
        
        if (!userId) {
            return res.status(401).json({ success: false, message: 'unauthorized' });
        }

        const { product_id, quantity } = req.body;
        if (!product_id) {
            return res.status(400).json({ success: false, message: 'Product ID is required!' });
        }

        const [products] = await db.query('SELECT id FROM products WHERE id = ? OR product_id = ?', [product_id, product_id]);
        
        if (products.length === 0) {
            return res.status(404).json({ success: false, message: 'Product not found in database!' });
        }

        const actualProductId = products[0].id;
        const qtyToAdd = quantity ? parseInt(quantity) : 1;

        const [existingItem] = await db.query(
            'SELECT * FROM cart WHERE user_id = ? AND product_id = ?',
            [userId, actualProductId]
        );

        if (existingItem.length > 0) {
            await db.query(
                'UPDATE cart SET quantity = quantity + ? WHERE id = ?',
                [qtyToAdd, existingItem[0].id]
            );
        } else {
            await db.query(
                'INSERT INTO cart (user_id, product_id, quantity) VALUES (?, ?, ?)',
                [userId, actualProductId, qtyToAdd]
            );
        }

        return res.json({ success: true, message: 'Product added to cart successfully!' });
    } catch (error) {
        console.error("Add to Cart Error:", error);
        return res.status(500).json({ success: false, message: 'Server Error!' });
    }
});

// ২. ইউজার অনুযায়ী কার্ট কাউন্ট (সংখ্যার হিসাব) ফেরত দেওয়া
router.get('/get-cart-count', async (req, res) => {
    try {
        const userId = req.user ? req.user.id : (req.session && req.session.user ? req.session.user.id : (req.session && req.session.userId ? req.session.userId : null));
        
        if (!userId) {
            return res.json({ success: true, count: 0 });
        }

        const [result] = await db.query(
            'SELECT SUM(quantity) AS total_count FROM cart WHERE user_id = ?',
            [userId]
        );

        const cartCount = result[0].total_count || 0;
        return res.json({ success: true, count: Number(cartCount) });

    } catch (error) {
        console.error("Get Cart Count Error:", error);
        return res.status(500).json({ success: false, message: 'Server Error!' });
    }
});

// ৩. কার্টের সব পণ্য ডাটাবেজ থেকে নিয়ে আসা
router.get('/get-cart-items', async (req, res) => {
    try {
        const userId = req.user ? req.user.id : (req.session && req.session.user ? req.session.user.id : (req.session && req.session.userId ? req.session.userId : null));
        
        if (!userId) {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }

        const query = `
            SELECT c.id AS cart_id, c.quantity, p.id AS product_id, p.product_id AS custom_product_id, 
                   p.title, p.sale_price, p.regular_price, p.stock_quantity,
                   CONCAT('/uploads/', (SELECT image_path FROM product_images WHERE product_id = p.id LIMIT 1)) AS primary_image
            FROM cart c
            JOIN products p ON c.product_id = p.id
            WHERE c.user_id = ?
            ORDER BY c.id DESC
        `;

        const [cartItems] = await db.query(query, [userId]);
        return res.json({ success: true, cart: cartItems });

    } catch (error) {
        console.error("Get Cart Items Error:", error);
        return res.status(500).json({ success: false, message: 'Server Error!' });
    }
});

// ৪. কার্ট থেকে পণ্য রিমুভ করা
router.post('/remove-from-cart', async (req, res) => {
    try {
        const userId = req.user ? req.user.id : (req.session && req.session.user ? req.session.user.id : (req.session && req.session.userId ? req.session.userId : null));
        const { cart_id } = req.body;

        if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized' });

        await db.query('DELETE FROM cart WHERE id = ? AND user_id = ?', [cart_id, userId]);
        return res.json({ success: true, message: 'Item removed from cart!' });

    } catch (error) {
        console.error("Remove Cart Error:", error);
        return res.status(500).json({ success: false, message: 'Server Error!' });
    }
});

// ==================== [ GET PRODUCT REVIEWS ROUTE (UPDATED FOR REPLY) ] ====================
router.get('/reviews/:productId', async (req, res) => {
    try {
        const productId = req.params.productId;

        const [products] = await db.query('SELECT id FROM products WHERE id = ? OR product_id = ?', [productId, productId]);
        if (products.length === 0) {
            return res.status(404).json({ success: false, message: 'প্রোডাক্ট পাওয়া যায়নি!' });
        }

        const actualProductId = products[0].id;

        const reviewsQuery = `
            SELECT 
                r.id, 
                r.rating, 
                r.review_text,
                r.review_reply, 
                r.review_imgUrl, 
                r.created_at,
                u.name AS user_name,
                u.profile_image
            FROM product_reviews r
            JOIN users u ON r.user_id = u.id
            WHERE r.product_id = ? AND (r.status = 'approved' OR r.status = '1' OR r.status IS NULL)
            ORDER BY r.id DESC
        `;

        const [reviews] = await db.query(reviewsQuery, [actualProductId]);

        return res.json({
            success: true,
            reviews: reviews
        });

    } catch (error) {
        console.error("Fetch Reviews Error:", error);
        return res.status(500).json({ success: false, message: "Server Error while fetching reviews" });
    }
});

router.get('/api/seller-data/:id', async (req, res) => {
    try {
        const sellerId = req.params.id;

        const [admins] = await db.query(
            `SELECT id AS seller_id, shop_name AS seller_shop_name, slogan AS seller_slogan, 
             status AS seller_status, picture AS seller_picture, is_verified AS seller_is_verified,
             shop_about 
             FROM admins WHERE id = ?`, 
            [sellerId]
        );

        if (admins.length === 0) {
            return res.status(404).json({ success: false, message: 'Seller not found!' });
        }

        const seller = admins[0];

        const [sellerProducts] = await db.query(
            `SELECT p.*, CONCAT('/uploads/', (SELECT image_path FROM product_images WHERE product_id = p.id LIMIT 1)) AS primary_image
             FROM products p WHERE p.admin_id = ? ORDER BY p.id DESC`, 
            [sellerId]
        );

        return res.json({
            success: true,
            seller: seller,
            seller_products: sellerProducts
        });

    } catch (error) {
        console.error("Seller Profile Fetch Error:", error);
        return res.status(500).json({ success: false, message: 'Server error!' });
    }
});

router.get('/message-center.html', (req, res) => {
    const userId = req.user ? req.user.id : (req.session && req.session.user ? req.session.user.id : (req.session && req.session.userId ? req.session.userId : null));

    if (!userId) {
        req.session.redirectTo = '/user/message-center.html';
        return res.redirect('/user/cslogin');
    }

    res.sendFile(path.join(process.cwd(), 'public', 'users', 'message-center.html'));
});

router.get('/ipr-report.html', (req, res) => {
    const userId = req.user ? req.user.id : (req.session && req.session.user ? req.session.user.id : (req.session && req.session.userId ? req.session.userId : null));

    if (!userId) {
        req.session.redirectTo = '/user/ipr-report.html';
        return res.redirect('/user/cslogin');
    }

    res.sendFile(path.join(process.cwd(), 'public', 'users', 'ipr-report.html'));
});

router.post('/apply-coupon', async (req, res) => {
    try {
        const { coupon_code, product_id } = req.body;
        if (!coupon_code || !product_id) {
            return res.status(400).json({ success: false, message: 'Coupon code and product ID are required!' });
        }

        const [products] = await db.query('SELECT id, product_id FROM products WHERE id = ? OR product_id = ?', [product_id, product_id]);
        if (products.length === 0) {
            return res.status(404).json({ success: false, message: 'Product not found!' });
        }
        
        const actualNumericId = products[0].id;
        const actualStringProductId = products[0].product_id;

        const [coupons] = await db.query(
            'SELECT * FROM coupons WHERE coupon_name = ?',
            [coupon_code]
        );

        if (coupons.length === 0) {
            return res.json({ success: false, message: 'ভুল কুপন কোড!' });
        }

        const coupon = coupons[0];
        const couponProductId = coupon.product_id;
        
        const isGlobalCoupon = !couponProductId || couponProductId === '' || couponProductId == 0;
        const isMatchedWithNumeric = couponProductId == actualNumericId;
        const isMatchedWithString = couponProductId === actualStringProductId;

        if (!isGlobalCoupon && !isMatchedWithNumeric && !isMatchedWithString) {
            return res.json({ 
                success: false, 
                message: 'এই কুপনটি এই প্রোডাক্টের জন্য প্রযোজ্য নয়!' 
            });
        }

        if (coupon.expiry_date) {
            const expiryDate = new Date(coupon.expiry_date);
            const currentDate = new Date();
            if (currentDate > expiryDate) {
                return res.json({ success: false, message: 'এই কুপনটির মেয়াদ শেষ হয়ে গেছে!' });
            }
        }

        return res.json({
            success: true,
            coupon_name: coupon.coupon_name,
            discount_amount: coupon.discount_amount,
            expiry_date: coupon.expiry_date,
            message: 'Coupon applied successfully!'
        });

    } catch (error) {
        console.error("Apply Coupon Error:", error);
        return res.status(500).json({ success: false, message: 'Server error!' });
    }
});

router.post('/forgot-password', async (req, res) => {
    try {
        const { email } = req.body;
        const [users] = await db.query('SELECT * FROM users WHERE email = ?', [email]);
        if (users.length === 0) {
            return res.status(404).json({ message: 'This email is not registered with us!' });
        }
        const user = users[0];
        const resetToken = crypto.randomBytes(32).toString('hex');
        const tokenExpires = new Date(Date.now() + 15 * 60 * 1000); 

        await db.query(
            'UPDATE users SET reset_password_token = ?, reset_password_expires = ? WHERE id = ?',
            [resetToken, tokenExpires, user.id]
        );

        const baseUrl = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
        const resetUrl = `${baseUrl}/user/reset-password/${resetToken}`;

        await transporter.sendMail({
            from: process.env.EMAIL_USER || 'mehedi.hasantanvir78@gmail.com',
            to: email,
            subject: 'NexKart - Password Reset Request',
            html: `
                <h3>Password Reset Request</h3>
                <p>You requested a password reset for your NexKart account.</p>
                <p>Click the link below to set a new password (valid for 15 minutes):</p>
                <a href="${resetUrl}" style="padding: 10px 15px; background-color: #ff4b6e; color: #fff; text-decoration: none; border-radius: 5px;">Reset Password</a>
                <p>If you didn't request this, please ignore this email.</p>
            `
        });
        return res.status(200).json({ message: 'A reset link has been sent to your email!' });
    } catch (err) {
        console.error('Forgot Password Error:', err);
        return res.status(500).json({ message: 'Server error! Failed to send reset link.' });
    }
});

router.get('/reset-password/:token', async (req, res) => {
    try {
        const { token } = req.params;
        const [users] = await db.query(
            'SELECT * FROM users WHERE reset_password_token = ? AND reset_password_expires > NOW()',
            [token]
        );
        if (users.length === 0) {
            return res.send('<h3 style="text-align:center; margin-top:50px; color:red;">Password reset token is invalid or has expired. Please try again.</h3>');
        }
        res.sendFile(path.join(process.cwd(), 'public', 'users', 'reset-password.html'));
    } catch (err) {
        console.error('Reset Page Error:', err);
        res.status(500).send('Server Error!');
    }
});

router.post('/update-password', async (req, res) => {
    try {
        const { token, password } = req.body;
        const [users] = await db.query(
            'SELECT * FROM users WHERE reset_password_token = ? AND reset_password_expires > NOW()',
            [token]
        );
        if (users.length === 0) {
            return res.status(400).json({ message: 'Reset token is invalid or has expired.' });
        }
        const user = users[0];
        const hashedPassword = await bcrypt.hash(password, 10);
        await db.query(
            'UPDATE users SET password = ?, reset_password_token = NULL, reset_password_expires = NULL WHERE id = ?',
            [hashedPassword, user.id]
        );
        return res.status(200).json({ message: 'Password updated successfully!' });
    } catch (err) {
        console.error('Update Password Error:', err);
        return res.status(500).json({ message: 'Server error! Failed to update password.' });
    }
});

router.get('/get-unread-sms-count', async (req, res) => {
    try {
        const userId = req.user ? req.user.id : (req.session && req.session.user ? req.session.user.id : (req.session && req.session.userId ? req.session.userId : null));
        
        if (!userId) {
            return res.json({ success: true, count: 0 });
        }

        const [result] = await db.query(
            `SELECT COUNT(*) AS unread_count 
             FROM seller_messages 
             WHERE customer_id = ? AND sender_type = 'seller' AND status != 'Received'`,
            [userId]
        );

        const unreadCount = result[0].unread_count || 0;
        return res.json({ success: true, count: Number(unreadCount) });

    } catch (error) {
        console.error("Get SMS Count Error:", error);
        return res.status(500).json({ success: false, message: 'Server Error!' });
    }
});

// Google Auth
router.get('/auth/google', passport.authenticate('google-user', { scope: ['profile', 'email'] }));

router.get('/auth/google/callback', 
    passport.authenticate('google-user', { failureRedirect: '/user/cslogin?error=admin_email' }),
    (req, res) => {
        req.logIn(req.user, (err) => {
            if (err) {
                console.error("Google Login Session Error:", err);
                return res.redirect('/user/cslogin');
            }

            if (req.user) {
                req.session.user = { id: req.user.id, user_type: 'user' };
                req.session.userId = req.user.id;
            }
            
            const targetUrl = req.session.redirectTo || '/user/dashboard';
            delete req.session.redirectTo; 
            res.redirect(targetUrl);
        });
    }
);

router.post('/signup', async (req, res) => {
    const { name, email, password, confirm_password } = req.body;
    if (password !== confirm_password) {
        return res.status(400).send("Passwords do not match!");
    }
    try {
        const [adminCheck] = await db.query('SELECT * FROM admins WHERE email = ?', [email]);
        if (adminCheck.length > 0) {
            return res.status(400).send("This email belongs to an Admin! Cannot register as User.");
        }
        const [userCheck] = await db.query('SELECT * FROM users WHERE email = ?', [email]);
        if (userCheck.length > 0) {
            return res.status(400).send("Email already registered! Please login.");
        }
        const hashedPassword = await bcrypt.hash(password, 10);
        const otp_code = Math.floor(100000 + Math.random() * 900000).toString();
        const otp_expires_at = new Date(Date.now() + 5 * 60 * 1000);

        temporaryUserData[email] = { name, email, password: hashedPassword, otp_code, otp_expires_at };
        await transporter.sendMail({
            from: process.env.EMAIL_USER || 'mehedi.hasantanvir78@gmail.com',
            to: email,
            subject: 'NexKart - Verification OTP',
            text: `Your OTP is ${otp_code}. Valid for 5 minutes.`
        });
        res.send("OTP_SENT");
    } catch (err) {
        console.error(err);
        res.status(500).send("Server Error!");
    }
});

router.post('/verify-otp', async (req, res) => {
    const { email, entered_otp } = req.body; 
    const userData = temporaryUserData[email];
    if (!userData || new Date() > new Date(userData.otp_expires_at)) {
        delete temporaryUserData[email];
        return res.status(400).send("OTP has expired or invalid session.");
    }
    if (userData.otp_code !== entered_otp) {
        return res.status(400).send("Invalid OTP!");
    }
    try {
        await db.query(
            'INSERT INTO users (name, email, password, is_verified, created_at) VALUES (?, ?, ?, 1, NOW())',
            [userData.name, userData.email, userData.password]
        );
        delete temporaryUserData[email];
        res.send("SUCCESS");
    } catch (err) {
        console.error(err);
        res.status(500).send("Database Error!");
    }
});

router.post('/login', async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).send("ইমেইল এবং পাসওয়ার্ড দেওয়া বাধ্যতামূলক!");
    }

    try {
        const [adminCheck] = await db.query('SELECT * FROM admins WHERE email = ?', [email]);
        if (adminCheck.length > 0) {
            return res.status(400).send("Admin email cannot be used for user login!");
        }

        const [users] = await db.query('SELECT * FROM users WHERE email = ?', [email]);
        if (users.length === 0) {
            return res.status(400).send("Invalid email or password!");
        }

        const user = users[0];

        if (!user.password || typeof user.password !== 'string') {
            return res.status(400).send("এই ইমেইলটি Google দিয়ে তৈরি করা হয়েছে। অনুগ্রহ করে Google দিয়ে লগইন করুন!");
        }

        const isMatch = await bcrypt.compare(String(password), String(user.password));
        if (!isMatch) {
            return res.status(400).send("Invalid email or password!");
        }

        user.user_type = 'user';

        req.login(user, (err) => {
            if (err) {
                console.error("Passport Login Error:", err);
                return res.status(500).send("Login Session Error!");
            }
            
            req.session.user = { id: user.id, user_type: 'user' }; 
            req.session.userId = user.id; 

            const targetUrl = req.session.redirectTo || '/user/dashboard';
            delete req.session.redirectTo;

            return res.redirect(targetUrl);
        });

    } catch (err) {
        console.error("Login Server Error:", err);
        res.status(500).send("Server Error!");
    }
});

router.get('/get-user-profile', async (req, res) => {
    try {
        const userId = req.user ? req.user.id : (req.session && req.session.user ? req.session.user.id : (req.session && req.session.userId ? req.session.userId : null));
        
        if (!userId) {
            return res.status(401).json({ success: false, message: 'Unauthorized: Please login first!' });
        }

        const [rows] = await db.execute('SELECT * FROM users WHERE id = ?', [userId]);
        if (rows.length > 0) {
            res.json(rows[0]);
        } else {
            res.status(404).json({ success: false, message: 'User not found!' });
        }
    } catch (error) {
        console.error("Get Profile Error:", error);
        res.status(500).json({ success: false, message: 'Server error!' });
    }
});

router.post('/update-profile', upload.single('profile_image'), async (req, res) => {
    try {
        const userId = req.user ? req.user.id : (req.session && req.session.user ? req.session.user.id : (req.session && req.session.userId ? req.session.userId : null));
        
        if (!userId) {
            return res.status(401).json({ success: false, message: 'Unauthorized: Please login first!' });
        }

        const { 
            name, phone_number, division, district, 
            upazilla, union_area, post_code, block_house 
        } = req.body;

        let profileImageQuery = "";
        let queryParams = [
            name, phone_number, division, district, 
            upazilla, union_area, post_code, block_house
        ];

        if (req.file) {
            const profileImageUrl = `/uploads/${req.file.filename}`;
            profileImageQuery = ", profile_image = ?";
            queryParams.push(profileImageUrl);
        }

        queryParams.push(userId);

        const sql = `UPDATE users SET 
            name = ?, phone_number = ?, division = ?, district = ?, 
            upazilla = ?, union_area = ?, post_code = ?, block_house = ? 
            ${profileImageQuery} 
            WHERE id = ?`;

        await db.execute(sql, queryParams);
        res.json({ success: true, message: 'Profile updated successfully!' });
    } catch (error) {
        console.error("Update Profile Error:", error);
        res.status(500).json({ success: false, message: 'Server error during update!' });
    }
});

// ==================== [PLACE ORDER ROUTE WITH STOCK VALIDATION & UPDATE] ====================
router.post('/place-order', async (req, res) => {
    try {
        const userId = req.user ? req.user.id : (req.session && req.session.user ? req.session.user.id : (req.session && req.session.userId ? req.session.userId : null));
        
        if (!userId) {
            return res.status(401).json({ success: false, message: 'Unauthorized: Please login first!' });
        }

        const { 
            product_id, quantity, variant, payment_method, selected_gateway, 
            name, email, phone, division, district, upazilla, union_area, post_code, block_house, 
            discount_amount 
        } = req.body;

        if (!product_id || !quantity || !name || !phone || !district || !block_house) {
            return res.status(400).json({ success: false, message: 'প্রয়োজনীয় অর্ডারের তথ্য অনুপস্থিত!' });
        }

        const orderQty = parseInt(quantity, 10) || 1;

        const [products] = await db.query('SELECT * FROM products WHERE id = ? OR product_id = ?', [product_id, product_id]);
        
        if (!products || products.length === 0) {
            return res.status(404).json({ success: false, message: 'প্রোডাক্ট পাওয়া যায়নি!' });
        }

        const product = products[0];
        const currentStock = parseInt(product.stock_quantity, 10) || 0;

        if (currentStock <= 0) {
            return res.status(400).json({ 
                success: false, 
                message: 'দুঃখিত, প্রোডাক্টটি স্টক আউট (Out of Stock) হয়ে গেছে!' 
            });
        }

        if (currentStock < orderQty) {
            return res.status(400).json({ 
                success: false, 
                message: `দুঃখিত, পর্যাপ্ত স্টক নেই! বর্তমানে মাত্র ${currentStock} টি স্টক আছে।` 
            });
        }

        const seller_id = product.admin_id || 0;
        const salePrice = parseFloat(product.sale_price || 0);
        let baseDeliveryCharge = Number(product.delivery_charge) || 60;
        const deliveryLimit = Number(product.delivery_limit) || 1;

        if (Number(product.free_shipping) === 1) {
            baseDeliveryCharge = 0;
        }

        let deliveryCharge = baseDeliveryCharge;
        if (deliveryLimit > 0 && baseDeliveryCharge > 0) {
            const multiplier = Math.ceil(orderQty / deliveryLimit);
            deliveryCharge = baseDeliveryCharge * multiplier;
        }

        const subtotal = salePrice * orderQty;
        const appliedDiscount = parseFloat(discount_amount || 0);
        const totalAmount = Math.max(0, subtotal - appliedDiscount) + deliveryCharge;
        
        const fullShippingAddress = [block_house, union_area, upazilla, district, division, post_code ? `Post Code: ${post_code}` : ''].filter(Boolean).join(', ');
        const orderId = 'NXK-' + Date.now().toString().slice(-8) + Math.floor(100 + Math.random() * 900);
        const gatewayUsed = payment_method === 'online' ? (selected_gateway || 'bkash') : null;
        const paymentStatus = payment_method === 'online' ? 'Pending Payment' : 'Pending';

        const insertQuery = `
            INSERT INTO orders (
                order_id, user_id, product_id, seller_id, quantity, variant, 
                subtotal_price, delivery_charge, total_amount, payment_method, 
                selected_gateway, payment_status, customer_name, customer_email, 
                customer_phone, shipping_address, created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
        `;

        await db.query(insertQuery, [
            orderId, userId, product.id, seller_id, orderQty, variant || null,
            subtotal, deliveryCharge, totalAmount, payment_method, gatewayUsed,
            paymentStatus, name, email, phone, fullShippingAddress
        ]);

        const currentSoldQty = parseInt(product.sold_qty, 10) || 0;
        const newStock = Math.max(0, currentStock - orderQty);
        const newSoldQty = currentSoldQty + orderQty;
        const newStockStatus = newStock === 0 ? 'out_of_stock' : 'in_stock';

        await db.query(
            `UPDATE products SET stock_quantity = ?, sold_qty = ?, stock_status = ? WHERE id = ?`,
            [newStock, newSoldQty, newStockStatus, product.id]
        );

        if (payment_method === 'online') {
            const baseUrl = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
            const callbackUrl = `${baseUrl}/user/bdgate/callback?order_id=${orderId}`;

            const bdgatePayload = {
                amount: totalAmount.toFixed(2),
                order_id: orderId,
                redirect_url: callbackUrl,
                success_url: callbackUrl,
                callback_url: callbackUrl,
                cancel_url: `${baseUrl}/user/checkout?status=cancel`,
                fail_url: `${baseUrl}/user/checkout?status=fail`,
                customer_name: name,
                customer_email: email || 'customer@example.com',
                customer_phone: phone,
                description: `Order #${orderId} on NexKart`,
                currency: "BDT"
            };

            try {
                const response = await axios.post('https://api.bdgate.net/api/v1/checkout', bdgatePayload, {
                    headers: {
                        'Content-Type': 'application/json',
                        'X-API-Key': process.env.BDGATE_API_KEY || 'bd_live_40d9307632248d56aabb35758971e9b9'
                    }
                });

                if (response.data && response.data.checkout_url) {
                    return res.json({
                        success: true,
                        order_id: orderId,
                        selected_gateway: gatewayUsed ? gatewayUsed.toUpperCase() : 'ONLINE',
                        payment_url: response.data.checkout_url
                    });
                }
            } catch (apiError) {
                console.error("BDGate Error:", apiError.message);
            }
        }

        return res.json({ success: true, order_id: orderId, message: 'Order placed successfully!' });

    } catch (error) {
        console.error("Place Order Error:", error);
        return res.status(500).json({ success: false, message: 'Server Error during order placement!' });
    }
});

// ONLINE PAYMENT CALLBACK
router.get('/bdgate/callback', async (req, res) => {
    try {
        const { order_id } = req.query;
        const baseUrl = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
        
        if (order_id) {
            const [orders] = await db.query('SELECT * FROM orders WHERE order_id = ?', [order_id]);
            
            if (orders && orders.length > 0) {
                const order = orders[0];
                
                if (order.payment_status !== 'complete') {
                    await db.query('UPDATE orders SET payment_status = ? WHERE order_id = ?', ['complete', order_id]);
                    
                    const soldQuantity = parseInt(order.quantity, 10) || 1;

                    const [products] = await db.query('SELECT stock_quantity, sold_qty FROM products WHERE id = ?', [order.product_id]);
                    
                    if (products && products.length > 0) {
                        const prod = products[0];
                        const currentStock = parseInt(prod.stock_quantity, 10) || 0;
                        const currentSold = parseInt(prod.sold_qty, 10) || 0;

                        const newStock = Math.max(0, currentStock - soldQuantity);
                        const newSold = currentSold + soldQuantity;

                        await db.query(
                            `UPDATE products SET stock_quantity = ?, sold_qty = ? WHERE id = ?`,
                            [newStock, newSold, order.product_id]
                        );
                    }
                }
            }
        }

        return res.redirect(`${baseUrl}/user/dashboard`);
    } catch (error) {
        console.error("Callback Error:", error);
        const baseUrl = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
        return res.redirect(`${baseUrl}/user/dashboard`);
    }
});

router.get('/bdgate-success', async (req, res) => {
    res.redirect('/user/dashboard');
});

// Inquiry Routes
router.post('/inquiry', async (req, res) => {
    try {
        const { product_id, question, user_name } = req.body;
        if (!product_id || !question) {
            return res.status(400).json({ success: false, message: 'Product ID and Question are required!' });
        }

        const [products] = await db.query('SELECT id FROM products WHERE id = ? OR product_id = ?', [product_id, product_id]);
        if (products.length === 0) {
            return res.status(404).json({ success: false, message: 'Product not found!' });
        }
        
        const actualProductId = products[0].id;
        const userNameToSave = user_name || (req.user ? req.user.name : 'Valued Customer');

        await db.query(
            'INSERT INTO product_inquiries (product_id, question, user_name, created_at) VALUES (?, ?, ?, NOW())',
            [actualProductId, question, userNameToSave]
        );

        return res.json({ success: true, message: 'Inquiry submitted successfully!' });
    } catch (error) {
        console.error("Inquiry Submit Error:", error);
        return res.status(500).json({ success: false, message: 'Server error while submitting inquiry!' });
    }
});

router.get('/inquiries/:productId', async (req, res) => {
    try {
        const productId = req.params.productId;
        const [products] = await db.query('SELECT id FROM products WHERE id = ? OR product_id = ?', [productId, productId]);
        if (products.length === 0) {
            return res.status(404).json({ success: false, message: 'Product not found!' });
        }

        const actualProductId = products[0].id;
        const [inquiries] = await db.query('SELECT * FROM product_inquiries WHERE product_id = ? ORDER BY id DESC', [actualProductId]);
        return res.json({ success: true, inquiries: inquiries });
    } catch (error) {
        console.error("Inquiry Fetch Error:", error);
        return res.status(500).json({ success: false, message: 'Server error while fetching inquiries!' });
    }
});

router.get('/product/:id', async (req, res) => {
    try {
        const productId = req.params.id;
        const productQuery = `
            SELECT p.*, a.id AS seller_id, a.picture AS seller_picture, a.shop_name AS seller_shop_name,
                   a.slogan AS seller_slogan, a.is_verified AS seller_is_verified, a.status AS seller_status
            FROM products p LEFT JOIN admins a ON p.admin_id = a.id
            WHERE p.product_id = ? OR p.id = ?
        `;
        const [products] = await db.query(productQuery, [productId, productId]);
        if (products.length === 0) {
            return res.status(404).json({ success: false, message: 'প্রোডাক্ট পাওয়া যায়নি!' });
        }
        const product = products[0];
        const [images] = await db.query(`SELECT image_path FROM product_images WHERE product_id = ?`, [product.id]);

        const [sellerProducts] = await db.query(`
            SELECT p.id, p.product_id, p.title, p.sale_price, p.regular_price, p.category,
                   CONCAT('/uploads/', (SELECT image_path FROM product_images WHERE product_id = p.id LIMIT 1)) AS primary_image,
                   COALESCE(AVG(r.rating), 0) AS avg_rating,
                   COUNT(r.id) AS review_count
            FROM products p 
            LEFT JOIN product_reviews r ON p.id = r.product_id AND (r.status = 'approved' OR r.status = '1' OR r.status IS NULL)
            WHERE p.admin_id = ? AND p.id != ? 
            GROUP BY p.id
            ORDER BY p.id DESC LIMIT 6
        `, [product.admin_id, product.id]);

        const [suggestedProducts] = await db.query(`
            SELECT p.id, p.product_id, p.title, p.sale_price, p.regular_price, p.category,
                   CONCAT('/uploads/', (SELECT image_path FROM product_images WHERE product_id = p.id LIMIT 1)) AS primary_image,
                   COALESCE(AVG(r.rating), 0) AS avg_rating,
                   COUNT(r.id) AS review_count
            FROM products p 
            LEFT JOIN product_reviews r ON p.id = r.product_id AND (r.status = 'approved' OR r.status = '1' OR r.status IS NULL)
            WHERE p.category = ? AND p.id != ? 
            GROUP BY p.id
            ORDER BY RAND() LIMIT 6
        `, [product.category, product.id]);

        return res.json({
            success: true,
            product: product,
            gallery_images: images.map(img => img.image_path),
            seller_products: sellerProducts,
            suggested_products: suggestedProducts
        });
    } catch (error) {
        console.error("Product Details Fetch Error:", error);
        return res.status(500).json({ success: false, message: "Server Error" });
    }
});

router.get('/current_user', (req, res) => {
    if (req.isAuthenticated && req.isAuthenticated()) {
        return res.json(req.user);
    } 
    else if (req.session && req.session.user) {
        return res.json(req.session.user);
    } 
    else if (req.session && req.session.userId) {
        return res.json({ id: req.session.userId, user_type: 'user' });
    }
    else {
        return res.status(401).json({ message: 'Not logged in' });
    }
});
router.post('/modal-login', async (req, res) => {
    const { email, password } = req.body;

    try {
        const [users] = await db.query('SELECT * FROM users WHERE email = ?', [email]);
        
        if (users.length === 0) {
            return res.json({ success: false, message: 'Invalid email or password!' });
        }

        const user = users[0];
        const isMatch = await bcrypt.compare(String(password), String(user.password));
        
        if (!isMatch) {
            return res.json({ success: false, message: 'Invalid email or password!' });
        }

        req.login(user, (err) => {
            if (err) {
                return res.json({ success: false, message: 'Session login failed!' });
            }

            req.session.user = { id: user.id, email: user.email, user_type: 'user' };

            // কোন রিডাইরেক্ট ইউআরএল না পাঠিয়ে শুধু সাফল্য নিশ্চিত করুন
            return res.json({ 
                success: true, 
                message: 'Login successful!'
            });
        });

    } catch (err) {
        console.error('Modal Login Error:', err);
        res.status(500).json({ success: false, message: 'Server error!' });
    }
});
router.post('/save-redirect-url', (req, res) => {
    if (req.body.redirectTo) {
        req.session.redirectTo = req.body.redirectTo;
    }
    res.json({ success: true });
});

router.get('/logout', (req, res, next) => {
    req.logout(function(err) {
        if (err) { return next(err); }
        req.session.destroy(() => {
            res.redirect('/user/cslogin');
        });
    });
});

// HTML পেজ সার্ভ করার জন্য রাউট
router.get('/category.html', (req, res) => {
    res.sendFile(path.join(process.cwd(), 'public', 'users', 'category.html'));
});

// ==================== [ DASHBOARD PRODUCTS API WITH SAFE RANDOM OFFSET ] ====================
router.get('/dashProduct', async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 8;

        const [totalCountResult] = await db.query('SELECT COUNT(*) AS total FROM products');
        const totalProducts = totalCountResult[0].total;

        const maxOffset = Math.max(0, totalProducts - limit);
        const randomOffset = page === 1 ? Math.floor(Math.random() * (maxOffset + 1)) : (parseInt(req.query.offset) || 0);
        const offset = Math.min(randomOffset, maxOffset);

        const query = `
            SELECT p.*, 
                   CONCAT('/uploads/', (SELECT image_path FROM product_images WHERE product_id = p.id LIMIT 1)) AS primary_image,
                   COALESCE(AVG(r.rating), 0) AS avg_rating,
                   COUNT(r.id) AS review_count
            FROM products p
            LEFT JOIN product_reviews r ON p.id = r.product_id AND (r.status = 'approved' OR r.status = '1' OR r.status IS NULL)
            GROUP BY p.id
            LIMIT ? OFFSET ?
        `;

        const [products] = await db.query(query, [limit, offset]);
        const hasMore = (offset + products.length) < totalProducts;

        return res.json({ 
            success: true, 
            count: products.length, 
            products: products,
            hasMore: hasMore
        });
    } catch (error) {
        console.error("Dashboard Product Load Error:", error);
        return res.status(500).json({ success: false, message: "Server Error" });
    }
});

// ==================== [ CATEGORY PRODUCTS API WITH PAGINATION & SEARCH ] ====================
router.get('/get-products-by-category', async (req, res) => {
    try {
        const { cat, type, promo, search } = req.query;
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 8;
        const offset = (page - 1) * limit;

        let whereClause = "WHERE 1=1";
        let queryParams = [];

        if (search && search.trim() !== "") {
            whereClause += " AND (p.title LIKE ? OR p.category LIKE ?)";
            queryParams.push(`%${search.trim()}%`, `%${search.trim()}%`);
        } else if (cat && cat !== 'all') {
            whereClause += " AND p.category = ?";
            queryParams.push(cat);
        } else if (type && type !== 'all') {
            whereClause += " AND p.category = ?";
            queryParams.push(type);
        }

        if (promo) {
            if (promo === 'super_deal') {
                whereClause += " AND (p.promo_badge = 'super_deal' OR p.promo_badge = 'super_deals')";
            } else if (promo === 'new_arrival') {
                whereClause += " AND p.promo_badge = 'new_arrival'";
            } else if (promo === 'hot') {
                whereClause += " AND p.promo_badge = 'hot'";
            } else if (promo === 'best_seller') {
                whereClause += " AND p.promo_badge = 'best_seller'";
            } else if (promo === 'free_shipping') {
                whereClause += " AND (p.free_shipping = 1 OR p.promo_badge = 'free_shipping')";
            } else if (promo === 'clearance') {
                whereClause += " AND p.promo_badge = 'clearance'";
            } else if (promo === 'trending') {
                whereClause += " AND p.promo_badge = 'trending'";
            }
        }

        const countQuery = `SELECT COUNT(DISTINCT p.id) AS total FROM products p ${whereClause}`;
        const [totalRows] = await db.query(countQuery, queryParams);
        const totalItems = totalRows[0].total;

        const mainQuery = `
            SELECT p.*, 
                   CONCAT('/uploads/', (SELECT image_path FROM product_images WHERE product_id = p.id LIMIT 1)) AS primary_image,
                   COALESCE(AVG(r.rating), 0) AS avg_rating,
                   COUNT(r.id) AS review_count
            FROM products p
            LEFT JOIN product_reviews r ON p.id = r.product_id AND (r.status = 'approved' OR r.status = '1' OR r.status IS NULL)
            ${whereClause}
            GROUP BY p.id
            ORDER BY p.id DESC
            LIMIT ? OFFSET ?
        `;

        const [products] = await db.query(mainQuery, [...queryParams, limit, offset]);
        const hasMore = (offset + products.length) < totalItems;

        return res.json({
            success: true,
            products: products,
            hasMore: hasMore
        });

    } catch (error) {
        console.error("Get Category Products Error:", error);
        return res.status(500).json({ success: false, message: "Server Error" });
    }
});


module.exports = router;
