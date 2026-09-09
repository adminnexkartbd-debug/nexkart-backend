const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const db = require('../../db'); // ফাইলটি ২ ধাপ ভেতরে থাকায় db-এর পাথ '../../db' হবে

// পপ-আপ / মোডাল লগইনের জন্য API
router.post('/pop-login', async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ success: false, message: 'ইমেইল এবং পাসওয়ার্ড দেওয়া বাধ্যতামূলক!' });
    }

    try {
        // ১. এডমিন চেক
        const [adminCheck] = await db.query('SELECT * FROM admins WHERE email = ?', [email]);
        if (adminCheck.length > 0) {
            return res.status(400).json({ success: false, message: 'এডমিন ইমেইল দিয়ে ইউজার লগইন করা যাবে না!' });
        }

        // ২. ইউজার চেক
        const [users] = await db.query('SELECT * FROM users WHERE email = ?', [email]);
        if (users.length === 0) {
            return res.json({ success: false, message: 'ইমেইল অথবা পাসওয়ার্ড ভুল!' });
        }

        const user = users[0];

        // ৩. পাসওয়ার্ড ম্যাচিং
        const isMatch = await bcrypt.compare(String(password), String(user.password));
        if (!isMatch) {
            return res.json({ success: false, message: 'ইমেইল অথবা পাসওয়ার্ড ভুল!' });
        }

        // ৪. সেশন সেটআপ
        req.login(user, (err) => {
            if (err) {
                console.error("Pop-up Login Session Error:", err);
                return res.json({ success: false, message: 'লগইন সেশন তৈরি করতে সমস্যা হয়েছে!' });
            }

            req.session.user = { id: user.id, email: user.email, user_type: 'user' };
            req.session.userId = user.id;

            // কোনো redirect ছাড়াই JSON রেসপন্স
            return res.json({ 
                success: true, 
                message: 'লগইন সফল হয়েছে!' 
            });
        });

    } catch (err) {
        console.error('Pop-up Login Error:', err);
        return res.status(500).json({ success: false, message: 'সার্ভার এরর!' });
    }
});

module.exports = router;