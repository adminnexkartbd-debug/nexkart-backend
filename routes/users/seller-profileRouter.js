const express = require('express');
const router = express.Router();
const path = require('path');
const db = require('../../db'); // ডাটাবেজ কানেকশন

// ১. Visit Store পেজ রাউট
router.get('/store/:id', (req, res) => {
    try {
        res.sendFile(path.join(process.cwd(), 'public', 'users', 'seller-profile.html'));
    } catch (err) {
        console.error("HTML File Send Error:", err);
        res.status(500).send("Server Error loading page");
    }
});

// ২. সেলারকে মেসেজ পাঠানোর রাউট
router.post('/send-seller-message', async (req, res) => {
    try {
        const { seller_id, message } = req.body;
        
        if (!seller_id || !message) {
            return res.status(400).json({ success: false, message: 'Seller ID and message are required!' });
        }

        const userId = req.user ? req.user.id : (req.session && req.session.user ? req.session.user.id : (req.session && req.session.userId ? req.session.userId : null));
        
        let customerName = 'Guest User';
        let customerImage = null;

        if (userId) {
            const [users] = await db.query('SELECT name, profile_image FROM users WHERE id = ?', [userId]);
            if (users && users.length > 0) {
                customerName = users[0].name || 'User';
                customerImage = users[0].profile_image || null;
            }
        }

        const query = `INSERT INTO seller_messages (seller_id, customer_id, customer_name, customer_image, sms_text, status, sms_send_time) VALUES (?, ?, ?, ?, ?, 'Pending', NOW())`;
        await db.query(query, [seller_id, userId || null, customerName, customerImage, message]);

        return res.json({
            success: true,
            message: 'সেলারকে সফলভাবে মেসেজ পাঠানো হয়েছে!'
        });

    } catch (error) {
        console.error("Send Seller Message Error:", error);
        return res.status(500).json({ success: false, message: 'Server error while sending message!' });
    }
});

// ৩. সেলার প্রোফাইল ও প্রোডাক্ট ডাটা লোড করার রাউট
router.get('/api/seller-data/:id', async (req, res) => {
    try {
        const sellerId = req.params.id;
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 8;
        const offset = (page - 1) * limit;

        if (!sellerId || isNaN(sellerId)) {
            return res.status(400).json({ success: false, message: 'Invalid Seller ID' });
        }

        const [admins] = await db.query(`
            SELECT id AS seller_id, shop_name AS seller_shop_name, slogan AS seller_slogan, 
                   IFNULL(shop_about, '') AS shop_about, status AS seller_status, picture AS seller_picture,
                   is_verified
            FROM admins WHERE id = ? LIMIT 1
        `, [sellerId]);

        if (!admins || admins.length === 0) {
            return res.status(404).json({ success: false, message: 'Seller not found!' });
        }

        // Total count of products
        const [totalCountResult] = await db.query(`
            SELECT COUNT(*) as total FROM products WHERE admin_id = ?
        `, [sellerId]);
        const totalProducts = totalCountResult[0].total || 0;

        // Overall Seller Rating Query (Match via p.id OR p.product_id)
        const [overallRatingResult] = await db.query(`
            SELECT 
                IFNULL(ROUND(AVG(r.rating), 1), 0) AS seller_avg_rating,
                COUNT(r.id) AS seller_total_reviews
            FROM products p
            INNER JOIN product_reviews r ON (p.id = r.product_id OR p.product_id = r.product_id)
            WHERE p.admin_id = ?
        `, [sellerId]);

        const sellerRatingInfo = overallRatingResult[0] || { seller_avg_rating: 0, seller_total_reviews: 0 };

        // Product query
        const [sellerProducts] = await db.query(`
            SELECT 
                p.id, 
                p.product_id, 
                p.title, 
                p.regular_price, 
                p.sale_price, 
                p.old_price,
                p.stock_quantity, 
                p.stock_status,
                (
                    SELECT image_path 
                    FROM product_images 
                    WHERE product_id = p.id 
                    ORDER BY id ASC LIMIT 1
                ) AS primary_image,
                IFNULL(ROUND(AVG(r.rating), 1), 0) AS avg_rating,
                COUNT(r.id) AS total_reviews
            FROM products p
            LEFT JOIN product_reviews r ON (p.id = r.product_id OR p.product_id = r.product_id)
            WHERE p.admin_id = ?
            GROUP BY p.id
            ORDER BY p.id DESC
            LIMIT ? OFFSET ?
        `, [sellerId, limit, offset]);

        const hasMore = (offset + sellerProducts.length) < totalProducts;

        return res.json({
            success: true,
            seller: admins[0],
            seller_rating: sellerRatingInfo.seller_avg_rating,
            seller_reviews_count: sellerRatingInfo.seller_total_reviews,
            seller_products: sellerProducts || [],
            has_more: hasMore,
            total_products: totalProducts
        });

    } catch (error) {
        console.error("❌ Seller Profile Fetch Error:", error);
        return res.status(500).json({ success: false, message: 'Internal Server Error' });
    }
});

module.exports = router;