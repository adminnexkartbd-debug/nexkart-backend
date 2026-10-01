const express = require('express');
const router = express.Router();
const path = require('path');
const db = require('../../db');
const multer = require('multer');
const { v2: cloudinary } = require('cloudinary');
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const axios = require('axios');
require('dotenv').config();

// Cloudinary Configuration (.env ফাইল থেকে তথ্য নিবে)
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
});

// ১. রিটার্নের প্রুফ ফাইল (ইমেজ/ভিডিও/অডিও) Cloudinary-তে সেভ করার কনফিগারেশন
const returnStorage = new CloudinaryStorage({
    cloudinary: cloudinary,
    params: async (req, file) => {
        const isImage = file.mimetype.startsWith('image');
        const isVideo = file.mimetype.startsWith('video');
        const isAudio = file.mimetype.startsWith('audio');

        let resource_type = 'auto';
        let folder = 'returns_proofs';
        let transformation = [];

        if (isImage) {
            resource_type = 'image';
            transformation = [
                { quality: 'auto:eco', fetch_format: 'auto' }
            ];
        } else if (isVideo || isAudio) {
            resource_type = 'video';
        }

        return {
            folder: folder,
            resource_type: resource_type,
            public_id: 'return-' + Date.now() + '-' + Math.round(Math.random() * 1E9),
            transformation: transformation
        };
    },
});
const upload = multer({ 
    storage: returnStorage,
    limits: { fileSize: 100 * 1024 * 1024 }
});

// ২. রিভিউ ইমেজের জন্য Cloudinary কনফিগারেশন
const reviewStorage = new CloudinaryStorage({
    cloudinary: cloudinary,
    params: async (req, file) => {
        return {
            folder: 'reviews_images',
            resource_type: 'image',
            public_id: 'review-' + Date.now() + '-' + Math.round(Math.random() * 1E9),
            transformation: [
                { width: 800, height: 800, crop: 'limit' },
                { quality: 'auto:eco', fetch_format: 'auto' }
            ]
        };
    }
});

const reviewUpload = multer({
    storage: reviewStorage,
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('Only image files are allowed for reviews!'), false);
        }
    }
});

// PaySuite সার্ভিস ইমপোর্ট
const { getPaySuiteGateways, createPaySuitePayment } = require('../../services/paysuiteService');

// BDGate Payment Integration Helper Functions
const createBDGatePayment = async (orderData, totalAmount) => {
    try {
        const response = await axios.post(`${process.env.BDGATE_API_URL}/checkout`, {
            amount: totalAmount,
            order_id: orderData.order_id,
            customer_name: orderData.name,
            customer_email: orderData.email,
            customer_phone: orderData.phone,
            payment_method: orderData.selected_gateway,
            callback_url: process.env.BDGATE_CALLBACK_URL
        }, {
            headers: {
                'Authorization': `Bearer ${process.env.BDGATE_API_KEY}`,
                'Content-Type': 'application/json'
            }
        });

        if (response.data && (response.data.checkout_url || response.data.url)) {
            return {
                success: true,
                payment_url: response.data.checkout_url || response.data.url,
                slug: response.data.slug || orderData.order_id
            };
        }
        return { success: false, message: 'Failed to generate BDGate checkout URL' };
    } catch (error) {
        console.error("BDGate API Error:", error.response?.data || error.message);
        return { success: false, message: error.response?.data?.message || 'BDGate payment initialization failed' };
    }
};

// ইমেইল সার্ভিস ইমপোর্ট
const { sendReturnEmail } = require('../../services/ReturnPolicyMail');

// ==================== [ BKASH + COMMISSION + COIN HELPERS ] ====================
const BKASH_CONFIG = {
    APP_KEY: process.env.BKASH_APP_KEY,
    APP_SECRET: process.env.BKASH_APP_SECRET,
    USERNAME: process.env.BKASH_USERNAME,
    PASSWORD: process.env.BKASH_PASSWORD,
    BASE_URL: process.env.BKASH_BASE_URL,
    CALLBACK_URL: process.env.BKASH_CALLBACK_URL,
    RETURN_URL: process.env.BKASH_RETURN_URL
};

