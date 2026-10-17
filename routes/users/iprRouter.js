const express = require('express');
const router = express.Router();
const db = require('../../db'); // আপনার DB ফাইল পাথ অনুযায়ী ঠিক রাখুন

// ১. IPR Report জমার সাবমিট API
router.post('/submit', async (req, res) => {
    try {
        const { brand_name, contact_email, infringement_type, product_url, description } = req.body;
        
        // কারেন্ট ইউজারের ID নেওয়ার সেফ হ্যান্ডলিং
        const user_id = req.user 
            ? (req.user.id || req.user.user_id) 
            : (req.session && req.session.user ? req.session.user.id : (req.session && req.session.userId ? req.session.userId : null));

        if (!user_id) {
            return res.status(401).json({ 
                success: false, 
                message: 'Please login to submit an IPR report.' 
            });
        }

        if (!brand_name || !contact_email || !infringement_type || !product_url || !description) {
            return res.status(400).json({ 
                success: false, 
                message: 'All fields are required.' 
            });
        }

        const sql = `
            INSERT INTO ipr_reports (user_id, brand_name, contact_email, infringement_type, product_url, description)
            VALUES (?, ?, ?, ?, ?, ?)
        `;

        await db.execute(sql, [
            user_id, 
            brand_name.trim(), 
            contact_email.trim(), 
            infringement_type, 
            product_url.trim(), 
            description.trim()
        ]);

        return res.status(201).json({ 
            success: true, 
            message: 'Your IPR report has been submitted successfully.' 
        });

    } catch (error) {
        console.error('Error submitting IPR report:', error);
        return res.status(500).json({ 
            success: false, 
            message: 'Internal Server Error' 
        });
    }
});

// ২. শুধুমাত্র কারেন্ট ইউজারের (Log-in User) IPR রিপোর্ট ফেচ করার API
router.get('/my-reports', async (req, res) => {
    try {
        // কারেন্ট ইউজারের ID চেক
        const user_id = req.user 
            ? (req.user.id || req.user.user_id) 
            : (req.session && req.session.user ? req.session.user.id : (req.session && req.session.userId ? req.session.userId : null));

        if (!user_id) {
            return res.status(401).json({ 
                success: false, 
                message: 'Unauthorized. Please log in to view your reports.' 
            });
        }

        // শুধুমাত্র কারেন্ট ইউজারের ডাটাবেস রেকর্ড সিলেক্ট করা হচ্ছে
        const sql = `SELECT * FROM ipr_reports WHERE user_id = ? ORDER BY id DESC`;
        const [rows] = await db.execute(sql, [user_id]);

        return res.status(200).json({
            success: true,
            data: rows
        });
    } catch (error) {
        console.error('Error fetching user IPR reports:', error);
        return res.status(500).json({
            success: false,
            message: 'Internal Server Error'
        });
    }
});

module.exports = router;