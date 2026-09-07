const express = require('express');
const router = express.Router();
const db = require('../../db'); // ডাটাবেজ কানেকশন পাথ
const multer = require('multer');
const { v2: cloudinary } = require('cloudinary');
const { CloudinaryStorage } = require('multer-storage-cloudinary');
require('dotenv').config();

// Cloudinary কনফিগারেশন
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Multer Cloudinary Storage সেটআপ (Image & PDF উভয়ের জন্য)
const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: async (req, file) => {
    const isPdf = file.mimetype === 'application/pdf';
    return {
      folder: 'verification_documents',
      // PDF এর জন্য resource_type: 'raw' বা 'auto' ব্যবহার করতে হয়
      resource_type: isPdf ? 'raw' : 'image', 
      allowed_formats: ['jpg', 'jpeg', 'png', 'webp', 'pdf'],
      public_id: Date.now() + '-' + file.originalname.split('.')[0],
    };
  },
});

// ফাইল আপলোড ফিল্টার (Image + PDF అనుమతి)
const upload = multer({
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 }, // সর্বোচ্চ ১০ মেগাবাইট
    fileFilter: (req, file, cb) => {
        const allowedMimeTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'application/pdf'];
        if (allowedMimeTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('শুধুমাত্র ছবি (JPG, JPEG, PNG, WEBP) অথবা PDF ফাইল আপলোড করা যাবে!'));
        }
    }
});

// ১. ছবি/PDF আপলোড ও ইনসার্ট করার (POST) রাউট
router.post('/api/profile/upload-documents', ensureActiveAdmin, upload.fields([
    { name: 'identity_file', maxCount: 1 },
    { name: 'trade_license_file', maxCount: 1 }
]), async (req, res) => {
    try {
        const userId = req.user.id;
        const { identity_type, identity_number, trade_license_number } = req.body;
        const insertedDocs = [];

        // NID বা পাসপোর্ট ইমেজের ডাটা ইনসার্ট
        if (req.files && req.files['identity_file']) {
            const identityFile = req.files['identity_file'][0];
            // Cloudinary থেকে আসা সরাসরি secure_url
            const identityUrl = identityFile.path; 
            const docType = identity_type === 'passport' ? 'passport' : 'nid';

            await db.query(
                'INSERT INTO verification_doc (user_id, document_type, document_number, file_url) VALUES (?, ?, ?, ?)',
                [userId, docType, identity_number || '', identityUrl]
            );
            insertedDocs.push(docType);
        }

        // ট্রেড লাইসেন্স ইমেজের ডাটা ইনসার্ট
        if (req.files && req.files['trade_license_file']) {
            const tradeFile = req.files['trade_license_file'][0];
            // Cloudinary থেকে আসা সরাসরি secure_url
            const tradeUrl = tradeFile.path;

            await db.query(
                'INSERT INTO verification_doc (user_id, document_type, document_number, file_url) VALUES (?, ?, ?, ?)',
                [userId, 'trade_license', trade_license_number || '', tradeUrl]
            );
            insertedDocs.push('trade_license');
        }

        if (insertedDocs.length === 0) {
            return res.status(400).json({ success: false, message: "কোনো ফাইল নির্বাচন করা হয়নি!" });
        }

        res.status(200).json({
            success: true,
            message: "ডকুমেন্টস ফাইল সফলভাবে Cloudinary-তে আপলোড করা হয়েছে!"
        });

    } catch (err) {
        console.error('Document Upload Error:', err);
        res.status(500).json({ success: false, message: err.message || "সার্ভার এরর! ফাইল আপলোড ব্যর্থ হয়েছে।" });
    }
});

// ২. জমা দেওয়া ডকুমেন্টস লোড করার (GET) রাউট
router.get('/api/profile/documents', ensureActiveAdmin, async (req, res) => {
    try {
        const userId = req.user.id;

        const [documents] = await db.query(
            'SELECT id, document_type, document_number, file_url, status, created_at FROM verification_doc WHERE user_id = ? ORDER BY id DESC',
            [userId]
        );

        res.status(200).json({
            success: true,
            data: documents
        });

    } catch (err) {
        console.error('Fetch Documents Error:', err);
        res.status(500).json({ success: false, message: "সার্ভার এরর!" });
    }
});

// অ্যাডমিন অথেন্টিকেশন চেক মিডলওয়্যার
function ensureActiveAdmin(req, res, next) {
    if (req.isAuthenticated && req.isAuthenticated() && req.user.status === 'approved') {
        return next();
    }
    res.status(401).json({ success: false, message: "অনুমোদিত নয় বা লগইন করা নেই।" });
}

module.exports = router;