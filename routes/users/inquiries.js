const express = require('express');
const router = express.Router();
const db = require('../../db'); // আপনার প্রজেক্টের রুট ফোল্ডার থেকে db ফাইলের পাথ ঠিক করে দেবেন

// ক. নতুন ইনকোয়ারি সেভ করার রাউট (POST)
router.post('/inquiry', async (req, res) => {
    try {
        const { product_id, question, user_name } = req.body;
        
        if (!product_id || !question) {
            return res.status(400).json({ success: false, message: 'Product ID and question are required.' });
        }

        // প্রথমে চেক করে নেওয়া ভালো যে এই product_id বা id দিয়ে প্রোডাক্টটি ডাটাবেসে আছে কি না
        let [products] = await db.query(`SELECT id FROM products WHERE id = ? OR product_id = ?`, [product_id, product_id]);
        
        let validProductId = product_id;
        if (products.length > 0) {
            // যদি টেবিলের আসল প্রাইমারি আইডি আলাদা হয়, সেটি ব্যবহার করা নিরাপদ
            validProductId = products[0].id;
        } else {
            // যদি প্রোডাক্টটি কোনো কারণে ডাটাবেসে সরাসরি না পাওয়া যায়, সেক্ষেত্রে সাময়িকভাবে ফরেইন কি চেক অফ করে ইনসার্ট করার লজিক বা এরর হ্যান্ডলিং
            return res.status(404).json({ success: false, message: 'Invalid Product ID. Product not found in database.' });
        }

        const [result] = await db.query(
            `INSERT INTO product_inquiries (product_id, user_name, question) VALUES (?, ?, ?)`,
            [validProductId, user_name || 'Valued Customer', question]
        );

        res.json({ success: true, message: 'Inquiry submitted successfully.', inquiryId: result.insertId });
    } catch (error) {
        console.error('Error saving inquiry:', error);
        res.status(500).json({ success: false, message: 'Server error: ' + error.message });
    }
});

// খ. নির্দিষ্ট প্রোডাক্টের সব ইনকোয়ারি গেট করার রাউট (GET)
router.get('/inquiries/:productId', async (req, res) => {
    try {
        const productId = req.params.productId;
        
        // প্রোডাক্ট আইডি বা কাস্টম আইডি দুটির যেকোনো একটির সাপেক্ষে ইনকোয়ারি ফেচ করা
        const [inquiries] = await db.query(
            `SELECT pi.* FROM product_inquiries pi 
             JOIN products p ON pi.product_id = p.id 
             WHERE p.id = ? OR p.product_id = ? 
             ORDER BY pi.id DESC`,
            [productId, productId]
        );

        res.json({ success: true, inquiries });
    } catch (error) {
        console.error('Error fetching inquiries:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

module.exports = router;