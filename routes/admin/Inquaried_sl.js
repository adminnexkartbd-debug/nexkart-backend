const express = require('express');
const router = express.Router();
const db = require('../../db');

// ১. শুধুমাত্র বর্তমান লগইন করা অ্যাডমিনের প্রোডাক্টগুলোর ইনকোয়ারি নিয়ে আসার রাউট
router.get('/all', async (req, res) => {
    try {
        // সেশন বা অথেন্টিকেশন থেকে কারেন্ট অ্যাডমিনের আইডি বের করা (আপনার প্রজেক্টের নিয়ম অনুযায়ী)
        const currentAdminId = req.session && req.session.user ? req.session.user.id : (req.user ? req.user.id : null);

        const query = `
            SELECT pi.*, 
                   COALESCE(p.title, 'Unknown Product') as product_title, 
                   p.sku, 
                   p.regular_price, 
                   p.sale_price,
                   p.admin_id
            FROM product_inquiries pi
            INNER JOIN products p ON pi.product_id = p.id OR pi.product_id = p.product_id
            WHERE p.admin_id = ?
            ORDER BY pi.created_at DESC
        `;
        
        const [inquiries] = await db.query(query, [currentAdminId]);

        res.status(200).json({ success: true, inquiries });
    } catch (error) {
        console.error("Fetch Inquiries Error:", error);
        res.status(500).json({ success: false, message: 'Server Error' });
    }
});

// ২. ইনকোয়ারির বিপরীতে অ্যাডমিনের রিপ্লাই বা অ্যানসার আপডেট করার রাউট
router.put('/reply/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { answer } = req.body;

        const query = `UPDATE product_inquiries SET answer = ? WHERE id = ?`;
        await db.query(query, [answer, id]);

        res.status(200).json({ success: true, message: 'Reply sent successfully' });
    } catch (error) {
        console.error("Reply Error:", error);
        res.status(500).json({ success: false, message: 'Failed to send reply' });
    }
});

// ৩. বর্তমান অ্যাডমিনের প্রোডাক্টগুলোর মধ্যে যে ইনকোয়ারিগুলোতে এখনো কোনো রিপ্লাই দেওয়া হয়নি, সেগুলোর সংখ্যা কাউন্ট করার রাউট
router.get('/pending-count', async (req, res) => {
    try {
        const currentAdminId = req.session && req.session.user ? req.session.user.id : (req.user ? req.user.id : null);

        const query = `
            SELECT COUNT(pi.id) as pending_count
            FROM product_inquiries pi
            INNER JOIN products p ON pi.product_id = p.id OR pi.product_id = p.product_id
            WHERE (pi.answer IS NULL OR pi.answer = '') AND p.admin_id = ?
        `;
        
        const [rows] = await db.query(query, [currentAdminId]);
        const pendingCount = rows[0] ? rows[0].pending_count : 0;

        res.status(200).json({ success: true, pendingCount });
    } catch (error) {
        console.error("Pending Count Error:", error);
        res.status(500).json({ success: false, message: 'Server Error' });
    }
});

module.exports = router;