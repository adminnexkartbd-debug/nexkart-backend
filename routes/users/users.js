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
const formData = require('form-data');
const Mailjet = require('node-mailjet');

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'public/uploads/');
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + path.extname(file.originalname));
    }
});
const upload = multer({ storage: storage });

// ==================== [ TRACKING HELPERS (GA4 & FB CAPI) ] ====================
const TRACKING_CONFIG = {
    FB_PIXEL_ID: process.env.FACEBOOK_PIXEL_ID,
    FB_ACCESS_TOKEN: process.env.FACEBOOK_ACCESS_TOKEN,
    GA4_MEASUREMENT_ID: process.env.GA4_MEASUREMENT_ID,
    GA4_API_SECRET: process.env.GA4_API_SECRET
};

async function sendFacebookCAPI(eventName, userData, customData) {
    if (!TRACKING_CONFIG.FB_PIXEL_ID || !TRACKING_CONFIG.FB_ACCESS_TOKEN) return;
    try {
        await axios.post(`https://graph.facebook.com/v18.0/${TRACKING_CONFIG.FB_PIXEL_ID}/events`, {
            data: [{
                event_name: eventName,
                event_time: Math.floor(Date.now() / 1000),
                action_source: 'website',
                user_data: {
                    em: userData.email ? crypto.createHash('sha256').update(userData.email.trim().toLowerCase()).digest('hex') : undefined,
                    ph: userData.phone ? crypto.createHash('sha256').update(userData.phone.trim()).digest('hex') : undefined,
                    fn: userData.name ? crypto.createHash('sha256').update(userData.name.trim().toLowerCase()).digest('hex') : undefined,
                    client_ip_address: userData.client_ip_address,
                    client_user_agent: userData.client_user_agent
                },
                custom_data: customData
            }],
            access_token: TRACKING_CONFIG.FB_ACCESS_TOKEN
        });
    } catch (err) {
        console.error("Facebook CAPI Error:", err.response?.data || err.message);
    }
}

async function sendGA4Measurement(eventName, clientId, payloadData) {
    if (!TRACKING_CONFIG.GA4_MEASUREMENT_ID || !TRACKING_CONFIG.GA4_API_SECRET) return;
    try {
        await axios.post(`https://www.google-analytics.com/mp/collect?measurement_id=${TRACKING_CONFIG.GA4_MEASUREMENT_ID}&api_secret=${TRACKING_CONFIG.GA4_API_SECRET}`, {
            client_id: clientId || 'anonymous',
            events: [{
                name: eventName,
                params: payloadData
            }]
        });
    } catch (err) {
        console.error("GA4 Measurement Protocol Error:", err.response?.data || err.message);
    }
}

// 1. NORMAL GOOGLE STRATEGY (cslogin er jonno)
passport.use('google-user', new GoogleStrategy({
    clientID: process.env.GOOGLE_USER_CLIENT_ID,
    clientSecret: process.env.GOOGLE_USER_CLIENT_SECRET,
    callbackURL: process.env.GOOGLE_USER_CALLBACK_URL,
    proxy: true 
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

// 2. ALADA POPUP GOOGLE STRATEGY (Product Details Modal Popup er jonno)
passport.use('google-popup', new GoogleStrategy({
    clientID: process.env.GOOGLE_USER_CLIENT_ID,
    clientSecret: process.env.GOOGLE_USER_CLIENT_SECRET,
    callbackURL: process.env.GOOGLE_USER_POPUP_CALLBACK_URL || 'https://www.nexkartbd.com/user/auth/google/popup/callback',
    proxy: true 
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
        console.error("Google Popup Auth Error:", err);
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
                        <td style="padding: 8px; border: 1px solid #ddd; text-transform: uppercase;">${orderData.payment_method}${orderData.selected_gateway ? '(' + orderData.selected_gateway + ')' : ''}</td>
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
                                ${productTitle}${orderData.variant ? `<br><small style="color: #777;">Variant: ${orderData.variant}</small>` : ''}
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
            from: process.env.EMAIL_USER || 'admin.nexkartbd@gmail.com',
            to: orderData.customer_email,
            subject: `NexKart Invoice - Order #${orderData.order_id}`,
            html: emailTemplate
        });
    } catch (err) {
        console.error("Failed to send invoice email:", err);
    }
}


// ==================== [ BKASH + COMMISSION HELPERS ] ====================
const BKASH_CONFIG = {
    APP_KEY: process.env.BKASH_APP_KEY,
    APP_SECRET: process.env.BKASH_APP_SECRET,
    USERNAME: process.env.BKASH_USERNAME,
    PASSWORD: process.env.BKASH_PASSWORD,
    BASE_URL: process.env.BKASH_BASE_URL,
    CALLBACK_URL: process.env.BKASH_CALLBACK_URL,
    RETURN_URL: process.env.BKASH_RETURN_URL
};

let bkashTokenCache = {
    token: null,
    expiresAt: 0
};

function getBkashBaseUrl() {
    return String(BKASH_CONFIG.BASE_URL || '').trim().replace(/\/$/, '');
}

function bkashUrl(endpoint) {
    const base = getBkashBaseUrl();
    const normalized = String(endpoint || '').replace(/^\//, '');
    if (!base) return '';
    if (/\/tokenized\/checkout$/i.test(base)) {
        const map = {
            'checkout/token/grant': 'token/grant',
            'checkout/payment/create': 'create',
            'checkout/payment/execute': 'execute',
            'checkout/payment/status': 'payment/status'
        };
        return `${base}/${map[normalized] || normalized}`;
    }
    return `${base}/${normalized}`;
}

async function getBkashToken() {
    if (!BKASH_CONFIG.APP_KEY || !BKASH_CONFIG.APP_SECRET || !BKASH_CONFIG.USERNAME || !BKASH_CONFIG.PASSWORD || !getBkashBaseUrl()) {
        throw new Error('bKash environment variables are not configured correctly.');
    }

    if (bkashTokenCache.token && Date.now() < bkashTokenCache.expiresAt) {
        return bkashTokenCache.token;
    }

    const response = await axios.post(
        bkashUrl('checkout/token/grant'),
        {
            app_key: BKASH_CONFIG.APP_KEY,
            app_secret: BKASH_CONFIG.APP_SECRET
        },
        {
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                username: BKASH_CONFIG.USERNAME,
                password: BKASH_CONFIG.PASSWORD
            },
            timeout: 30000
        }
    );

    const token = response.data?.id_token;
    if (!token) {
        throw new Error(`bKash token error: ${response.data?.statusMessage || 'No id_token returned'}`);
    }

    const expiresIn = Number(response.data?.expires_in || 3600);
    bkashTokenCache = {
        token,
        expiresAt: Date.now() + Math.max(60, expiresIn - 60) * 1000
    };

    return token;
}

async function createBkashPayment({ orderId, amount, payerReference }) {
    const token = await getBkashToken();
    const callbackURL = BKASH_CONFIG.CALLBACK_URL || `${process.env.APP_URL || 'http://localhost:3000'}/user/bkash/callback`;

    const response = await axios.post(
        bkashUrl('checkout/payment/create'),
        {
            mode: '0011',
            payerReference: String(payerReference || orderId),
            callbackURL,
            amount: Number(amount).toFixed(2),
            currency: 'BDT',
            intent: 'sale',
            merchantInvoiceNumber: String(orderId)
        },
        {
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                Authorization: `Bearer ${token}`,
                'X-App-Key': BKASH_CONFIG.APP_KEY
            },
            timeout: 30000
        }
    );

    if (!response.data?.paymentID || !response.data?.bkashURL) {
        throw new Error(`bKash create payment failed: ${response.data?.statusMessage || 'Invalid create-payment response'}`);
    }

    return response.data;
}

async function executeBkashPayment(paymentID) {
    const token = await getBkashToken();

    const response = await axios.post(
        bkashUrl('checkout/payment/execute'),
        { paymentID },
        {
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                Authorization: `Bearer ${token}`,
                'X-App-Key': BKASH_CONFIG.APP_KEY
            },
            timeout: 30000
        }
    );

    return response.data;
}

