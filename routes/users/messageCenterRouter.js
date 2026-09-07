const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const { v2: cloudinary } = require('cloudinary');
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const db = require('../../db');
require('dotenv').config();

// Cloudinary Configuration (.env থেকে কনফিগারেশন লোড করা হচ্ছে)
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Multer Cloudinary Storage (লোকাল ড্রাইভে ফাইল সেভ না করে সরাসরি Cloudinary-তে আপলোড করা)
const storage = new CloudinaryStorage({
    cloudinary: cloudinary,
    params: async (req, file) => {
        const isImage = file.mimetype.startsWith('image');
        const isVideo = file.mimetype.startsWith('video');
        const isAudio = file.mimetype.startsWith('audio');

        let resource_type = 'auto';
        let folder = 'tickets_attachments';
        let transformation = [];

        if (isImage) {
            resource_type = 'image';
            // ইমেজ সর্বোচ্চ কম্প্রেস (auto:eco) এবং আধুনিক ফরম্যাটে (f_auto) কনভার্ট করার নিয়ম
            transformation = [
                { quality: 'auto:eco', fetch_format: 'auto' }
            ];
        } else if (isVideo || isAudio) {
            // Cloudinary-তে ভিডিও এবং অডিও 'video' টাইপ হিসেবে আপলোড হয়
            resource_type = 'video';
        }

        return {
            folder: folder,
            resource_type: resource_type,
            public_id: Date.now() + '-' + Math.round(Math.random() * 1E9),
            transformation: transformation
        };
    },
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 100 * 1024 * 1024 } // ১০০ MB সাইজ লিমিট
});

// টিকিট নম্বর জেনারেটর ফানশন
function generateTicketNumber() {
    const prefix = "TCK";
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const randomNum = Math.floor(1000 + Math.random() * 9000);
    return `${prefix}-${dateStr}-${randomNum}`;
}

// ১. টিকিট জমা নেওয়া এবং DB-তে ডাইনামিক user_id সহ Insert করা
router.post('/create-ticket', upload.single('attachment'), async (req, res) => {
    try {
        const { full_name, email, issue_category, message, user_id } = req.body;

        if (!user_id) {
            return res.status(400).json({ success: false, message: 'User ID পাওয়া যায়নি! দয়া করে পুনরায় লগইন করুন।' });
        }

        if (!full_name || !email || !issue_category || !message) {
            return res.status(400).json({ success: false, message: 'সবগুলো প্রয়োজনীয় ফিল্ড পূরণ করুন।' });
        }

        const ticket_number = generateTicketNumber();
        let attachment_path = null;
        let attachment_type = 'none';

        if (req.file) {
            // Cloudinary থেকে রিটার্ন পাওয়া secure URL সরাসরি ব্যাকএন্ডে সেভ হবে
            attachment_path = req.file.path; 

            if (req.file.mimetype.startsWith('video')) {
                attachment_type = 'video';
            } else if (req.file.mimetype.startsWith('audio')) {
                attachment_type = 'audio';
            } else if (req.file.mimetype.startsWith('image')) {
                attachment_type = 'image';
            }
        }

        // tickets টেবিলে user_id যুক্ত করে SQL Insert
        const query = `
            INSERT INTO tickets 
            (user_id, ticket_number, full_name, email, issue_category, message, attachment_path, attachment_type, status) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')
        `;

        const [result] = await db.execute(query, [
            user_id, ticket_number, full_name, email, issue_category, message, attachment_path, attachment_type
        ]);

        const newTicket = {
            id: result.insertId,
            user_id: Number(user_id),
            ticket_number,
            full_name,
            email,
            issue_category,
            message,
            attachment_path,
            attachment_type,
            status: 'pending',
            admin_reply: null,
            created_at: new Date()
        };

        res.status(201).json({
            success: true,
            message: 'টিকিট সফলভাবে জমা দেওয়া হয়েছে!',
            ticket: newTicket
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// ২. কেবলমাত্র ফিল্টারকৃত নির্দিষ্ট কারেন্ট ইউজারের (user_id) টিকিটগুলো আনার API
router.get('/my-tickets', async (req, res) => {
    try {
        const { user_id } = req.query;

        if (!user_id) {
            return res.status(400).json({ success: false, message: 'User ID is required.' });
        }

        // users টেবিলের সাথে ডাইনামিক ফিল্টারিং query
        const query = `SELECT * FROM tickets WHERE user_id = ? ORDER BY created_at DESC`;
        const [tickets] = await db.execute(query, [user_id]);

        res.status(200).json({ success: true, tickets });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

module.exports = router;