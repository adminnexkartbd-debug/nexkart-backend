const express = require('express');
const router = express.Router();
const path = require('path');

// 💡 ডাটাবেজ ফাইল ইমপোর্ট
const db = require('../../db'); 

// ==========================================
// ১. AUTHENTICATION MIDDLEWARE
// ==========================================
function ensureActiveSeller(req, res, next) {
    if (req.isAuthenticated && req.isAuthenticated()) {
        return next();
    }
    if (req.session && (req.session.admin || req.session.user)) {
        req.user = req.session.admin || req.session.user;
        return next();
    }
    return res.status(401).json({ success: false, message: "দয়া করে প্রথমে সেলার লগইন করুন।" });
}

// ==========================================
// ৫. API Route: Update Tracking Number
// ==========================================
router.post('/api/update-tracking', ensureActiveSeller, async (req, res) => {
    try {
        const { order_id, tracking_number } = req.body;
        const currentSellerId = req.user ? (req.user.id || req.user.admin_id) : null;

        const updateQuery = `UPDATE orders SET tracking_number = ? WHERE order_id = ? AND seller_id = ?`;
        const [result] = await db.query(updateQuery, [tracking_number, order_id, Number(currentSellerId)]);

        if (result.affectedRows > 0) {
            return res.json({ success: true, message: 'ট্র্যাকিং নম্বর সফলভাবে সেভ হয়েছে।' });
        } else {
            return res.status(403).json({ success: false, message: 'অনুমতি নেই অথবা অর্ডারটি পাওয়া যায়নি।' });
        }
    } catch (error) {
        console.error('Error updating tracking number:', error);
        return res.status(500).json({ success: false, message: 'ট্র্যাকিং নম্বর আপডেট করতে সমস্যা হয়েছে।' });
    }
});
// ==========================================
// ২. HTML Page Render Route
// ==========================================
router.get('/', ensureActiveSeller, (req, res) => {
    res.sendFile(path.join(__dirname, '../../public/admin/order-lists.html'));
});

// ==========================================
// ৩. API Route: Fetch Orders with Product & Seller Info
// ==========================================
router.get('/api/get-orders', ensureActiveSeller, async (req, res) => {
    try {
        const currentSellerId = req.user ? (req.user.id || req.user.admin_id) : null;

        console.log("👉 Current Logged-in Seller ID:", currentSellerId);

        if (!currentSellerId) {
            return res.status(400).json({ 
                success: false, 
                message: "সেলার আইডি পাওয়া যায়নি। অনুগ্রহ করে আবার লগইন করুন।" 
            });
        }

        // 🔥 SQL QUERY: orders.seller_id == admins.id
        // products এবং admins উভয় টেবিলের ডাটা সঠিকভাবে আনার জন্য JOIN করা হয়েছে
        const sqlQuery = `
            SELECT 
                orders.*, 
                products.title AS product_name,
                admins.shop_name AS seller_shop_name,
                admins.phone AS seller_phone,
                admins.address AS seller_address
            FROM orders 
            LEFT JOIN products ON orders.product_id = products.id 
            LEFT JOIN admins ON orders.seller_id = admins.id
            WHERE orders.seller_id = ? 
            ORDER BY orders.created_at DESC
        `;
        
        const [orders] = await db.query(sqlQuery, [Number(currentSellerId)]);

        console.log(`✅ Seller (${currentSellerId}) - Total Orders Found:`, orders.length);

        return res.status(200).json({
            success: true,
            sellerId: currentSellerId,
            totalOrders: orders.length,
            data: orders
        });

    } catch (error) {
        console.error('❌ Database Query Error:', error);
        return res.status(500).json({ 
            success: false, 
            message: 'ডাটাবেজ থেকে অর্ডার ডাটা ফেচ করতে সমস্যা হয়েছে।' 
        });
    }
});

// ==========================================
// ৪. API Route: Update Order Status
// ==========================================
router.post('/api/update-status', ensureActiveSeller, async (req, res) => {
    try {
        const { order_id, order_status } = req.body;
        const currentSellerId = req.user ? (req.user.id || req.user.admin_id) : null;

        const updateQuery = `UPDATE orders SET order_status = ? WHERE order_id = ? AND seller_id = ?`;
        const [result] = await db.query(updateQuery, [order_status, order_id, Number(currentSellerId)]);

        if (result.affectedRows > 0) {
            return res.json({ success: true, message: 'অর্ডার স্ট্যাটাস আপডেট হয়েছে।' });
        } else {
            return res.status(403).json({ success: false, message: 'অনুমতি নেই অথবা অর্ডারটি পাওয়া যায়নি।' });
        }
    } catch (error) {
        console.error('Error updating status:', error);
        return res.status(500).json({ success: false, message: 'স্ট্যাটাস আপডেট করতে সমস্যা হয়েছে।' });
    }
});

module.exports = router;