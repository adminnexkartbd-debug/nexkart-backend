const express = require('express');
const router = express.Router();
const db = require('../../db'); // আপনার প্রজেক্টের DB কানেকশন পাথ

/**
 * GET: Current Admin-এর প্রোডাক্টের রিভিউ ফেচ করা
 */
router.get('/', async (req, res) => {
    try {
        const adminId = req.user ? req.user.id : req.query.admin_id;

        if (!adminId) {
            return res.status(400).json({ success: false, message: 'Admin ID পাওয়া যায়নি!' });
        }

        // products.admin_id দিয়ে ফিল্টার করে review আনা হচ্ছে
        const query = `
            SELECT 
                pr.id AS review_id,
                pr.rating,
                pr.review_text,
                pr.review_reply,
                pr.status AS review_status,
                pr.created_at AS review_date,
                p.id AS product_id,
                p.title AS product_name,
                p.sale_price,
                p.regular_price,
                u.name AS user_name
            FROM product_reviews pr
            INNER JOIN products p ON pr.product_id = p.id
            LEFT JOIN users u ON pr.user_id = u.id
            WHERE p.admin_id = ?
            ORDER BY pr.created_at DESC
        `;

        const [reviews] = await db.query(query, [adminId]);

        return res.status(200).json({
            success: true,
            data: reviews
        });
    } catch (error) {
        console.error('Error fetching admin product reviews:', error);
        return res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
});

/**
 * POST: Admin Review Reply সেভ/আপডেট করা
 */
router.post('/reply', async (req, res) => {
    try {
        const { review_id, reply_text } = req.body;
        const adminId = req.user ? req.user.id : req.body.admin_id;

        if (!review_id || !reply_text) {
            return res.status(400).json({ success: false, message: 'review_id এবং reply_text দিন' });
        }

        const checkQuery = `
            SELECT pr.id 
            FROM product_reviews pr
            INNER JOIN products p ON pr.product_id = p.id
            WHERE pr.id = ? AND p.admin_id = ?
        `;
        const [existing] = await db.query(checkQuery, [review_id, adminId]);

        if (existing.length === 0) {
            return res.status(403).json({ success: false, message: 'আপনার এই রিভিউতে রিপ্লাই করার অনুমতি নেই!' });
        }

        const updateQuery = `
            UPDATE product_reviews 
            SET review_reply = ? 
            WHERE id = ?
        `;
        await db.query(updateQuery, [reply_text, review_id]);

        return res.status(200).json({
            success: true,
            message: 'রিপ্লাই সফলভাবে সেভ হয়েছে!'
        });
    } catch (error) {
        console.error('Error updating review reply:', error);
        return res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
});

module.exports = router;