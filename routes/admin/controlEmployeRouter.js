const express = require('express');
const router = express.Router();

// Apnar database file er sothik path ekhane din. 
// Jodi database connection file 'src/config/db.js' e thake, tabe '../../config/db' din.
// Jodi root folder e thake, tabe onno path hote pare.
let db;
try {
    db = require('../../db'); // Proyojonmoto path poriborton korun (e.g., '../../config/db')
} catch (e) {
    console.error('Database module load error:', e.message);
}

/**
 * @route   POST /api/control-employee/verify-pin
 * @desc    Verify entered admin pin against 'secreat' table 'secreat_code_admin'
 */
router.post('/verify-pin', async (req, res) => {
    try {
        const { pin } = req.body;

        if (!pin) {
            return res.status(400).json({ success: false, message: 'Pin number is required.' });
        }

        // Fallback jodi db undefined thake
        const activeDb = db || req.app.get('db');
        if (!activeDb) {
            console.error('Database connection is not initialized or exported properly.');
            return res.status(500).json({ success: false, message: 'Database connection error on server.' });
        }

        const query = `SELECT secreat_code_admin FROM secreat LIMIT 1`;

        activeDb.query(query, (err, results) => {
            if (err) {
                console.error('Database error fetching secret code:', err);
                return res.status(500).json({ success: false, message: 'Internal server error' });
            }

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
        });

    } catch (error) {
        console.error('Server error in /verify-pin:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

module.exports = router;