let bkashTokenCache = { token: null, expiresAt: 0 };

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
        { app_key: BKASH_CONFIG.APP_KEY, app_secret: BKASH_CONFIG.APP_SECRET },
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
        throw new Error(`bKash token error: ${response.data?.statusMessage || response.data?.message || 'No id_token returned'}`);
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
        throw new Error(`bKash create payment failed: ${response.data?.statusMessage || response.data?.message || 'Invalid create-payment response'}`);
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
        `SELECT COUNT(*) AS cnt FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
        [tableName, columnName]
    );
    return Number(rows[0]?.cnt || 0) > 0;
}

async function getCommissionRate() {
    const [rows] = await db.query('SELECT commission_rate FROM commission ORDER BY id DESC LIMIT 1');
    return Math.max(0, Number(rows[0]?.commission_rate || 0));
}

async function recordOrderCommission({ orderId, sellerId, subtotal, paymentType }) {
    const commissionRate = await getCommissionRate();
    const commissionAmount = Math.max(0, (Number(subtotal) * commissionRate) / 100);
    const hasPaymentType = await hasTableColumn('commission_table', 'payment_type');

    const [existing] = await db.query(
        'SELECT id FROM commission_table WHERE order_number = ? LIMIT 1',
        [orderId]
    );

    if (existing.length) {
        if (hasPaymentType) {
            await db.query(
                `UPDATE commission_table
                 SET commission_rate = ?, commission_amount = ?, seller_id = ?, payment_type = ?
                 WHERE order_number = ?`,
                [commissionRate, commissionAmount, sellerId, paymentType, orderId]
            );
        } else {
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

async function recordCoinUsage({ userId, orderId, coinDiscount }) {
    const discount = Number(coinDiscount || 0);
    if (!userId || discount <= 0) return 0;
    const coinsUsed = Math.max(0, Math.round(discount / 0.30));
    if (!coinsUsed) return 0;

    const source = `order:${orderId}`;
    const [existing] = await db.query(
        `SELECT id FROM my_coins WHERE user_id = ? AND coin_source = ? AND coin_balance < 0 LIMIT 1`,
        [userId, source]
    );
    if (existing.length) return coinsUsed;

    const [balanceRows] = await db.query(
        `SELECT COALESCE(SUM(coin_balance), 0) AS total_coin
         FROM my_coins
         WHERE user_id = ? AND (coin_expire >= NOW() OR coin_expire IS NULL)`,
        [userId]
    );
    const available = Math.max(0, Number(balanceRows[0]?.total_coin || 0));
    const actualUsed = Math.min(coinsUsed, Math.floor(available));
    if (!actualUsed) return 0;

    await db.query(
        `INSERT INTO my_coins (user_id, coin_balance, coin_expire, coin_create_date, coin_source)
         VALUES (?, ?, NULL, NOW(), ?)`,
        [userId, -actualUsed, source]
    );
    return actualUsed;
}

async function finalizeSuccessfulOrder(order, paymentType, paymentInfo = {}) {
    // Idempotency: do not deduct stock twice if bKash callback is repeated.
    if (paymentType === 'paid' && String(order.payment_status || '').toLowerCase() === 'complete') {
        return { commissionRate: 0, commissionAmount: 0 };
    }

    const [freshProducts] = await db.query('SELECT * FROM products WHERE id = ? LIMIT 1', [order.product_id]);
    if (!freshProducts.length) throw new Error('Product not found while finalizing order.');

    const product = freshProducts[0];
    const currentStock = parseInt(product.stock_quantity, 10) || 0;
    const orderQty = parseInt(order.quantity, 10) || 0;
    if (currentStock < orderQty) {
        throw new Error(`Insufficient stock while finalizing order ${order.order_id}.`);
    }

    const newStock = currentStock - orderQty;
    const hasSoldQty = await hasTableColumn('products', 'sold_qty');
    const hasStockStatus = await hasTableColumn('products', 'stock_status');

    if (hasSoldQty && hasStockStatus) {
        await db.query(
            `UPDATE products SET stock_quantity = ?, sold_qty = ?, stock_status = ? WHERE id = ?`,
            [newStock, (parseInt(product.sold_qty, 10) || 0) + orderQty, newStock === 0 ? 'out_of_stock' : 'in_stock', order.product_id]
        );
    } else if (hasSoldQty) {
        await db.query(
            `UPDATE products SET stock_quantity = ?, sold_qty = ? WHERE id = ?`,
            [newStock, (parseInt(product.sold_qty, 10) || 0) + orderQty, order.product_id]
        );
    } else {
        await db.query(`UPDATE products SET stock_quantity = ? WHERE id = ?`, [newStock, order.product_id]);
    }

    // These are business records. Keep their errors visible in logs, but don't
    // turn an otherwise valid order into a fake payment failure.
    let commission = { commissionRate: 0, commissionAmount: 0 };
    try {
        commission = await recordOrderCommission({
            orderId: order.order_id,
            sellerId: order.seller_id,
            subtotal: order.subtotal_price,
            paymentType
        });
    } catch (e) {
        console.error('ORDER COMMISSION ERROR:', e);
    }

    try {
        await recordCoinUsage({
            userId: order.user_id,
            orderId: order.order_id,
            coinDiscount: order.coin_discount
        });
    } catch (e) {
        console.error('ORDER COIN ERROR:', e);
    }

    if (paymentType === 'paid') {
        const hasBkashPaymentId = await hasTableColumn('orders', 'bkash_payment_id');
        const hasBkashTrxId = await hasTableColumn('orders', 'bkash_trx_id');
        const hasPaymentCompletedAt = await hasTableColumn('orders', 'payment_completed_at');

        if (hasBkashPaymentId && hasBkashTrxId && hasPaymentCompletedAt) {
            await db.query(
                `UPDATE orders
                 SET payment_status = ?, bkash_payment_id = COALESCE(?, bkash_payment_id),
                     bkash_trx_id = COALESCE(?, bkash_trx_id), payment_completed_at = NOW()
                 WHERE order_id = ?`,
                ['complete', paymentInfo.paymentID || null, paymentInfo.trxID || null, order.order_id]
            );
        } else {
            await db.query('UPDATE orders SET payment_status = ? WHERE order_id = ?', ['complete', order.order_id]);
        }
    } else {
        await db.query('UPDATE orders SET payment_status = ? WHERE order_id = ?', ['Pending', order.order_id]);
    }

    return commission;
}


// HTML পেজ রেন্ডার করার রাউট
router.get('/my-orders-page', (req, res) => {
    res.sendFile(path.join(process.cwd(), 'public', 'users', 'my-Order.html'));
});

// কাস্টমারের অর্ডার ডাটা নেওয়ার রাউট
router.get('/get-my-orders', async (req, res) => {
    try {
        const userId = req.user ? req.user.id : (req.session && req.session.user ? req.session.user.id : (req.session && req.session.userId ? req.session.userId : null));

        if (!userId) {
            return res.status(401).json({ success: false, message: 'Unauthorized! Please login first.' });
        }

        const query = `
            SELECT 
                o.id AS order_table_id,
                o.order_id,
                o.user_id,
                o.product_id,
                o.seller_id,
                o.quantity,
                o.variant,
                o.subtotal_price,
                o.delivery_charge,
                o.discount_amount,
                o.total_amount,
                o.payment_method,
                o.selected_gateway,
                o.payment_status,
                o.order_status,
                o.tracking_number,
                o.customer_name,
                o.customer_email,
                o.customer_phone,
                o.shipping_address,
                o.created_at,
                p.title AS product_title,
                p.return_policy,
                CASE 
                    WHEN LOWER(TRIM(p.return_policy)) = 'no_return' THEN FALSE 
                    ELSE TRUE 
                END AS can_return,
                (SELECT 
                    CASE 
                        WHEN image_path LIKE 'http://%' OR image_path LIKE 'https://%' THEN image_path
                        WHEN image_path LIKE '/uploads/%' THEN image_path
                        WHEN image_path LIKE 'uploads/%' THEN CONCAT('/', image_path)
                        ELSE CONCAT('/uploads/', image_path)
                    END 
                 FROM product_images 
                 WHERE product_id = p.id 
                 LIMIT 1) AS product_image,
                r.rating AS user_rating,
                r.review_text AS user_review,
                r.review_imgUrl AS user_review_img,
                (SELECT COUNT(*) FROM order_returns ret WHERE ret.order_id = o.order_id AND ret.product_id = o.product_id AND ret.user_id = o.user_id) AS has_returned
            FROM orders o
            LEFT JOIN products p ON o.product_id = p.id
            LEFT JOIN product_reviews r ON o.product_id = r.product_id AND o.order_id = r.order_id AND o.user_id = r.user_id
            WHERE o.user_id = ?
            ORDER BY o.id DESC
        `;

        const [orders] = await db.query(query, [userId]);
        return res.json({ success: true, orders: orders });

    } catch (error) {
        console.error("Fetch My Orders Error:", error);
        return res.status(500).json({ success: false, message: 'Server Error while fetching orders!' });
    }
});

// ২. রিভিউ সাবমিট রাউট
router.post('/submit-review', reviewUpload.single('review_image'), async (req, res) => {
    try {
        const userId = req.user ? req.user.id : (req.session && req.session.user ? req.session.user.id : (req.session && req.session.userId ? req.session.userId : null));

        if (!userId) {
            return res.status(401).json({ success: false, message: 'Unauthorized! Please login first.' });
        }

        const { product_id, order_id, rating, review_text } = req.body;

        if (!product_id || !rating || !order_id) {
            return res.status(400).json({ success: false, message: 'Rating, Order ID, and Product ID are required!' });
        }

        const [existingReview] = await db.query(
            `SELECT id FROM product_reviews WHERE user_id = ? AND order_id = ? AND product_id = ?`,
            [userId, order_id, product_id]
        );

        if (existingReview.length > 0) {
            return res.status(400).json({ success: false, message: 'You have already submitted a review for this order!' });
        }

        let review_imgUrl = null;
        if (req.file) {
            review_imgUrl = req.file.path;
        }

        const query = `
            INSERT INTO product_reviews (product_id, user_id, order_id, rating, review_text, review_imgUrl, created_at)
            VALUES (?, ?, ?, ?, ?, ?, NOW())
        `;

        await db.query(query, [product_id, userId, order_id, rating, review_text || '', review_imgUrl]);
        return res.json({ success: true, message: 'Your review has been saved successfully!' });

    } catch (error) {
        console.error("Submit Review Error:", error);
        return res.status(500).json({ success: false, message: 'Server Error while submitting review!' });
    }
});

// ৩. রিটার্ন এবং রিফান্ড রিকোয়েস্ট সাবমিট রাউট
router.post('/submit-return-request', upload.single('proof_file'), async (req, res) => {
    try {
        const userId = req.user ? req.user.id : (req.session && req.session.user ? req.session.user.id : (req.session && req.session.userId ? req.session.userId : null));

        if (!userId) {
            return res.status(401).json({ success: false, message: 'Unauthorized! Please login first.' });
        }

        const { order_id, product_id, seller_id, return_reason, return_details } = req.body;
        const proofFile = req.file ? req.file.path : '';

        if (!order_id || !product_id || !seller_id || !return_reason || !proofFile) {
            return res.status(400).json({ success: false, message: 'All required fields including proof file and seller ID are missing!' });
        }

        const [existingReturn] = await db.query(
            `SELECT id FROM order_returns WHERE user_id = ? AND order_id = ? AND product_id = ?`,
            [userId, order_id, product_id]
        );

        if (existingReturn.length > 0) {
            return res.status(400).json({ success: false, message: 'You have already requested a return and refund for this product!' });
        }

        const [adminInfo] = await db.query(`SELECT email FROM admins WHERE id = ?`, [seller_id]);
        if (adminInfo.length > 0) {
            const sellerEmail = adminInfo[0].email;
            sendReturnEmail(sellerEmail, { 
                order_id, 
                product_id, 
                return_reason, 
                return_details, 
                proof_file: proofFile 
            });
        }

        const insertQuery = `
            INSERT INTO order_returns (user_id, order_id, product_id, seller_id, return_reason, return_details, proof_file, status, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'Pending', NOW())
        `;

        await db.query(insertQuery, [
            userId, order_id, product_id, seller_id, return_reason, return_details || '', proofFile
        ]);

        return res.json({ 
            success: true, 
            message: 'Return & Refund request submitted successfully with proof!' 
        });

    } catch (error) {
        console.error("Submit Return Error:", error);
        return res.status(500).json({ success: false, message: 'Server Error while processing return request!' });
    }
});

// অর্ডার প্লেস করার রাউট হ্যান্ডলার (COD + bKash + PaySuite + BDGate)
router.post('/place-order', async (req, res) => {
    try {
        const userId = req.user ? req.user.id : (req.session && req.session.user ? req.session.user.id : (req.session && req.session.userId ? req.session.userId : null));
        if (!userId) {
            return res.status(401).json({ success: false, message: 'Unauthorized!' });
        }

        const {
            product_id, quantity, variant, payment_method, selected_gateway,
            name, email, phone, division, district, upazilla, union_area,
            post_code, block_house, discount_amount, coupon_code, use_coins
        } = req.body;

        const orderQty = parseInt(quantity, 10);
        if (!product_id || !orderQty || orderQty <= 0) {
            return res.status(400).json({ success: false, message: 'Invalid product or quantity!' });
        }

        // Accept both numeric products.id and public products.product_id.
        const [productRows] = await db.query(
            'SELECT * FROM products WHERE id = ? OR product_id = ? LIMIT 1',
            [product_id, product_id]
        );
        if (!productRows.length) {
            return res.status(404).json({ success: false, message: 'Product not found!' });
        }
        const product = productRows[0];

        const [profileRows] = await db.query(
            `SELECT name, email, phone_number, division, district, upazilla,
                    union_area, post_code, block_house
             FROM users WHERE id = ? LIMIT 1`,
            [userId]
        );
        const profile = profileRows[0] || {};

        const orderName = String(name || profile.name || '').trim();
        const orderEmail = String(profile.email || email || '').trim();
        const orderPhone = String(phone || profile.phone_number || '').trim();
        const orderDivision = String(profile.division || division || '').trim();
        const orderDistrict = String(profile.district || district || '').trim();
        const orderUpazilla = String(profile.upazilla || upazilla || '').trim();
        const orderUnion = String(profile.union_area || union_area || '').trim();
        const orderPostCode = String(profile.post_code || post_code || '').trim();
        const orderBlockHouse = String(profile.block_house || block_house || '').trim();

        if (!orderName || !orderPhone || !orderDistrict || !orderBlockHouse) {
            return res.status(400).json({
                success: false,
                message: 'প্রোফাইলে প্রয়োজনীয় shipping/contact তথ্য পাওয়া যায়নি। Profile থেকে address ঠিক করে আবার চেষ্টা করুন।'
            });
        }

        const currentStock = parseInt(product.stock_quantity, 10) || 0;
        if (currentStock <= 0) {
            return res.status(400).json({ success: false, message: 'দুঃখিত, প্রোডাক্টটি স্টক আউট!' });
        }
        if (currentStock < orderQty) {
            return res.status(400).json({ success: false, message: `পর্যাপ্ত stock নেই! বর্তমানে ${currentStock} টি আছে।` });
        }

        const sellerId = product.admin_id;
        if (!sellerId) {
            return res.status(400).json({ success: false, message: 'এই product-এর seller/admin ID পাওয়া যায়নি!' });
        }

        const salePrice = Number(product.sale_price || 0);
        const subtotal = salePrice * orderQty;

        let deliveryCharge = Number(product.delivery_charge);
        if (!Number.isFinite(deliveryCharge)) deliveryCharge = 60;
        const deliveryLimit = Number(product.delivery_limit) || 1;
        if (Number(product.free_shipping) === 1) {
            deliveryCharge = 0;
        } else if (deliveryLimit > 0 && deliveryCharge > 0) {
            deliveryCharge *= Math.ceil(orderQty / deliveryLimit);
        }

        // Verify coupon on server when coupon_code is supplied.
        let appliedDiscount = 0;
        if (coupon_code) {
            const [coupons] = await db.query(
                'SELECT * FROM coupons WHERE coupon_name = ? LIMIT 1',
                [String(coupon_code).trim()]
            );
            if (coupons.length) {
                const coupon = coupons[0];
                const couponProductId = coupon.product_id;
                const globalCoupon = !couponProductId || couponProductId === '' || couponProductId == 0;
                const matched = couponProductId == product.id || couponProductId === product.product_id;
                const notExpired = !coupon.expiry_date || new Date(coupon.expiry_date) >= new Date();
                if ((globalCoupon || matched) && notExpired) {
                    appliedDiscount = Math.max(0, Number(coupon.discount_amount) || 0);
                }
            }
        } else {
            appliedDiscount = Math.max(0, Number(discount_amount) || 0);
        }
        appliedDiscount = Math.min(appliedDiscount, subtotal);

        let coinDiscountAmount = 0;
        const wantsCoins = use_coins === true || use_coins === 'true' || use_coins === 1 || use_coins === '1';
        if (wantsCoins && String(product.coin_offer || '').toLowerCase() === 'yes') {
            const maxPercent = Math.max(0, Number(product.coin_percentage_value) || 0);
            if (maxPercent > 0) {
                const [coinRows] = await db.query(
                    `SELECT COALESCE(SUM(coin_balance), 0) AS total_coin
                     FROM my_coins
                     WHERE user_id = ? AND (coin_expire >= NOW() OR coin_expire IS NULL)`,
                    [userId]
                );
                const availableCoins = Math.max(0, Number(coinRows[0]?.total_coin || 0));
                const maxCoins = Math.max(0, Math.floor(((subtotal * maxPercent) / 100) / 0.30));
                coinDiscountAmount = Math.min(Math.floor(availableCoins), maxCoins) * 0.30;
            }
        }

        const totalAmount = Math.max(0, subtotal - appliedDiscount - coinDiscountAmount) + deliveryCharge;

        let effectivePaymentMethod = String(payment_method || 'cod').toLowerCase();
        if (effectivePaymentMethod === 'cod' && Number(product.cod_available) === 0) {
            effectivePaymentMethod = 'online';
        }

        const gatewayUsed = effectivePaymentMethod === 'online'
            ? String(selected_gateway || 'bkash').toLowerCase()
            : null;

        if (effectivePaymentMethod === 'online' && gatewayUsed !== 'bkash') {
            return res.status(400).json({ success: false, message: 'বর্তমানে শুধু bKash online payment available.' });
        }

        const resolveLocationName = (value, type) => {
            const raw = String(value ?? '').trim();
            const maps = {
                division: { '6': 'Dhaka' },
                district: { '43': 'Narayanganj' },
                upazilla: { '331': 'Rupganj' }
            };
            return maps[type]?.[raw] || raw;
        };

        const shippingParts = [
            orderBlockHouse,
            orderUnion,
            resolveLocationName(orderUpazilla, 'upazilla'),
            resolveLocationName(orderDistrict, 'district'),
            resolveLocationName(orderDivision, 'division')
        ].filter(Boolean);
        const shippingAddress = shippingParts.join(', ') + (orderPostCode ? `, Post Code: ${orderPostCode}` : '');

        const orderId = 'NXK-' + Date.now().toString().slice(-8) + Math.floor(100 + Math.random() * 900);
        const paymentStatus = effectivePaymentMethod === 'online' ? 'Pending Payment' : 'Pending';

        const hasCouponDiscount = await hasTableColumn('orders', 'coupon_discount');
        const hasCoinDiscount = await hasTableColumn('orders', 'coin_discount');

        const columns = [
            'order_id', 'user_id', 'product_id', 'seller_id', 'quantity', 'variant',
            'subtotal_price', 'delivery_charge', 'discount_amount', 'total_amount',
            'payment_method', 'selected_gateway', 'payment_status', 'order_status',
            'customer_name', 'customer_email', 'customer_phone', 'shipping_address',
            'vat_cm', 'qtyCalculate', 'sendMail', 'created_at'
        ];
        const values = [
            orderId, userId, product.id, sellerId, orderQty, variant || null,
            subtotal, deliveryCharge, appliedDiscount + coinDiscountAmount, totalAmount,
            effectivePaymentMethod, gatewayUsed, paymentStatus, 'Pending',
            orderName, orderEmail || null, orderPhone, shippingAddress,
            0, 0, 0, new Date()
        ];
        if (hasCouponDiscount) {
            columns.push('coupon_discount');
            values.push(appliedDiscount);
        }
        if (hasCoinDiscount) {
            columns.push('coin_discount');
            values.push(coinDiscountAmount);
        }

        await db.query(
            `INSERT INTO orders (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
            values
        );

        // COD: finalize immediately.
        if (effectivePaymentMethod === 'cod') {
            const [rows] = await db.query('SELECT * FROM orders WHERE order_id = ? LIMIT 1', [orderId]);
            if (!rows.length) throw new Error('Order created but could not be loaded.');

            await finalizeSuccessfulOrder(rows[0], 'unpaid');

            try {
                await sendInvoiceEmail({
                    order_id: orderId,
                    customer_name: orderName,
                    customer_email: orderEmail,
                    customer_phone: orderPhone,
                    shipping_address: shippingAddress,
                    payment_method: 'cod',
                    selected_gateway: null,
                    payment_status: 'Pending',
                    quantity: orderQty,
                    variant,
                    subtotal_price: subtotal,
                    delivery_charge: deliveryCharge,
                    total_amount: totalAmount
                }, product.title);
            } catch (e) {
                console.error('COD invoice email error:', e);
            }

            return res.json({
                success: true,
                message: 'Order placed successfully with Cash on Delivery',
                order_id: orderId,
                payment_type: 'unpaid'
            });
        }

        // Online bKash: payment must be completed before stock is deducted.
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
        } catch (e) {
            console.error('bKash Create Payment Error:', e.response?.data || e.message);
            try {
                await db.query('UPDATE orders SET payment_status = ? WHERE order_id = ?', ['Failed', orderId]);
            } catch (_) {}
            const message = e.response?.data?.statusMessage || e.response?.data?.message || e.message || 'Unknown bKash error';
            return res.status(502).json({ success: false, message: 'bKash payment শুরু করা যায়নি: ' + message });
        }
    } catch (error) {
        console.error("Place Order Error:", error);
        return res.status(500).json({
            success: false,
            message: 'Order Error: ' + (error.message || 'Unknown server error')
        });
    }
});