async function queryBkashPayment(paymentID) {
    const token = await getBkashToken();

    const response = await axios.post(
        bkashUrl('checkout/payment/status'),
        { paymentID },
        {
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                Authorization: `Bearer ${token}`,
                'X-App-Key': BKASH_CONFIG.APP_KEY
            },
            timeout: 30000
        }
    );

    return response.data;
}

async function hasTableColumn(tableName, columnName) {
    const [rows] = await db.query(
        `SELECT COUNT(*) AS cnt
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
        [tableName, columnName]
    );
    return Number(rows[0]?.cnt || 0) > 0;
}

async function getCommissionRate() {
    // Commission rate is NEVER hardcoded. It always comes from the `commission` table.
    const [rows] = await db.query(
        'SELECT commission_rate FROM commission ORDER BY id DESC LIMIT 1'
    );

    if (!rows.length) {
        throw new Error('Commission rate not configured: table `commission` has no rows.');
    }

    const rate = Number(rows[0].commission_rate);
    if (!Number.isFinite(rate) || rate < 0) {
        throw new Error('Invalid commission_rate in table `commission`.');
    }

    return rate;
}

async function recordOrderCommission({ orderId, sellerId, subtotal, paymentType }) {
    // Rate comes from `commission`; calculated result is stored in `commission_table`.
    const commissionRate = await getCommissionRate();
    // Commission is calculated ONLY from product subtotal. Delivery is excluded.
    const commissionAmount = Math.max(0, (Number(subtotal) * commissionRate) / 100);
    const hasPaymentType = await hasTableColumn('commission_table', 'payment_type');

    const [existing] = await db.query(
        'SELECT id FROM commission_table WHERE order_number = ? LIMIT 1',
        [orderId]
    );

    if (existing.length > 0) {
        if (hasPaymentType) {
            await db.query(
                `UPDATE commission_table
                 SET commission_rate = ?, commission_amount = ?, seller_id = ?, payment_type = ?
                 WHERE order_number = ?`,
                [commissionRate, commissionAmount, sellerId, paymentType, orderId]
            );
        } else {
            // Old commission_table schema: do not reference payment_type until migration is run.
            await db.query(
                `UPDATE commission_table
                 SET commission_rate = ?, commission_amount = ?, seller_id = ?
                 WHERE order_number = ?`,
                [commissionRate, commissionAmount, sellerId, orderId]
            );
        }
        return { commissionRate, commissionAmount };
    }

    if (hasPaymentType) {
        await db.query(
            `INSERT INTO commission_table
                (order_number, commission_rate, commission_amount, seller_id, payment_type, date)
             VALUES (?, ?, ?, ?, ?, NOW())`,
            [orderId, commissionRate, commissionAmount, sellerId, paymentType]
        );
    } else {
        await db.query(
            `INSERT INTO commission_table
                (order_number, commission_rate, commission_amount, seller_id, date)
             VALUES (?, ?, ?, ?, NOW())`,
            [orderId, commissionRate, commissionAmount, sellerId]
        );
    }

    return { commissionRate, commissionAmount };
}

// Returns the user's currently available coins from the ledger.
// Positive coin grants are counted only while their expiry date is still valid.
// Negative usage rows are always counted so previous spending is not added back.
async function getAvailableCoins(userId) {
    if (!userId) return 0;

    const [rows] = await db.query(
        `SELECT
            COALESCE(SUM(CASE
                WHEN coin_balance > 0
                     AND (coin_expire >= CURDATE() OR coin_expire IS NULL)
                THEN coin_balance ELSE 0 END), 0) AS valid_earned_coins,
            COALESCE(SUM(CASE
                WHEN coin_balance < 0 THEN coin_balance ELSE 0 END), 0) AS used_coins
         FROM my_coins
         WHERE user_id = ?`,
        [userId]
    );

    const earned = Number(rows[0]?.valid_earned_coins || 0);
    const used = Number(rows[0]?.used_coins || 0);
    return Math.max(0, Math.floor(earned + used));
}

// Coin usage is recorded as a separate negative ledger row in my_coins.
// Example: using 20 coins creates coin_balance = -20.
// The source is stored as readable text so the reason for the deduction is clear.
async function recordCoinUsage({ userId, orderId, coinDiscount }) {
    const discount = Number(coinDiscount || 0);
    if (!userId || discount <= 0) return 0;

    const coinValue = 0.30;
    const coinsUsed = Math.max(0, Math.round(discount / coinValue));
    if (!coinsUsed) return 0;

    const source = `Coin Discount - Order ${orderId}`;

    // Prevent duplicate deduction when a bKash callback/retry runs again.
    const [existing] = await db.query(
        `SELECT id FROM my_coins
         WHERE user_id = ? AND coin_source = ? AND coin_balance = ?
         LIMIT 1`,
        [userId, source, -coinsUsed]
    );

    if (existing.length) return coinsUsed;

    // Only non-expired positive coin grants are available.
    // Previous negative ledger entries are subtracted from that pool.
    const availableCoins = await getAvailableCoins(userId);

    if (availableCoins < coinsUsed) {
        throw new Error(
            `Not enough coins to complete order. Required: ${coinsUsed}, available: ${availableCoins}.`
        );
    }

    // Negative ledger row: coin_expire is NULL because this row represents usage,
    // not a new coin grant. It remains part of the user's ledger permanently.
    await db.query(
        `INSERT INTO my_coins (user_id, coin_balance, coin_expire, coin_source)
         VALUES (?, ?, NULL, ?)`,
        [userId, -coinsUsed, source]
    );

    return coinsUsed;
}

// Prevent duplicate finalization when bKash sends/retries the callback more than once.
// The database row check below is the permanent idempotency guard; this Set also
// blocks two callbacks arriving at the same Node.js process at the same time.
const orderFinalizationLocks = new Set();

async function finalizeSuccessfulOrder(order, paymentType, paymentInfo = {}) {
    if (!order || !order.order_id) throw new Error('Invalid order for finalization.');

    const lockKey = String(order.order_id);
    if (orderFinalizationLocks.has(lockKey)) {
        throw new Error(`Order ${lockKey} is already being finalized. Please wait for the payment callback to complete.`);
    }
    orderFinalizationLocks.add(lockKey);

    try {
        // Permanent database-level idempotency check: one order gets one commission row.
        const [alreadyFinalized] = await db.query(
            'SELECT id, commission_rate, commission_amount FROM commission_table WHERE order_number = ? LIMIT 1',
            [order.order_id]
        );

        if (alreadyFinalized.length > 0) {
            if (paymentType === 'paid') {
                const hasBkashPaymentId = await hasTableColumn('orders', 'bkash_payment_id');
                const hasBkashTrxId = await hasTableColumn('orders', 'bkash_trx_id');
                const hasPaymentCompletedAt = await hasTableColumn('orders', 'payment_completed_at');
                if (hasBkashPaymentId && hasBkashTrxId && hasPaymentCompletedAt) {
                    await db.query(
                        `UPDATE orders
                         SET payment_status = ?,
                             bkash_payment_id = COALESCE(?, bkash_payment_id),
                             bkash_trx_id = COALESCE(?, bkash_trx_id),
                             payment_completed_at = NOW()
                         WHERE order_id = ?`,
                        ['complete', paymentInfo.paymentID || null, paymentInfo.trxID || null, order.order_id]
                    );
                } else {
                    await db.query('UPDATE orders SET payment_status = ? WHERE order_id = ?', ['complete', order.order_id]);
                }
            }
            return {
                commissionRate: Number(alreadyFinalized[0].commission_rate || 0),
                commissionAmount: Number(alreadyFinalized[0].commission_amount || 0),
                alreadyFinalized: true
            };
        }

        const [freshProducts] = await db.query(
        'SELECT * FROM products WHERE id = ? LIMIT 1',
        [order.product_id]
    );

    if (!freshProducts.length) {
        throw new Error('Product not found while finalizing order.');
    }

    const product = freshProducts[0];
    const currentStock = parseInt(product.stock_quantity, 10) || 0;
    const orderQty = parseInt(order.quantity, 10) || 0;

    if (currentStock < orderQty) {
        throw new Error(`Insufficient stock while finalizing order ${order.order_id}.`);
    }

    const newStock = currentStock - orderQty;
    const newSoldQty = (parseInt(product.sold_qty, 10) || 0) + orderQty;
    const newStockStatus = newStock === 0 ? 'out_of_stock' : 'in_stock';

    await db.query(
        `UPDATE products
         SET stock_quantity = ?, sold_qty = ?, stock_status = ?
         WHERE id = ?`,
        [newStock, newSoldQty, newStockStatus, order.product_id]
    );

    const commission = await recordOrderCommission({
        orderId: order.order_id,
        sellerId: order.seller_id,
        subtotal: order.subtotal_price,
        paymentType
    });

    // Coins are consumed only after the order is finalized.
    // For COD this happens immediately; for bKash it happens only after successful payment.
    await recordCoinUsage({
        userId: order.user_id,
        orderId: order.order_id,
        coinDiscount: order.coin_discount
    });

    // COD should not depend on bKash-specific columns. Only successful online
    // payments need the bKash payment/trx fields updated.
    if (paymentType === 'paid') {
        const hasBkashPaymentId = await hasTableColumn('orders', 'bkash_payment_id');
        const hasBkashTrxId = await hasTableColumn('orders', 'bkash_trx_id');
        const hasPaymentCompletedAt = await hasTableColumn('orders', 'payment_completed_at');

        if (hasBkashPaymentId && hasBkashTrxId && hasPaymentCompletedAt) {
            await db.query(
                `UPDATE orders
                 SET payment_status = ?,
                     bkash_payment_id = COALESCE(?, bkash_payment_id),
                     bkash_trx_id = COALESCE(?, bkash_trx_id),
                     payment_completed_at = NOW()
                 WHERE order_id = ?`,
                ['complete', paymentInfo.paymentID || null, paymentInfo.trxID || null, order.order_id]
            );
        } else {
            await db.query(
                'UPDATE orders SET payment_status = ? WHERE order_id = ?',
                ['complete', order.order_id]
            );
        }
    } else {
        await db.query(
            'UPDATE orders SET payment_status = ? WHERE order_id = ?',
            ['Pending', order.order_id]
        );
    }

        return commission;
    } finally {
        orderFinalizationLocks.delete(lockKey);
    }
}

let temporaryUserData = {};

router.get('/cssignup', (req, res) => {
    res.sendFile(path.join(process.cwd(), 'public', 'users', 'cssignup.html'));
});
router.get('/userAbout', (req, res) => {
    res.sendFile(path.join(process.cwd(), 'public', 'users', 'userAbout.html'));
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

router.get('/dashboard', async (req, res) => {
    res.sendFile(path.join(process.cwd(), 'public', 'users', 'dashboard.html'));
});

router.get('/message-center', (req, res) => {
    const userId = req.user ? req.user.id : (req.session && req.session.user ? req.session.user.id : (req.session && req.session.userId ? req.session.userId : null));

    if (!userId) {
        req.session.redirectTo = '/user/message-center';
        return res.redirect('/user/cslogin');
    }

    res.sendFile(path.join(process.cwd(), 'public', 'users', 'message-center.html'));
});

router.get('/My-Coupons', (req, res) => {
    res.sendFile(path.join(process.cwd(), 'public', 'users', 'My-Coupons.html'));
});

router.get('/my_coin', (req, res) => {
    res.sendFile(path.join(process.cwd(), 'public', 'users', 'my_coin.html'));
});

router.get(['/penalties', '/penalties.html'], (req, res) => {
    res.sendFile(path.join(process.cwd(), 'public', 'users', 'penalties.html'));
});

router.get(['/return-policy', '/return-policy.html'], (req, res) => {
    res.sendFile(path.join(process.cwd(), 'public', 'users', 'return-policy.html'));
});
router.get('/settings', (req, res) => res.sendFile(path.join(process.cwd(), 'public', 'users', 'settings.html')));

router.get('/profile', (req, res) => res.sendFile(path.join(process.cwd(), 'public', 'users', 'profile.html')));

// ============================================================
// PRODUCT PAGE ROUTES
// New SEO URL: /user/product/:slug
// Old URL: /user/product-details?id=PRODUCT_ID
// Old URLs are kept working and redirected permanently to the slug URL.
// ============================================================
router.get('/product/:slug', (req, res) => {
    res.sendFile(path.join(process.cwd(), 'public', 'users', 'product-details.html'));
});

router.get('/product-details', async (req, res) => {
    try {
        const productId = req.query.id;

        // If someone opens /user/product-details without an ID,
        // simply serve the product page as before.
        if (!productId) {
            return res.sendFile(path.join(process.cwd(), 'public', 'users', 'product-details.html'));
        }

        const [products] = await db.query(
            `SELECT slug FROM products WHERE product_id = ? OR id = ? LIMIT 1`,
            [productId, productId]
        );

        if (products.length > 0 && products[0].slug) {
            return res.redirect(301, `/user/product/${encodeURIComponent(products[0].slug)}`);
        }

        return res.status(404).send('Product not found');
    } catch (error) {
        console.error('Legacy Product URL Redirect Error:', error);
        return res.status(500).send('Server Error');
    }
});

router.get('/product-details.html', async (req, res) => {
    try {
        const productId = req.query.id;

        if (!productId) {
            return res.sendFile(path.join(process.cwd(), 'public', 'users', 'product-details.html'));
        }

        const [products] = await db.query(
            `SELECT slug FROM products WHERE product_id = ? OR id = ? LIMIT 1`,
            [productId, productId]
        );

        if (products.length > 0 && products[0].slug) {
            return res.redirect(301, `/user/product/${encodeURIComponent(products[0].slug)}`);
        }

        return res.status(404).send('Product not found');
    } catch (error) {
        console.error('Legacy Product HTML URL Redirect Error:', error);
        return res.status(500).send('Server Error');
    }
});
// SEO-friendly checkout URL: /user/checkout/:slug?qty=1&variant=50ml
router.get('/checkout/:slug', (req, res) => res.sendFile(path.join(process.cwd(), 'public', 'users', 'checkout.html')));
// Legacy checkout URL remains supported: /user/checkout?id=PRODUCT_ID&qty=1&variant=50ml
router.get('/checkout', (req, res) => res.sendFile(path.join(process.cwd(), 'public', 'users', 'checkout.html')));
router.get('/seller-profile', (req, res) => res.sendFile(path.join(process.cwd(), 'public', 'users', 'seller-profile.html')));
router.get('/cart-html', (req, res) => res.sendFile(path.join(process.cwd(), 'public', 'users', 'cart-html.html')));
router.get('/customer-inbox', (req, res) => res.sendFile(path.join(process.cwd(), 'public', 'users', 'customer-inbox.html')));
router.get('/store/:id', (req, res) => res.sendFile(path.join(process.cwd(), 'public', 'users', 'seller-profile.html')));
router.get('/my-Order', (req, res) => res.sendFile(path.join(process.cwd(), 'public', 'users', 'my-Order.html')));
router.get('/Return-Refund-Requests', (req, res) => res.sendFile(path.join(process.cwd(), 'public', 'users', 'Return-Refund-Requests.html')));

router.get('/ipr-report', (req, res) => res.sendFile(path.join(process.cwd(), 'public', 'users', 'ipr-report.html')));
router.get('/ipr-report.html', (req, res) => {
    const userId = req.user ? req.user.id : (req.session && req.session.user ? req.session.user.id : (req.session && req.session.userId ? req.session.userId : null));

    if (!userId) {
        req.session.redirectTo = '/user/ipr-report.html';
        return res.redirect('/user/cslogin');
    }

    res.sendFile(path.join(process.cwd(), 'public', 'users', 'ipr-report.html'));
});

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
                productContext = `Product Context: Name: ${p.title}, Price: ৳${p.sale_price}, Category: ${p.category}, Description:${p.description}. `;
            }
        }

        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            return res.json({ 
                success: true, 
                reply: "AI Assistant is running in basic mode. How can I help you with NexKart products today?" 
            });
        }

        const promptText = `You are NexKart AI Shopping Assistant. Be helpful, concise, and friendly. ${productContext}User question:${message}`;
        
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

        const [products] = await db.query('SELECT * FROM products WHERE id = ? OR product_id = ?', [product_id, product_id]);
        
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

        // ==================== TRACKING EVENT: ADD TO CART ====================
        const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
        const userAgent = req.headers['user-agent'];

        await sendFacebookCAPI('AddToCart', {
            client_ip_address: clientIp,
            client_user_agent: userAgent
        }, {
            currency: 'BDT',
            value: products[0].sale_price * qtyToAdd,
            contents: [{
                id: products[0].product_id || products[0].id,
                quantity: qtyToAdd
            }]
        });

        await sendGA4Measurement('add_to_cart', userId.toString(), {
            currency: 'BDT',
            value: products[0].sale_price * qtyToAdd,
            items: [{
                item_id: products[0].product_id || products[0].id,
                item_name: products[0].title,
                price: products[0].sale_price,
                quantity: qtyToAdd
            }]
        });

        return res.json({ success: true, message: 'Product added to cart successfully!' });
    } catch (error) {
        console.error("Add to Cart Error:", error);
        return res.status(500).json({ success: false, message: 'Server Error!' });
    }
});

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
            return res.status(404).json({ message: 'Ei email-ti amader system-e registered nei!' });
        }

        const user = users[0];

        if (!user.password) {
            return res.status(400).json({ message: 'Ei account-ti Google diye toiri kora hoyeche. Onugra kore Google diye login korun!' });
        }

        const resetToken = crypto.randomBytes(32).toString('hex');
        const tokenExpires = new Date(Date.now() + 15 * 60 * 1000); 

        await db.query(
            'UPDATE users SET reset_password_token = ?, reset_password_expires = ? WHERE id = ?',
            [resetToken, tokenExpires, user.id]
        );

        const baseUrl = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
        const resetUrl = `${baseUrl}/user/reset-password/${resetToken}`;

        const emailTemplate = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Reset Password - NexKart</title>
        </head>
        <body style="margin: 0; padding: 0; background-color: #f4f6f9; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;">
            <table border="0" cellpadding="0" cellspacing="0" width="100%" style="table-layout: fixed; background-color: #f4f6f9; padding: 40px 0;">
                <tr>
                    <td align="center">
                        <table border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 550px; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 15px rgba(0, 0, 0, 0.08);">
                            <tr>
                                <td align="center" style="background: linear-gradient(135deg, #ff4b6e, #ff758c); padding: 30px 20px;">
                                    <h1 style="color: #ffffff; margin: 0; font-size: 28px; font-weight: 700; letter-spacing: 1px;">NexKart</h1>
                                    <p style="color: #ffe6eb; margin: 5px 0 0 0; font-size: 13px;">Your trusted shopping partner</p>
                                </td>
                            </tr>
                            <tr>
                                <td style="padding: 35px 30px; text-align: center;">
                                    <h2 style="color: #333333; margin: 0 0 10px 0; font-size: 20px; font-weight: 600;">Forgot Your Password?</h2>
                                    <p style="color: #666666; font-size: 14px; line-height: 1.6; margin: 0 0 25px 0;">
                                        Hello <strong>${user.name || 'Valued Customer'}</strong>,<br>
                                        We received a request to reset the password for your NexKart account. Click the button below to set a new password.
                                    </p>
                                    <table border="0" cellpadding="0" cellspacing="0" style="margin: 0 auto;">
                                        <tr>
                                            <td align="center" style="border-radius: 8px;" bgcolor="#ff4b6e">
                                                <a href="${resetUrl}" target="_blank" style="font-size: 15px; font-family: Arial, sans-serif; color: #ffffff; text-decoration: none; border-radius: 8px; padding: 12px 30px; border: 1px solid #ff4b6e; display: inline-block; font-weight: bold;">
                                                    Reset My Password
                                                </a>
                                            </td>
                                        </tr>
                                    </table>
                                    <p style="color: #888888; font-size: 12px; margin-top: 25px;">
                                        This reset link is valid for <strong>15 minutes</strong>.
                                    </p>
                                </td>
                            </tr>
                        </table>
                    </td>
                </tr>
            </table>
        </body>
        </html>
        `;

        const tokenResponse = await axios.post('https://oauth2.googleapis.com/token', null, {
            params: {
                client_id: process.env.GOOGLE_USER_CLIENT_ID,
                client_secret: process.env.GOOGLE_USER_CLIENT_SECRET,
                refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
                grant_type: 'refresh_token'
            }
        });

        const accessToken = tokenResponse.data.access_token;

        const subject = "🔒 Reset Your NexKart Password";
        const utf8Subject = `=?utf-8?B?${Buffer.from(subject).toString('base64')}?=`;
        const messageParts = [
            `To: ${email}`,
            `Subject: ${utf8Subject}`,
            `MIME-Version: 1.0`,
            `Content-Type: text/html; charset=utf-8`,
            ``,
            emailTemplate
        ];
        const message = messageParts.join('\r\n');
        const encodedMessage = Buffer.from(message)
            .toString('base64')
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=+$/, '');

        await axios.post(
            `https://gmail.googleapis.com/gmail/v1/users/me/messages/send`,
            { raw: encodedMessage },
            {
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        return res.status(200).json({ message: 'A reset link has been sent to your email! Please check your spam folder as well.' });

    } catch (err) {
        console.error('Google API Email Send Error:', err.response?.data || err.message);
        return res.status(500).json({ message: 'There was a problem sending the email! Please check your configuration.' });
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

// ==================== [ NORMAL GOOGLE AUTH ROUTES (cslogin Page) ] ====================

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

// ==================== [ ALADA POPUP GOOGLE AUTH ROUTES (Product Modal) ] ====================

// 1. Popup Google Login Initiate Route
router.get('/auth/google/popup', passport.authenticate('google-popup', { scope: ['profile', 'email'] }));

router.get('/auth/google/popup/callback', 
    passport.authenticate('google-popup', { failureRedirect: '/user/auth/google/popup-failure' }),
    (req, res) => {
        req.logIn(req.user, (err) => {
            if (err) {
                console.error("Google Popup Session Error:", err);
                return res.send(`
                    <script>
                        if (window.opener) {
                            window.opener.postMessage({ status: 'error', message: 'login_failed' }, '*');
                            window.close();
                        } else {
                            window.location.href = '/user/cslogin';
                        }
                    </script>
                `);
            }

            if (req.user) {
                req.session.user = { id: req.user.id, user_type: 'user' };
                req.session.userId = req.user.id;
            }

            // Session explicitly save to guarantee cookie persistence
            req.session.save((saveErr) => {
                if (saveErr) {
                    console.error("Session Save Error:", saveErr);
                }
                return res.send(`
                    <script>
                        if (window.opener) {
                            window.opener.postMessage({ status: 'success', message: 'login_completed' }, '*');
                            window.close();
                        } else {
                            window.location.href = '/user/dashboard';
                        }
                    </script>
                `);
            });
        });
    }
);

// 3. Popup Failure Route
router.get('/auth/google/popup-failure', (req, res) => {
    res.send(`
        <script>
            if (window.opener) {
                window.opener.postMessage({ status: 'error', message: 'login_failed' }, '*');
                window.close();
            } else {
                window.location.href = '/user/product-details';
            }
        </script>
    `);
});

// ==================== [ POPUP EMAIL/PASSWORD LOGIN ROUTE ] ====================

router.post('/pop-login', async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.json({ success: false, message: "Email ebong Password pradan korun!" });
    }

    try {
        const [adminCheck] = await db.query('SELECT * FROM admins WHERE email = ?', [email]);
        if (adminCheck.length > 0) {
            return res.json({ success: false, message: "Admin email diye user login sombhov noy!" });
        }

        const [users] = await db.query('SELECT * FROM users WHERE email = ?', [email]);
        if (users.length === 0) {
            return res.json({ success: false, message: "Email ba Password vul!" });
        }

        const user = users[0];

        if (!user.password || typeof user.password !== 'string') {
            return res.json({ success: false, message: "Ei account-ti Google diye toiri kora. Google button ti use korun!" });
        }

        const isMatch = await bcrypt.compare(String(password), String(user.password));
        if (!isMatch) {
            return res.json({ success: false, message: "Email ba Password vul!" });
        }

        user.user_type = 'user';

        req.login(user, (err) => {
            if (err) {
                console.error("Passport Pop Login Error:", err);
                return res.json({ success: false, message: "Session Error!" });
            }
            
            req.session.user = { id: user.id, user_type: 'user' }; 
            req.session.userId = user.id; 

            return res.json({ success: true, message: "Login Successful!" });
        });

    } catch (err) {
        console.error("Pop Login Error:", err);
        return res.json({ success: false, message: "Server Error!" });
    }
});

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

// ==================== PLACE ORDER ====================
router.post('/place-order', async (req, res) => {
    try {
        const userId = req.user ? req.user.id : (req.session && req.session.user ? req.session.user.id : (req.session && req.session.userId ? req.session.userId : null));
        if (!userId) {
            return res.status(401).json({ success: false, message: 'Unauthorized: Please login first!' });
        }

        const {
            product_id, quantity, variant, payment_method, selected_gateway,
            name, email, phone, division, district, upazilla, union_area,
            post_code, block_house, discount_amount, coupon_code, use_coins
        } = req.body;

        // Shipping/contact data is authoritative from the logged-in user's profile.
        // Browser values are only a fallback for older accounts/routes.
        const [profileRows] = await db.query(
            `SELECT name, email, phone_number, division, district, upazilla,
                    union_area, post_code, block_house
             FROM users WHERE id = ? LIMIT 1`,
            [userId]
        );
        const profile = profileRows[0] || {};
        // Name + phone are intentionally editable on checkout. The location/address
        // fields remain profile-controlled so no administrative code is exposed.
        const orderName = String(name || profile.name || '').trim();
        const orderEmail = String(profile.email || email || '').trim();
        const orderPhone = String(phone || profile.phone_number || '').trim();
        const orderDivision = String(profile.division || division || '').trim();
        const orderDistrict = String(profile.district || district || '').trim();
        const orderUpazilla = String(profile.upazilla || upazilla || '').trim();
        const orderUnion = String(profile.union_area || union_area || '').trim();
        const orderPostCode = String(profile.post_code || post_code || '').trim();
        const orderBlockHouse = String(profile.block_house || block_house || '').trim();

        if (!product_id || !quantity || !orderName || !orderPhone || !orderDistrict || !orderBlockHouse) {
            return res.status(400).json({ success: false, message: 'প্রোফাইলে প্রয়োজনীয় shipping/contact তথ্য পাওয়া যায়নি। Profile থেকে address ঠিক করে আবার চেষ্টা করুন।' });
        }

        const orderQty = parseInt(quantity, 10);
        if (!orderQty || orderQty <= 0) {
            return res.status(400).json({ success: false, message: 'Invalid quantity!' });
        }

        const [products] = await db.query(
            'SELECT * FROM products WHERE id = ? OR product_id = ? LIMIT 1',
            [product_id, product_id]
        );
        if (!products.length) {
            return res.status(404).json({ success: false, message: 'Product not found!' });
        }

        const product = products[0];
        const currentStock = parseInt(product.stock_quantity, 10) || 0;
        if (currentStock <= 0) {
            return res.status(400).json({ success: false, message: 'দুঃখিত, প্রোডাক্টটি স্টক আউট!' });
        }
        if (currentStock < orderQty) {
            return res.status(400).json({ success: false, message: `পর্যাপ্ত stock নেই! বর্তমানে ${currentStock} টি আছে।` });
        }

        const seller_id = product.admin_id;
        if (!seller_id) {
            return res.status(400).json({ success: false, message: 'এই product-এর seller/admin ID পাওয়া যায়নি!' });
        }

        const [sellerRows] = await db.query('SELECT id FROM admins WHERE id = ? LIMIT 1', [seller_id]);
        if (!sellerRows.length) {
            return res.status(400).json({ success: false, message: `Seller/Admin ID ${seller_id} পাওয়া যায়নি!` });
        }

        const salePrice = parseFloat(product.sale_price) || 0;
        let baseDeliveryCharge = Number(product.delivery_charge) || 60;
        const deliveryLimit = Number(product.delivery_limit) || 1;
        if (Number(product.free_shipping) === 1) baseDeliveryCharge = 0;

        let deliveryCharge = baseDeliveryCharge;
        if (deliveryLimit > 0 && baseDeliveryCharge > 0) {
            deliveryCharge = baseDeliveryCharge * Math.ceil(orderQty / deliveryLimit);
        }

        const subtotal = salePrice * orderQty;

        // Server-side coupon verification: do not trust discount_amount from browser.
        let appliedDiscount = 0;
        let appliedCouponName = '';
        if (coupon_code) {
            const [coupons] = await db.query('SELECT * FROM coupons WHERE coupon_name = ? LIMIT 1', [String(coupon_code).trim()]);
            if (coupons.length) {
                const coupon = coupons[0];
                const couponProductId = coupon.product_id;
                const isGlobalCoupon = !couponProductId || couponProductId === '' || couponProductId == 0;
                const isMatched = couponProductId == product.id || couponProductId === product.product_id;
                const notExpired = !coupon.expiry_date || new Date(coupon.expiry_date) >= new Date();
                if ((isGlobalCoupon || isMatched) && notExpired) {
                    appliedDiscount = Math.max(0, Number(coupon.discount_amount) || 0);
                    appliedCouponName = coupon.coupon_name || String(coupon_code).trim();
                }
            }
        } else {
            // Backward compatibility: allow the existing client payload while still clamping it.
            appliedDiscount = Math.max(0, Number(discount_amount) || 0);
        }
        appliedDiscount = Math.min(appliedDiscount, subtotal);

        // Server-side coin validation.
        let coinDiscountAmount = 0;
        let availableCoinsForOrder = 0;
        const wantsCoins = use_coins === true || use_coins === 'true' || use_coins === 1 || use_coins === '1';
        if (wantsCoins) {
            const coinOfferEnabled = String(product.coin_offer || '').toLowerCase() === 'yes';
            const maxCoinPercent = Math.max(0, parseFloat(product.coin_percentage_value) || 0);
            if (coinOfferEnabled && maxCoinPercent > 0) {
                availableCoinsForOrder = await getAvailableCoins(userId);
                const maxDiscountByPercent = (subtotal * maxCoinPercent) / 100;
                const maxCoinsAllowed = Math.max(0, Math.floor(maxDiscountByPercent / 0.30));
                const coinsUsedForOrder = Math.min(Math.floor(availableCoinsForOrder), maxCoinsAllowed);
                coinDiscountAmount = coinsUsedForOrder * 0.30;
            }
        }

        const totalAmount = Math.max(0, subtotal - appliedDiscount - coinDiscountAmount) + deliveryCharge;

        // Validate commission configuration BEFORE INSERT INTO orders.
        // If `commission` is unavailable or invalid, no order row is created.
        try {
            await getCommissionRate();
        } catch (commissionConfigError) {
            console.error('COMMISSION CONFIG ERROR:', commissionConfigError);
            return res.status(500).json({
                success: false,
                message: commissionConfigError.message || 'Commission configuration error.'
            });
        }

        // If COD is disabled for the product, server-side force bKash online payment.
        let effectivePaymentMethod = String(payment_method || 'cod').toLowerCase();
        if (effectivePaymentMethod === 'cod' && Number(product.cod_available) === 0) {
            effectivePaymentMethod = 'online';
        }
        const gatewayUsed = effectivePaymentMethod === 'online' ? (String(selected_gateway || 'bkash').toLowerCase()) : null;

        if (effectivePaymentMethod === 'online' && gatewayUsed !== 'bkash') {
            return res.status(400).json({ success: false, message: 'বর্তমানে শুধু bKash online payment available.' });
        }

        // Existing user profiles may contain Bangladesh administrative codes.
        // Resolve the known codes to readable names for the order/shipping address.
        const resolveLocationName = (value, type) => {
            const raw = String(value ?? '').trim();
            if (!raw) return '';

            const maps = {
                division: { '6': 'Dhaka' },
                district: { '43': 'Narayanganj' },
                upazilla: { '331': 'Rupganj' }
            };

            return maps[type]?.[raw] || raw;
        };

        const shippingDivision = resolveLocationName(orderDivision, 'division');
        const shippingDistrict = resolveLocationName(orderDistrict, 'district');
        const shippingUpazilla = resolveLocationName(orderUpazilla, 'upazilla');
        const shippingUnion = orderUnion;
        const shippingBlockHouse = orderBlockHouse;

        const fullShippingAddress = [
            shippingBlockHouse,
            shippingUnion,
            shippingUpazilla,
            shippingDistrict,
            shippingDivision
        ].filter(Boolean).join(', ') + (orderPostCode ? `, Post Code: ${orderPostCode}` : '');
        const orderId = 'NXK-' + Date.now().toString().slice(-8) + Math.floor(100 + Math.random() * 900);
        const paymentStatus = effectivePaymentMethod === 'online' ? 'Pending Payment' : 'Pending';

        // Build the INSERT from columns that actually exist. This keeps COD working
        // even if the optional migration has not been run yet.
        const hasCouponDiscount = await hasTableColumn('orders', 'coupon_discount');
        const hasCoinDiscount = await hasTableColumn('orders', 'coin_discount');

        const orderColumns = [
            'order_id', 'user_id', 'product_id', 'seller_id', 'quantity', 'variant',
            'subtotal_price', 'delivery_charge', 'discount_amount', 'total_amount',
            'payment_method', 'selected_gateway', 'payment_status',
            'customer_name', 'customer_email', 'customer_phone', 'shipping_address',
            'vat_cm', 'qtyCalculate', 'sendMail', 'created_at'
        ];
        const orderValues = [
            orderId, userId, product.id, seller_id, orderQty, variant || null,
            subtotal, deliveryCharge, appliedDiscount + coinDiscountAmount, totalAmount,
            effectivePaymentMethod, gatewayUsed, paymentStatus,
            orderName, orderEmail || null, orderPhone, fullShippingAddress,
            0, 0, 0, new Date()
        ];

        if (hasCouponDiscount) {
            orderColumns.push('coupon_discount');
            orderValues.push(appliedDiscount);
        }
        if (hasCoinDiscount) {
            orderColumns.push('coin_discount');
            orderValues.push(coinDiscountAmount);
        }

        const placeholders = orderColumns.map(() => '?').join(', ');
        await db.query(
            `INSERT INTO orders (${orderColumns.join(', ')}) VALUES (${placeholders})`,
            orderValues
        );

        // COD: order is immediately payable/unpaid, stock is deducted, commission is recorded excluding delivery.
        if (effectivePaymentMethod === 'cod') {
            const [orderRows] = await db.query('SELECT * FROM orders WHERE order_id = ? LIMIT 1', [orderId]);
            if (!orderRows.length) {
                return res.status(500).json({ success: false, message: 'Order তৈরি হয়েছে কিন্তু database থেকে পাওয়া যাচ্ছে না। আবার চেষ্টা করুন।' });
            }

            // Stock/commission/coin work is the actual order finalization. If this
            // fails, return the real server-side reason instead of hiding it behind
            // a generic 500. Email/analytics below are deliberately non-blocking.
            try {
                await finalizeSuccessfulOrder(orderRows[0], 'unpaid');
            } catch (finalizeError) {
                console.error('COD FINALIZE ERROR:', finalizeError);
                return res.status(500).json({
                    success: false,
                    message: 'COD order finalization failed: ' + (finalizeError.message || 'Unknown error')
                });
            }

            const orderData = {
                order_id: orderId, customer_name: orderName, customer_email: orderEmail,
                customer_phone: orderPhone, shipping_address: fullShippingAddress,
                payment_method: effectivePaymentMethod, selected_gateway: null,
                payment_status: 'Pending', quantity: orderQty, variant,
                subtotal_price: subtotal, delivery_charge: deliveryCharge, total_amount: totalAmount
            };

            try {
                await sendInvoiceEmail(orderData, product.title);
            } catch (emailError) {
                // Email failure must never turn a successfully created COD order into HTTP 500.
                console.error('COD INVOICE EMAIL ERROR:', emailError?.message || emailError);
            }

            // Analytics are also non-blocking. The helpers already catch their own
            // network errors, but keep this isolated so the order response is safe.
            try {
                const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
                const userAgent = req.headers['user-agent'];
                await sendFacebookCAPI('Purchase', {
                    email: orderEmail, phone: orderPhone, name: orderName,
                    client_ip_address: clientIp, client_user_agent: userAgent
                }, {
                    currency: 'BDT', value: totalAmount, order_id: orderId,
                    contents: [{ id: product.product_id || product.id, quantity: orderQty, item_price: salePrice }]
                });
                await sendGA4Measurement('purchase', String(userId), {
                    transaction_id: orderId, value: totalAmount, currency: 'BDT',
                    tax: 0, shipping: deliveryCharge,
                    items: [{ item_id: product.product_id || product.id, item_name: product.title, price: salePrice, quantity: orderQty }]
                });
            } catch (trackingError) {
                console.error('COD TRACKING ERROR:', trackingError?.message || trackingError);
            }

            return res.json({
                success: true,
                order_id: orderId,
                payment_type: 'unpaid',
                message: 'Order placed successfully!'
            });
        }

        // Online bKash: create the payment first. Stock/commission are finalized only after bKash confirms payment.
        try {
            const bkashPayment = await createBkashPayment({
                orderId,
                amount: totalAmount,
                payerReference: orderEmail || orderPhone || orderId
            });

            if (await hasTableColumn('orders', 'bkash_payment_id')) {
                await db.query(
                    'UPDATE orders SET bkash_payment_id = ? WHERE order_id = ?',
                    [bkashPayment.paymentID, orderId]
                );
            }

            return res.json({
                success: true,
                order_id: orderId,
                selected_gateway: 'BKASH',
                payment_url: bkashPayment.bkashURL,
                payment_id: bkashPayment.paymentID
            });
        } catch (bkashError) {
            console.error('bKash Create Payment Error:', bkashError.response?.data || bkashError.message);
            await db.query('UPDATE orders SET payment_status = ? WHERE order_id = ?', ['Failed', orderId]);
            return res.status(502).json({ success: false, message: 'bKash payment শুরু করা যায়নি। অনুগ্রহ করে আবার চেষ্টা করুন।' });
        }

    } catch (error) {
        console.error('PLACE ORDER ERROR:', error);
        return res.status(500).json({ success: false, message: 'Order Error: ' + (error.message || 'Unknown server error') });
    }
});

// ==================== [ BKASH PAYMENT CALLBACK & SUCCESS ROUTE ] ====================
router.get('/bkash/callback', async (req, res) => {
    const baseUrl = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
    try {
        const { order_id, paymentID, status } = req.query;
        if (!order_id) return res.redirect(`${baseUrl}/user/dashboard?payment=failed`);

        const [orders] = await db.query('SELECT * FROM orders WHERE order_id = ? LIMIT 1', [order_id]);
        if (!orders.length) return res.redirect(`${baseUrl}/user/dashboard?payment=failed&order_id=${encodeURIComponent(order_id)}`);
        const order = orders[0];

        if (order.payment_status === 'complete') {
            const returnUrl = BKASH_CONFIG.RETURN_URL || `${baseUrl}/user/dashboard`;
            return res.redirect(`${returnUrl}${returnUrl.includes('?') ? '&' : '?'}payment=success&order_id=${encodeURIComponent(order_id)}`);
        }

        if (String(status || '').toLowerCase() !== 'success' || !paymentID) {
            await db.query('UPDATE orders SET payment_status = ? WHERE order_id = ?', ['Failed', order_id]);
            const returnUrl = BKASH_CONFIG.RETURN_URL || `${baseUrl}/user/dashboard`;
            return res.redirect(`${returnUrl}${returnUrl.includes('?') ? '&' : '?'}payment=failed&order_id=${encodeURIComponent(order_id)}`);
        }

        const executeResult = await executeBkashPayment(paymentID);
        const transactionStatus = String(executeResult?.transactionStatus || '').toLowerCase();
        const executedAmount = Number(executeResult?.amount || 0);
        const expectedAmount = Number(order.total_amount || 0);

        let finalPayment = executeResult;
        if (transactionStatus !== 'completed' && transactionStatus !== 'success') {
            finalPayment = await queryBkashPayment(paymentID);
        }

        const finalStatus = String(finalPayment?.transactionStatus || '').toLowerCase();
        const finalAmount = Number(finalPayment?.amount || executedAmount || 0);
        const trxID = finalPayment?.trxID || executeResult?.trxID || null;

        if ((finalStatus === 'completed' || finalStatus === 'success') && Math.abs(finalAmount - expectedAmount) < 0.01) {
            await finalizeSuccessfulOrder(order, 'paid', { paymentID, trxID });

            const orderData = {
                order_id: order.order_id,
                customer_name: order.customer_name,
                customer_email: order.customer_email,
                customer_phone: order.customer_phone,
                shipping_address: order.shipping_address,
                payment_method: order.payment_method,
                selected_gateway: order.selected_gateway,
                payment_status: 'complete',
                quantity: order.quantity,
                variant: order.variant,
                subtotal_price: order.subtotal_price,
                delivery_charge: order.delivery_charge,
                total_amount: order.total_amount
            };
            await sendInvoiceEmail(orderData, `Order #${order.order_id}`);

            const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
            const userAgent = req.headers['user-agent'];
            await sendFacebookCAPI('Purchase', {
                email: order.customer_email,
                phone: order.customer_phone,
                name: order.customer_name,
                client_ip_address: clientIp,
                client_user_agent: userAgent
            }, {
                currency: 'BDT', value: Number(order.total_amount), order_id: order.order_id,
                contents: [{ id: order.product_id, quantity: order.quantity, item_price: Number(order.subtotal_price) / Math.max(1, Number(order.quantity)) }]
            });
            await sendGA4Measurement('purchase', String(order.user_id), {
                transaction_id: order.order_id, value: Number(order.total_amount), currency: 'BDT',
                tax: 0, shipping: Number(order.delivery_charge || 0),
                items: [{ item_id: order.product_id, item_name: `Order #${order.order_id}`, price: Number(order.subtotal_price) / Math.max(1, Number(order.quantity)), quantity: Number(order.quantity) }]
            });

            const returnUrl = BKASH_CONFIG.RETURN_URL || `${baseUrl}/user/dashboard`;
            return res.redirect(`${returnUrl}${returnUrl.includes('?') ? '&' : '?'}payment=success&order_id=${encodeURIComponent(order_id)}&trxID=${encodeURIComponent(trxID || '')}`);
        }

        await db.query('UPDATE orders SET payment_status = ?, bkash_payment_id = ? WHERE order_id = ?', ['Failed', paymentID, order_id]);
        const returnUrl = BKASH_CONFIG.RETURN_URL || `${baseUrl}/user/dashboard`;
        return res.redirect(`${returnUrl}${returnUrl.includes('?') ? '&' : '?'}payment=failed&order_id=${encodeURIComponent(order_id)}`);
    } catch (error) {
        console.error('bKash Callback Error:', error.response?.data || error.message);
        const returnUrl = BKASH_CONFIG.RETURN_URL || `${baseUrl}/user/dashboard`;
        return res.redirect(`${returnUrl}${returnUrl.includes('?') ? '&' : '?'}payment=failed&order_id=${encodeURIComponent(req.query.order_id || '')}`);
    }
});

// Kept for backward compatibility. It no longer marks an order paid without bKash verification.
router.get('/bkash-success', async (req, res) => {
    const baseUrl = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
    const orderId = req.query.order_id || '';
    const returnUrl = BKASH_CONFIG.RETURN_URL || `${baseUrl}/user/dashboard`;
    return res.redirect(`${returnUrl}${returnUrl.includes('?') ? '&' : '?'}payment=pending&order_id=${encodeURIComponent(orderId)}`);
});

// Backend POST Route Example
router.post('/user/inquiry', async (req, res) => {
    try {
        const { product_id, question, user_name } = req.body;
        
        // Database query to insert inquiry
        await db.query(
            "INSERT INTO product_inquiries (product_id, question, user_name, created_at) VALUES (?, ?, ?, NOW())",
            [product_id, question, user_name]
        );

        // ✅ MUST RETURN JSON
        return res.json({ success: true, message: 'Inquiry submitted successfully!' });
    } catch (error) {
        console.error("Inquiry error:", error);
        return res.status(500).json({ success: false, message: 'Server error' });
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

router.get('/product-data/:slug', async (req, res) => {
    try {
        const productSlug = decodeURIComponent(req.params.slug || '').trim();

        if (!productSlug) {
            return res.status(400).json({ success: false, message: 'Invalid product URL!' });
        }
        
        const userId = req.user ? req.user.id : (req.session && req.session.user ? req.session.user.id : (req.session && req.session.userId ? req.session.userId : null));

        const productQuery = `
            SELECT p.*, p.video_url, a.id AS seller_id, a.picture AS seller_picture, a.shop_name AS seller_shop_name,
                   a.slogan AS seller_slogan, a.is_verified AS seller_is_verified, a.status AS seller_status
            FROM products p LEFT JOIN admins a ON p.admin_id = a.id
            WHERE p.slug = ?
            LIMIT 1
        `;
        const [products] = await db.query(productQuery, [productSlug]);
        if (products.length === 0) {
            return res.status(404).json({ success: false, message: 'প্রোডাক্ট পাওয়া যায়নি!' });
        }
        const product = products[0];
        const [images] = await db.query(`SELECT image_path FROM product_images WHERE product_id = ?`, [product.id]);

        let userTotalCoins = 0;
        if (userId) {
            const [coinRows] = await db.query(
                `SELECT SUM(coin_balance) AS total_coin FROM my_coins WHERE user_id = ? AND (coin_expire >= NOW() OR coin_expire IS NULL)`,
                [userId]
            );
            userTotalCoins = coinRows[0].total_coin || 0;
        }

        const [sellerProducts] = await db.query(`
            SELECT p.id, p.product_id, p.slug, p.title, p.sale_price, p.regular_price, p.category,
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
            SELECT p.id, p.product_id, p.slug, p.title, p.sale_price, p.regular_price, p.category,
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
            suggested_products: suggestedProducts,
            user_coins: userTotalCoins,           
            coin_value_in_bdt: 0.30               
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

router.get('/category.html', (req, res) => {
    res.sendFile(path.join(process.cwd(), 'public', 'users', 'category.html'));
});

router.get('/dashProduct', async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 8;

        const [totalCountResult] = await db.query('SELECT COUNT(*) AS total FROM products');
        const totalProducts = totalCountResult[0].total;

        const maxOffset = Math.max(0, totalProducts - limit);
        const requestedOffset = parseInt(req.query.offset);
        const randomOffset = page === 1
            ? Math.floor(Math.random() * (maxOffset + 1))
            : (Number.isFinite(requestedOffset) ? requestedOffset : 0);
        const offset = Math.min(Math.max(0, randomOffset), maxOffset);

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
        const nextOffset = offset + products.length;
        const hasMore = nextOffset < totalProducts;

        return res.json({ 
            success: true, 
            count: products.length, 
            products: products,
            hasMore: hasMore,
            offset: offset,
            nextOffset: nextOffset
        });
    } catch (error) {
        console.error("Dashboard Product Load Error:", error);
        return res.status(500).json({ success: false, message: "Server Error" });
    }
});

// Dynamic Category, Promo Badge & Search Product Fetching Endpoint (Dashboard Matched)
router.get('/get-products-by-category', async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 8;
        const offset = (page - 1) * limit;

        const { cat, type, promo, search } = req.query;

        let whereClauses = [];
        let queryParams = [];

        // 1. Promo Badge Filtering Logic
        if (promo) {
            if (promo === 'super_deal') {
                whereClauses.push("(LOWER(p.promo_badge) LIKE '%super%' OR LOWER(p.promo_badge) LIKE '%flash%')");
            } else if (promo === 'hot') {
                whereClauses.push("LOWER(p.promo_badge) LIKE '%hot%'");
            } else if (promo === 'best_seller') {
                whereClauses.push("LOWER(p.promo_badge) LIKE '%best%'");
            } else if (promo === 'new_arrival') {
                whereClauses.push("(LOWER(p.promo_badge) LIKE '%new%' OR LOWER(p.promo_badge) LIKE '%arrival%')");
            } else if (promo === 'coin_products') {
                whereClauses.push("LOWER(p.coin_offer) = 'yes'");
            } else if (promo === 'limited_edition') {
                whereClauses.push("LOWER(p.promo_badge) LIKE '%limited%'");
            } else if (promo === 'trending') {
                whereClauses.push("LOWER(p.promo_badge) LIKE '%trend%'");
            } else if (promo === 'exclusive') {
                whereClauses.push("LOWER(p.promo_badge) LIKE '%exclusive%'");
            } else if (promo === 'free_shipping') {
                whereClauses.push("LOWER(p.promo_badge) LIKE '%free%'");
            } else if (promo === 'clearance') {
                whereClauses.push("LOWER(p.promo_badge) LIKE '%clearance%'");
            } else if (promo !== 'all') {
                whereClauses.push("LOWER(p.promo_badge) = ?");
                queryParams.push(promo.toLowerCase());
            }
        }

        // 2. Category & Type Filtering Logic
        const categoryVal = cat || type;
        if (categoryVal && categoryVal !== 'all' && !promo) {
            whereClauses.push("LOWER(p.category) = ?");
            queryParams.push(categoryVal.toLowerCase());
        }

        // 3. Search Query Filtering Logic
        if (search) {
            whereClauses.push("(LOWER(p.title) LIKE ? OR LOWER(p.category) LIKE ?)");
            queryParams.push(`%${search.toLowerCase()}%`, `%${search.toLowerCase()}%`);
        }

        let whereSQL = whereClauses.length > 0 ? " WHERE " + whereClauses.join(" AND ") : "";

        // Query matched with Dashboard's SQL structure
        const sql = `
            SELECT p.*, 
                   CONCAT('/uploads/', (SELECT image_path FROM product_images WHERE product_id = p.id LIMIT 1)) AS primary_image,
                   COALESCE(AVG(r.rating), 0) AS avg_rating,
                   COUNT(r.id) AS review_count
            FROM products p
            LEFT JOIN product_reviews r ON p.id = r.product_id AND (r.status = 'approved' OR r.status = '1' OR r.status IS NULL)
            ${whereSQL}
            GROUP BY p.id
            ORDER BY p.id DESC 
            LIMIT ? OFFSET ?
        `;

        const countSql = `SELECT COUNT(DISTINCT p.id) as total FROM products p ${whereSQL}`;

        const [products] = await db.query(sql, [...queryParams, limit, offset]);
        const [countResult] = await db.query(countSql, queryParams);

        const totalProducts = countResult[0].total;
        const nextOffset = offset + products.length;
        const hasMore = nextOffset < totalProducts;

        res.json({
            success: true,
            products,
            hasMore,
            totalProducts
        });
    } catch (err) {
        console.error("Error in /get-products-by-category:", err);
        res.status(500).json({ success: false, message: "Server error fetching products." });
    }
});

// Tracking Config API
router.get('/api/config', (req, res) => {
    res.json({
        gaId: process.env.GA4_MEASUREMENT_ID,
        pixelId: process.env.FACEBOOK_PIXEL_ID
    });
});

module.exports = router;