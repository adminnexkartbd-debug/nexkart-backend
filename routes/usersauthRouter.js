// usersauthRouter.js
const express = require('express');
const router = express.Router();
const db = require('../db'); 

// Google Strategy এর মাধ্যমে সাকসেসফুল লগইন হলে এই লজিকটি ডাটাবেজে ইউজার এবং ইমেজ সেভ করবে
// ধরুন আপনি passport-google-oauth20 ব্যবহার করছেন
router.get('/auth/google/callback', passport.authenticate('google', { failureRedirect: '/login' }), 
async (req, res) => {
    const { id, displayName, emails, photos } = req.user;
    const email = emails[0].value;
    const profileImage = photos[0].value; // এখানে গুগল প্রোফাইল পিকচারটি পাচ্ছেন

    try {
        // ডাটাবেজে ইউজার চেক করুন বা নতুন ইউজার হলে ইমেজ সহ ইনসার্ট করুন
        const [existingUser] = await db.query('SELECT * FROM users WHERE email = ?', [email]);
        
        if (existingUser.length === 0) {
            await db.query(
                'INSERT INTO users (name, email, profile_image, is_verified, created_at) VALUES (?, ?, ?, 1, NOW())',
                [displayName, email, profileImage]
            );
        } else {
            // যদি ইউজার আগে থাকে, প্রোফাইল ইমেজ আপডেট করে দিন
            await db.query('UPDATE users SET profile_image = ? WHERE email = ?', [profileImage, email]);
        }

        res.redirect('/user/dashboard');
    } catch (err) {
        console.error(err);
        res.status(500).send("Database Error!");
    }
});