// ==================== [ BKASH CALLBACK ] ====================
router.get('/bkash/callback', async (req, res) => {
    const baseUrl = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
    const returnUrl = BKASH_CONFIG.RETURN_URL || `${baseUrl}/user/dashboard`;
    const redirect = (status, orderId, extra='') =>
        res.redirect(`${returnUrl}${returnUrl.includes('?') ? '&' : '?'}payment=${status}&order_id=${encodeURIComponent(orderId || '')}${extra}`);

    try {
        const { order_id, paymentID, status } = req.query;
        if (!order_id) return redirect('failed', '');

        const [orders] = await db.query('SELECT * FROM orders WHERE order_id = ? LIMIT 1', [order_id]);
        if (!orders.length) return redirect('failed', order_id);

        const order = orders[0];
        if (String(order.payment_status || '').toLowerCase() === 'complete') {
            return redirect('success', order_id);
        }

        if (String(status || '').toLowerCase() !== 'success' || !paymentID) {
            await db.query('UPDATE orders SET payment_status = ? WHERE order_id = ?', ['Failed', order_id]);
            return redirect('failed', order_id);
        }

        const executeResult = await executeBkashPayment(paymentID);
        let finalPayment = executeResult;
        const executedStatus = String(executeResult?.transactionStatus || '').toLowerCase();

        if (executedStatus !== 'completed' && executedStatus !== 'success') {
            finalPayment = await queryBkashPayment(paymentID);
        }

        const finalStatus = String(finalPayment?.transactionStatus || '').toLowerCase();
        const finalAmount = Number(finalPayment?.amount || executeResult?.amount || 0);
        const expectedAmount = Number(order.total_amount || 0);
        const trxID = finalPayment?.trxID || executeResult?.trxID || null;

        if ((finalStatus === 'completed' || finalStatus === 'success') && Math.abs(finalAmount - expectedAmount) < 0.01) {
            await finalizeSuccessfulOrder(order, 'paid', { paymentID, trxID });

            try {
                await sendInvoiceEmail({
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
                }, `Order #${order.order_id}`);
            } catch (e) {
                console.error('bKash invoice email error:', e);
            }

            return redirect('success', order_id, `&trxID=${encodeURIComponent(trxID || '')}`);
        }

        await db.query('UPDATE orders SET payment_status = ? WHERE order_id = ?', ['Failed', order_id]);
        return redirect('failed', order_id);
    } catch (error) {
        console.error('bKash Callback Error:', error.response?.data || error.message);
        return redirect('failed', req.query.order_id || '');
    }
});

