const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const db = require('../../db');

// 1. Change Password Route (সরাসরি নতুন পাসওয়ার্ড আপডেট করবে)
router.post('/change-password', async (req, res) => {
    const userId = req.session?.userId || req.body.userId;
    const { newPassword } = req.body;

    if (!userId || !newPassword) {
        return res.status(400).json({ success: false, message: 'নতুন পাসওয়ার্ড প্রদান করুন।' });
    }

    try {
        const hashedPassword = await bcrypt.hash(newPassword, 10);
        const [result] = await db.execute('UPDATE users SET password = ? WHERE id = ?', [hashedPassword, userId]);

        if (result.affectedRows === 0) {
            return res.status(404).json({ success: false, message: 'ইউজার পাওয়া যায়নি।' });
        }

        return res.json({ success: true, message: 'পাসওয়ার্ড সফলভাবে পরিবর্তন করা হয়েছে।' });
    } catch (error) {
        console.error('Change Password Error:', error);
        return res.status(500).json({ success: false, message: 'ডাটাবেস সার্ভার এরর।' });
    }
});

// 2. Delete Account Route (পাসওয়ার্ড ছাড়া, সরাসরি Session/ID ধরে ডিলিট)
router.post('/delete-account', async (req, res) => {
    const userId = req.session?.userId || req.body.userId;

    if (!userId) {
        return res.status(401).json({ success: false, message: 'ইউজার লগইন করা নেই।' });
    }

    try {
        const [result] = await db.execute('DELETE FROM users WHERE id = ?', [userId]);

        if (result.affectedRows === 0) {
            return res.status(404).json({ success: false, message: 'ইউজার অ্যাকাউন্ট পাওয়া যায়নি।' });
        }

        if (req.session) {
            req.session.destroy();
        }

        return res.json({ success: true, message: 'অ্যাকাউন্ট সফলভাবে ডিলিট করা হয়েছে।' });
    } catch (error) {
        console.error('Delete Account Error:', error);
        return res.status(500).json({ success: false, message: 'ডাটাবেস সার্ভার এরর।' });
    }
});

module.exports = router;