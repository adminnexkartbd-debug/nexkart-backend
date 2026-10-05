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

// NOTE: /place-order is handled by users.js. The duplicate legacy route was removed
// to prevent the old BDGate implementation from intercepting checkout requests.

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

// Legacy BDGate callback compatibility route. New checkout uses /bdgate/webhook
// and /bdgate/success from users.js. Keep this endpoint only so old BDGate
// configurations do not write an inconsistent 'Paid' status themselves.
router.all('/bdgate-callback', async (req, res) => {
    const orderId = String(req.body?.order_id || req.query?.order_id || req.body?.slug || req.query?.slug || '').trim();
    const baseUrl = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
    if (!orderId) {
        return res.redirect(`${baseUrl}/user/dashboard?payment=pending`);
    }
    return res.redirect(`${baseUrl}/user/bdgate/success?order_id=${encodeURIComponent(orderId)}`);
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