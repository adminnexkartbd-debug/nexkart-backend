const express = require('express');
const router = express.Router();
const db = require('../../db'); // আপনার প্রজেক্টের পাথ অনুযায়ী ঠিক করে নিবেন

router.post('/verify-pin', async (req, res) => {
    try {
        const { pin } = req.body;

        if (pin === undefined || pin === null || pin === '') {
            return res.status(400).json({ success: false, message: 'Pin number is required.' });
        }

        const query = `SELECT secreat_code_admin FROM secreat LIMIT 1`;
        const [results] = await db.query(query);

        if (!results || results.length === 0) {
            return res.status(404).json({ success: false, message: 'Secret code configuration not found in database.' });
        }

        // ডাটাবেজের ভ্যালু এবং ইউজার ইনপুট উভয়কেই Number বা Integer এ রূপান্তর করে নিখুঁত তুলনা
        const dbPin = Number(results[0].secreat_code_admin);
        const userPin = Number(pin);

        if (dbPin === userPin) {
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