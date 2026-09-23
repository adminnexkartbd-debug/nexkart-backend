const express = require('express');
const router = express.Router();
const db = require('../../../db');

 
router.post('/verify-pin', async (req, res) => {
    try {
        const { pin } = req.body;

        if (!pin) {
            return res.status(400).json({ success: false, message: 'Pin number is required.' });
        }

        const query = `SELECT secreat_code_admin FROM secreat LIMIT 1`;
        
        // Promise / Async-Await স্টাইলে কুয়েরি করা হলো (adminReviewRouter.js এর মতো)
        const [results] = await db.query(query);

        if (!results || results.length === 0) {
            return res.status(404).json({ success: false, message: 'Secret code configuration not found in database.' });
        }

        // Clean database value and user input
        const rawDbPin = String(results[0].secreat_code_admin).replace(/,/g, '').trim();
        const cleanUserPin = String(pin).replace(/,/g, '').trim();

        if (rawDbPin === cleanUserPin) {
            if (req.session) {
                req.session.pinVerified = true;
            }
            return res.status(200).json({ success: true, message: 'Pin verified successfully.' });
        } else {
            return res.status(401).json({ success: false, message: 'Incorrect pin number. Please try again.' });
        }

    } catch (error) {
        console.error('Server error in /verify-pin:', error);
        res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
});

module.exports = router;