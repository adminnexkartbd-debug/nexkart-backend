const express = require('express');
const router = express.Router();
//const db = require('../../server'); // আপনার ডাটাবেজ কানেকশন পাথ
const db = require('../../db'); 

const multer = require('multer');
const path = require('path');
const { v2: cloudinary } = require('cloudinary');
const { CloudinaryStorage } = require('multer-storage-cloudinary');
require('dotenv').config();

// Cloudinary Configuration (.env ফাইল থেকে ক্রেডেনশিয়াল গ্রহণ করা হবে)
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Multer Cloudinary Storage Setup (স্বয়ংক্রিয় ইমেজ কমপ্রেশন ও অপটিমাইজেশন সহ)
const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'admin_profiles', // Cloudinary তে এই ফোল্ডারে প্রোফাইল ছবি সেভ হবে
    allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
    transformation: [
      { width: 500, height: 500, crop: 'limit' }, // ছবির সাইজ ৫০০০x৫০০ পিক্সেলের নিচে রাখবে
      { quality: 'auto:good' },                  // স্বয়ংক্রিয় কোয়ালিটি অপটিমাইজ/কমপ্রেস
      { fetch_format: 'auto' }                   // সেরা ফরম্যাট (যেমন WebP) ডেলিভার করবে
    ],
    public_id: (req, file) => {
      const uniqueSuffix = 'admin-' + Date.now() + '-' + Math.round(Math.random() * 1E9);
      return uniqueSuffix;
    },
  },
});

const upload = multer({ storage: storage });

// প্রোফাইল ছবি আপডেট করার রাউট (Cloudinary-তে আপলোড ও কমপ্রেসড URL ডাটাবেজে সেভ)
router.post('/api/profile/upload-picture', ensureActiveAdmin, upload.single('picture'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: "কোনো ছবি সিলেক্ট করা হয়নি!" });
        }

        // Cloudinary থেকে পাওয়া ফুল পাবলিক HTTPS লিঙ্ক
        const pictureUrl = req.file.path;
        const currentUserId = req.user.id;

        // ডাটাবেজের picture কলামে Cloudinary URL আপডেট করা
        await db.query('UPDATE admins SET picture = ? WHERE id = ?', [pictureUrl, currentUserId]);

        res.status(200).json({ success: true, message: "প্রোফাইল ছবি সফলভাবে আপডেট হয়েছে!", pictureUrl });
    } catch (err) {
        console.error('Picture Upload Error:', err);
        res.status(500).json({ success: false, message: "ছবি আপলোড করতে সমস্যা হয়েছে!" });
    }
});

// কারেন্ট ইউজারের ডাটা ফেচ করা
router.get('/api/profile/data', ensureActiveAdmin, async (req, res) => {
    try {
        const currentUserId = req.user.id; 
        const [rows] = await db.query('SELECT * FROM admins WHERE id = ?', [currentUserId]);
        
        if (rows.length === 0) {
            return res.status(404).json({ success: false, message: "প্রোফাইল পাওয়া যায়নি!" });
        }

        res.status(200).json({ success: true, data: rows[0] });
    } catch (err) {
        console.error('Profile Fetch Error:', err);
        res.status(500).json({ success: false, message: "সার্ভার এরর!" });
    }
});

// প্রোফাইল আপডেট বা ডাটা সেভ করা
router.post('/api/profile/update', ensureActiveAdmin, async (req, res) => {
    try {
        const currentUserId = req.user.id;
        
        const {
            name, shop_name, phone, address, facebook_link, slogan, shop_about,
            payment_type, mobile_number, bank_acc_name, bank_acc_number,
            bank_name, bank_branch, routing_number
        } = req.body;

        const query = `
            UPDATE admins SET 
                name = ?, shop_name = ?, phone = ?, address = ?, facebook_link = ?, 
                slogan = ?, shop_about = ?, payment_type = ?, mobile_number = ?, bank_acc_name = ?, 
                bank_acc_number = ?, bank_name = ?, bank_branch = ?, routing_number = ?
            WHERE id = ?
        `;

        await db.query(query, [
            name, shop_name, phone, address, facebook_link, slogan, shop_about,
            payment_type, mobile_number, bank_acc_name, bank_acc_number,
            bank_name, bank_branch, routing_number, currentUserId
        ]);

        res.status(200).json({ success: true, message: "প্রোফাইল সফলভাবে আপডেট ও সেভ হয়েছে!" });
    } catch (err) {
        console.error('Profile Update Error:', err);
        res.status(500).json({ success: false, message: "আপডেট করতে সমস্যা হয়েছে!" });
    }
});

function ensureActiveAdmin(req, res, next) {
    if (req.isAuthenticated && req.isAuthenticated() && req.user.status === 'approved') {
        return next();
    }
    res.status(401).json({ success: false, message: "অনুমোদিত নয় বা লগইন করা নেই।" });
}

module.exports = router;