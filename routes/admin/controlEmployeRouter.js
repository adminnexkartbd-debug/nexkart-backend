const express = the_express = require('express'); // or const express = require('express');
const router = express.Router();
const db = require('../../db'); // সরাসরি রিকোয়ার করুন

router.post('/verify-pin', async (req, res) => {
    try {
        const { pin } = req.body;
        if (!pin) {
            return res.status(400).json({ success: false, message: 'Pin number is required.' });
        }

        const [results] = await db.query(`SELECT secreat_code_admin FROM secreat LIMIT 1`);
        // বাকি কোড...
    } catch (error) {
        console.error('Detailed Server error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

module.exports = router;