// Backward-compatible route.
router.get('/bkash-success', (req, res) => {
    const baseUrl = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
    const returnUrl = BKASH_CONFIG.RETURN_URL || `${baseUrl}/user/dashboard`;
    const orderId = req.query.order_id || '';
    return res.redirect(`${returnUrl}${returnUrl.includes('?') ? '&' : '?'}payment=pending&order_id=${encodeURIComponent(orderId)}`);
});

// PaySuite Callback Route
router.post('/paysuite-callback', async (req, res) => {
    try {
        const { order_id, transaction_id, status } = req.body;

        if (status === 'success' || status === 'COMPLETED') {
            await db.query(
                `UPDATE orders SET payment_status = 'Paid', order_status = 'Processing' WHERE order_id = ?`,
                [order_id]
            );
            return res.redirect('/user/dashboard?payment=success');
        } else {
            await db.query(
                `UPDATE orders SET payment_status = 'Failed' WHERE order_id = ?`,
                [order_id]
            );
            return res.redirect('/user/dashboard?payment=failed');
        }
    } catch (error) {
        console.error("Callback Error:", error);
        return res.status(500).send("Internal Server Error");
    }
});

// BDGate Callback & Status Verification Route
router.all('/bdgate-callback', async (req, res) => {
    try {
        const order_id = req.body.order_id || req.query.order_id || req.body.slug || req.query.slug;
        const status = req.body.status || req.query.status;

        if (status === 'success' || status === 'COMPLETED' || status === 'PAID') {
            await db.query(
                `UPDATE orders SET payment_status = 'Paid', order_status = 'Processing' WHERE order_id = ?`,
                [order_id]
            );
            return res.redirect('/user/dashboard?payment=success');
        } else {
            // Alternatively, verify via verification endpoint if status isn't directly passed
            try {
                const verifyRes = await axios.post(`${process.env.BDGATE_API_URL}/payment/verify`, {
                    order_id: order_id
                }, {
                    headers: { 'Authorization': `Bearer ${process.env.BDGATE_API_KEY}` }
                });

                if (verifyRes.data && (verifyRes.data.status === 'success' || verifyRes.data.status === 'PAID')) {
                    await db.query(
                        `UPDATE orders SET payment_status = 'Paid', order_status = 'Processing' WHERE order_id = ?`,
                        [order_id]
                    );
                    return res.redirect('/user/dashboard?payment=success');
                }
            } catch (vErr) {
                console.error("BDGate Verification Error:", vErr.message);
            }

            await db.query(
                `UPDATE orders SET payment_status = 'Failed' WHERE order_id = ?`,
                [order_id]
            );
            return res.redirect('/user/dashboard?payment=failed');
        }
    } catch (error) {
        console.error("BDGate Callback Error:", error);
        return res.status(500).send("Internal Server Error");
    }
});

// PaySuite এর একটিভ গেটওয়েগুলো ফেচ করার রাউট
router.get('/get-paysuite-gateways', async (req, res) => {
    try {
        const result = await getPaySuiteGateways();
        return res.json(result);
    } catch (error) {
        console.error("Gateway Fetch Error:", error);
        return res.status(500).json({ success: false, message: 'Failed to fetch gateways' });
    }
});

module.exports = router;