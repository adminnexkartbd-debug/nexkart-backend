const express = require('express');
const router = express.Router();

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

        const db = req.app.get('db');
        const query = `SELECT secreat_code_admin FROM secreat LIMIT 1`;

        db.query(query, (err, results) => {
            if (err) {
                console.error('Database error fetching secret code:', err);
                return res.status(500).json({ success: false, message: 'Internal server error' });
            }

            if (results.length === 0) {
                return res.status(404).json({ success: false, message: 'Secret code configuration not found in database.' });
            }

            const dbPin = results[0].secreat_code_admin;

            // Compare pin (converting both to string/number safely)
            if (String(dbPin).trim() === String(pin).trim()) {
                // Pin matched, set session or response flag if needed
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