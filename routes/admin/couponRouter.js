const express = require('express');
const router = express.Router();
//const db = require('../../server'); // আপনার ডাটাবেজ কানেকশন পাথ ঠিক করে নিন
const db = require('../../db');

// ১. ড্রপডাউনের জন্য প্রোডাক্ট লিস্ট ফেচ করা
router.get('/api/products-list', ensureActiveAdmin, async (req, res) => {
    try {
        const currentAdminId = req.user.id;
        const [products] = await db.query(
            'SELECT product_id, title FROM products WHERE admin_id = ?',
            [currentAdminId]
        );
        res.status(200).json({ success: true, products });
    } catch (err) {
        console.error('Products Fetch Error:', err);
        res.status(500).json({ success: false, message: "প্রোডাক্ট লিস্ট লোড করতে সমস্যা হয়েছে!" });
    }
});

// ২. কারেন্ট অ্যাডমিনের কুপনগুলো লিস্ট আকারে ফেচ করার রাউট
// ২. কারেন্ট অ্যাডমিনের কুপনগুলো লিস্ট আকারে ফেচ করার রাউট
router.get('/api/coupons-list', ensureActiveAdmin, async (req, res) => {
    try {
        const currentAdminId = req.user.id;
        
        const query = `
            SELECT c.* FROM coupons c
            LEFT JOIN products p ON c.product_id = p.product_id
            WHERE p.admin_id = ? OR c.product_id IN (SELECT product_id FROM products WHERE admin_id = ?)
            ORDER BY c.id DESC
        `;
        const [coupons] = await db.query(query, [currentAdminId, currentAdminId]);

        res.status(200).json({ success: true, coupons });
    } catch (err) {
        console.error('Coupons Fetch Error:', err);
        res.status(500).json({ success: false, message: "কুপন লিস্ট লোড করতে সমস্যা হয়েছে!" });
    }
});

// ৩. কুপন সেভ করার রাউট
router.post('/api/coupon/create', ensureActiveAdmin, async (req, res) => {
    try {
        const { coupon_name, discount_amount, expiry_date, coupon_scope, product_id } = req.body;
        
        if (!product_id || product_id === "") {
            return res.status(400).json({ success: false, message: "দয়া করে একটি প্রোডাক্ট সিলেক্ট করুন!" });
        }
        
        const [productRows] = await db.query('SELECT title FROM products WHERE product_id = ?', [product_id]);
        
        if (productRows.length === 0) {
            return res.status(400).json({ success: false, message: "সঠিক প্রোডাক্ট পাওয়া যায়নি!" });
        }
        
        const productName = productRows[0].title;

        const query = `
            INSERT INTO coupons (coupon_name, discount_amount, expiry_date, coupon_scope, product_id, product_name)
            VALUES (?, ?, ?, ?, ?, ?)
        `;
        
        await db.query(query, [
            coupon_name.toUpperCase(),
            discount_amount,
            expiry_date,
            coupon_scope,
            product_id,
            productName
        ]);

        res.status(200).json({ success: true, message: "কুপন সফলভাবে সেভ হয়েছে!" });
    } catch (err) {
        console.error('Database Insert Error:', err.message);
        res.status(500).json({ success: false, message: `সার্ভার এরর: ${err.message}` });
    }
});

// ৪. কুপন ডিলিট করার রাউট
router.delete('/api/coupon/delete/:id', ensureActiveAdmin, async (req, res) => {
    try {
        const couponId = req.params.id;
        await db.query('DELETE FROM coupons WHERE id = ?', [couponId]);
        res.status(200).json({ success: true, message: "কুপন সফলভাবে মুছে ফেলা হয়েছে!" });
    } catch (err) {
        console.error('Coupon Delete Error:', err);
        res.status(500).json({ success: false, message: "কুপন ডিলিট করতে সমস্যা হয়েছে!" });
    }
});

function ensureActiveAdmin(req, res, next) {
    if (req.isAuthenticated && req.isAuthenticated() && req.user.status === 'approved') {
        return next();
    }
    res.status(401).json({ success: false, message: "অনুমোদিত নয় বা লগইন করা নেই।" });
}

module.exports = router;