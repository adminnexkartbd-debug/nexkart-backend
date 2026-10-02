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


// ============================================================
// Order financial helpers: commission + coupon + coin ledger
// ============================================================
async function hasTableColumn(tableName, columnName) {
    const [rows] = await db.query(
        `SELECT COUNT(*) AS cnt FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
        [tableName, columnName]
    );
    return Number(rows[0]?.cnt || 0) > 0;
}

async function getAvailableCoins(userId) {
    if (!userId) return 0;
    const [rows] = await db.query(
        `SELECT
            COALESCE(SUM(CASE WHEN coin_balance > 0
                AND (coin_expire >= CURDATE() OR coin_expire IS NULL)
                THEN coin_balance ELSE 0 END), 0) AS earned_coins,
            COALESCE(SUM(CASE WHEN coin_balance < 0 THEN coin_balance ELSE 0 END), 0) AS used_coins
         FROM my_coins WHERE user_id = ?`,
        [userId]
    );
    return Math.max(0, Math.floor(Number(rows[0]?.earned_coins || 0) + Number(rows[0]?.used_coins || 0)));
}

async function getCommissionRate() {
    const [rows] = await db.query('SELECT commission_rate FROM commission ORDER BY id DESC LIMIT 1');
    return Math.max(0, Number(rows[0]?.commission_rate || 0));
}

async function recordOrderCommission({ orderId, sellerId, subtotal, paymentType }) {
    const commissionRate = await getCommissionRate();
    const commissionAmount = Math.max(0, Number(subtotal || 0) * commissionRate / 100);
    const hasPaymentType = await hasTableColumn('commission_table', 'payment_type');
    const [existing] = await db.query('SELECT id FROM commission_table WHERE order_number = ? LIMIT 1', [orderId]);

    if (existing.length) {
        if (hasPaymentType) {
            await db.query(`UPDATE commission_table
                SET commission_rate = ?, commission_amount = ?, seller_id = ?, payment_type = ?
                WHERE order_number = ?`, [commissionRate, commissionAmount, sellerId, paymentType, orderId]);
        } else {
            await db.query(`UPDATE commission_table
                SET commission_rate = ?, commission_amount = ?, seller_id = ?
                WHERE order_number = ?`, [commissionRate, commissionAmount, sellerId, orderId]);
        }
        return { commissionRate, commissionAmount };
    }

    if (hasPaymentType) {
        await db.query(`INSERT INTO commission_table
            (order_number, commission_rate, commission_amount, seller_id, payment_type, date)
            VALUES (?, ?, ?, ?, ?, NOW())`, [orderId, commissionRate, commissionAmount, sellerId, paymentType]);
    } else {
        await db.query(`INSERT INTO commission_table
            (order_number, commission_rate, commission_amount, seller_id, date)
            VALUES (?, ?, ?, ?, NOW())`, [orderId, commissionRate, commissionAmount, sellerId]);
    }
    return { commissionRate, commissionAmount };
}

async function recordCoinUsage({ userId, orderId, coinDiscount }) {
    const discount = Number(coinDiscount || 0);
    if (!userId || discount <= 0) return 0;

    const COIN_VALUE = 0.30;
    const coinsUsed = Math.max(0, Math.round(discount / COIN_VALUE));
    if (!coinsUsed) return 0;

    const source = `Coin Discount - Order ${orderId}`;
    const [existing] = await db.query(
        `SELECT id FROM my_coins
         WHERE user_id = ? AND coin_source = ? AND coin_balance = ? LIMIT 1`,
        [userId, source, -coinsUsed]
    );
    if (existing.length) return coinsUsed;

    const availableCoins = await getAvailableCoins(userId);
    if (availableCoins < coinsUsed) {
        throw new Error(`Not enough coins. Required: ${coinsUsed}, available: ${availableCoins}.`);
    }

    // NEVER update/delete the original earned coin rows. Add a negative ledger row.
    await db.query(
        `INSERT INTO my_coins
            (user_id, coin_balance, coin_expire, coin_create_date, coin_source)
         VALUES (?, ?, NULL, NOW(), ?)`,
        [userId, -coinsUsed, source]
    );
    console.log(`[Coin] user=${userId}, order=${orderId}, used=${coinsUsed}, remaining=${availableCoins - coinsUsed}`);
    return coinsUsed;
}

async function finalizeOrderFinancials(orderId, paymentType) {
    const [rows] = await db.query('SELECT * FROM orders WHERE order_id = ? LIMIT 1', [orderId]);
    if (!rows.length) throw new Error(`Order ${orderId} not found.`);
    const order = rows[0];

    await recordCoinUsage({
        userId: order.user_id,
        orderId: order.order_id,
        coinDiscount: order.coin_discount
    });

    await recordOrderCommission({
        orderId: order.order_id,
        sellerId: order.seller_id,
        subtotal: order.subtotal_price,
        paymentType
    });
    return order;
}

// অর্ডার প্লেস করার রাউট হ্যান্ডলার (PaySuite এবং BDGate সাপোর্টসহ)
router.post('/place-order', async (req, res) => {
    try {
        const userId = req.user ? req.user.id : (req.session && req.session.user ? req.session.user.id : null);
        if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized!' });

        const {
            product_id, quantity, variant, payment_method, selected_gateway,
            name, email, phone, division, district, upazilla, union_area, post_code, block_house,
            discount_amount, coupon_code, use_coins
        } = req.body;
        const orderQty = Math.max(1, parseInt(quantity, 10) || 1);

        // Checkout may send public product_id (e.g. NK-PROD-5138) or numeric id.
        // orders.product_id is INT, so ALWAYS save products.id.
        const [productRows] = await db.query(
            'SELECT * FROM products WHERE id = ? OR product_id = ? LIMIT 1',
            [product_id, product_id]
        );
        if (!productRows.length) return res.status(404).json({ success: false, message: 'Product not found!' });
        const product = productRows[0];

        const salePrice = parseFloat(product.sale_price || 0);
        const subtotal_price = salePrice * orderQty;
        let delivery_charge = Number(product.delivery_charge) || 60;
        const delivery_limit = Number(product.delivery_limit) || 1;
        if (Number(product.free_shipping) === 1) delivery_charge = 0;
        else if (delivery_limit > 0 && delivery_charge > 0) delivery_charge *= Math.ceil(orderQty / delivery_limit);

        // Coupon is verified server-side.
        let couponDiscount = 0;
        if (coupon_code) {
            const [coupons] = await db.query('SELECT * FROM coupons WHERE coupon_name = ? LIMIT 1', [String(coupon_code).trim()]);
            if (coupons.length) {
                const coupon = coupons[0];
                const isGlobal = !coupon.product_id || coupon.product_id === '' || coupon.product_id == 0;
                const isMatched = coupon.product_id == product.id || coupon.product_id === product.product_id;
                const notExpired = !coupon.expiry_date || new Date(coupon.expiry_date) >= new Date();
                if ((isGlobal || isMatched) && notExpired) couponDiscount = Math.max(0, Number(coupon.discount_amount) || 0);
            }
        } else {
            couponDiscount = Math.max(0, Number(discount_amount) || 0);
        }
        couponDiscount = Math.min(couponDiscount, subtotal_price);

        // Coin offer: only non-expired coins owned by THIS user are available.
        let coinDiscount = 0;
        const wantsCoins = use_coins === true || use_coins === 'true' || use_coins === 1 || use_coins === '1';
        if (wantsCoins && String(product.coin_offer || '').toLowerCase() === 'yes') {
            const maxCoinPercent = Math.max(0, Number(product.coin_percentage_value) || 0);
            if (maxCoinPercent > 0) {
                const availableCoins = await getAvailableCoins(userId);
                const maxDiscountByPercent = subtotal_price * maxCoinPercent / 100;
                const maxCoinsAllowed = Math.max(0, Math.floor(maxDiscountByPercent / 0.30));
                const coinsUsed = Math.min(availableCoins, maxCoinsAllowed);
                coinDiscount = coinsUsed * 0.30;
            }
        }

        const total_amount = Math.max(0, subtotal_price - couponDiscount - coinDiscount) + delivery_charge;
        const generatedOrderId = 'NXK-' + Date.now().toString().slice(-8) + Math.floor(100 + Math.random() * 900);
        const shipping_address = `${block_house || ''}, ${union_area || ''}, ${upazilla || ''}, ${district || ''}, ${division || ''} - ${post_code || ''}`;
        const sellerId = product.admin_id || 1;

        const hasCouponDiscount = await hasTableColumn('orders', 'coupon_discount');
        const hasCoinDiscount = await hasTableColumn('orders', 'coin_discount');
        const orderColumns = [
            'order_id','user_id','product_id','seller_id','quantity','variant','subtotal_price','delivery_charge',
            'discount_amount','total_amount','payment_method','selected_gateway','payment_status','order_status',
            'customer_name','customer_email','customer_phone','shipping_address','created_at'
        ];
        const orderValues = [
            generatedOrderId,userId,product.id,sellerId,orderQty,variant || '',subtotal_price,delivery_charge,
            couponDiscount + coinDiscount,total_amount,payment_method || 'cod',selected_gateway || 'cod','Pending','Pending',
            name,email,phone,shipping_address,new Date()
        ];
        if (hasCouponDiscount) { orderColumns.push('coupon_discount'); orderValues.push(couponDiscount); }
        if (hasCoinDiscount) { orderColumns.push('coin_discount'); orderValues.push(coinDiscount); }

        const insertQuery = `INSERT INTO orders (${orderColumns.join(', ')}) VALUES (${orderColumns.map(() => '?').join(', ')})`;

        if (payment_method === 'paysuite') {
            const result = await createPaySuitePayment({ order_id: generatedOrderId, name, email, phone, selected_gateway }, total_amount);
            if (!result.success) return res.status(400).json({ success:false, message:result.message });
            await db.query(insertQuery, orderValues);
            return res.json({ success:true, payment_url:result.payment_url, order_id:generatedOrderId, selected_gateway });
        }

        if (payment_method === 'bdgate') {
            const result = await createBDGatePayment({ order_id: generatedOrderId, name, email, phone, selected_gateway }, total_amount);
            if (!result.success) return res.status(400).json({ success:false, message:result.message });
            await db.query(insertQuery, orderValues);
            return res.json({ success:true, payment_url:result.payment_url, order_id:generatedOrderId, selected_gateway });
        }

        await db.query(insertQuery, orderValues);

        // COD is finalized immediately: commission + coin deduction happen now.
        await finalizeOrderFinancials(generatedOrderId, 'unpaid');

        return res.json({
            success:true,
            message:'Order placed successfully with Cash on Delivery',
            order_id:generatedOrderId,
            coupon_discount:couponDiscount,
            coin_discount:coinDiscount
        });
    } catch (error) {
        console.error('Place Order Error:', error);
        return res.status(500).json({ success:false, message:error.message || 'Server error while placing order!' });
    }
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
            try { await finalizeOrderFinancials(order_id, 'paid'); } catch (financialError) { console.error('[Order Financials] PaySuite:', financialError); }
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
                    try { await finalizeOrderFinancials(order_id, 'paid'); } catch (financialError) { console.error('[Order Financials] BDGate:', financialError); }
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