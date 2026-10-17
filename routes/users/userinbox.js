const express = require('express');
const router = express.Router();
const db = require('../../db'); 
const multer = require('multer');
const { v2: cloudinary } = require('cloudinary');
const { CloudinaryStorage } = require('multer-storage-cloudinary');
require('dotenv').config();

// Cloudinary Configuration (.env ফাইল থেকে কি (Key) কনফিগারেশন গ্রহণ করছে)
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Multer Cloudinary Storage Setup (ইমেজ এবং ভিডিও উভয় সাপোর্ট করবে)
const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: async (req, file) => {
    const isVideo = file.mimetype.startsWith('video');
    return {
      folder: 'seller_messages', // Cloudinary ফোল্ডার নেম
      resource_type: isVideo ? 'video' : 'image',
      public_id: Date.now() + '-' + file.originalname.split('.')[0]
    };
  }
});

const upload = multer({ storage: storage });

function isAuthenticated(req, res, next) {
    if (req.session && req.session.user) {
        return next();
    }
    return res.redirect('/user/cslogin');
}

// Helper Function: ইমেজ পাথ ঠিক করা
function formatImagePath(imagePath, fallbackName) {
    if (!imagePath) {
        return `https://ui-avatars.com/api/?name=${encodeURIComponent(fallbackName || 'User')}&background=random`;
    }
    if (imagePath.startsWith('http')) {
        return imagePath;
    }
    return imagePath.startsWith('/uploads/') ? imagePath : '/uploads/' + imagePath.replace(/^\/+/, '');
}

// ইনবক্স এপিআই
router.get('/api/messages', isAuthenticated, async (req, res) => {
    try {
        res.json({ success: true, messages: [] });
    } catch (error) {
        console.error("API Messages Error:", error);
        res.status(500).json({ success: false, message: "Failed to load messages" });
    }
});

// কাস্টমার কনভার্সেশন বা সেলার লিস্ট ফেচ করার রাউট
router.get('/api/customer-conversations', isAuthenticated, async (req, res) => {
    try {
        const customerId = req.session.user.id;

        const query = `
            SELECT sm.seller_id, sm.sms_text, sm.sms_image, sm.sms_video, sm.sms_send_time, 
                   sm.status, sm.sender_type,
                   a.shop_name, a.name AS seller_name, a.picture, a.slogan, a.created_at
            FROM seller_messages sm
            JOIN admins a ON sm.seller_id = a.id
            WHERE sm.customer_id = ? 
            AND sm.id IN (
                SELECT MAX(id) 
                FROM seller_messages 
                WHERE customer_id = ? 
                GROUP BY seller_id
            )
            ORDER BY sm.sms_send_time DESC
        `;

        const [conversations] = await db.query(query, [customerId, customerId]);

        const formattedConversations = conversations.map(conv => ({
            ...conv,
            picture: formatImagePath(conv.picture, conv.shop_name || conv.seller_name)
        }));

        return res.json({ success: true, conversations: formattedConversations });
    } catch (error) {
        console.error("Fetch Conversations Error:", error);
        return res.status(500).json({ success: false, message: "Server error!", error: error.message });
    }
});

// নির্দিষ্ট সেলারের চ্যাট লোড করার রাউট (ক্লিক করলেই status 'Received' হবে)
router.get('/api/get-messages/:seller_id', isAuthenticated, async (req, res) => {
    try {
        const { seller_id } = req.params;
        const customerId = req.session.user.id;

        // ১. সেলার থেকে আসা অদেখা মেসেজগুলোর status 'Received' করে দেওয়া
        await db.query(
            `UPDATE seller_messages 
             SET status = 'Received' 
             WHERE customer_id = ? AND seller_id = ? AND sender_type = 'seller' AND status != 'Received'`,
            [customerId, seller_id]
        );

        // ২. কাস্টমারের প্রোফাইল ছবি ও নাম
        const [userRows] = await db.query(`SELECT name, profile_image FROM users WHERE id = ?`, [customerId]);
        let userName = userRows.length > 0 ? userRows[0].name : 'User';
        let userProfileImage = userRows.length > 0 ? formatImagePath(userRows[0].profile_image, userName) : formatImagePath(null, userName);

        // ৩. সেলারের প্রোফাইল ছবি ও নাম
        const [sellerRows] = await db.query(`SELECT shop_name, name, picture FROM admins WHERE id = ?`, [seller_id]);
        let sellerName = sellerRows.length > 0 ? (sellerRows[0].shop_name || sellerRows[0].name) : 'Seller';
        let sellerProfileImage = sellerRows.length > 0 ? formatImagePath(sellerRows[0].picture, sellerName) : formatImagePath(null, sellerName);

        // ৪. মেসেজ তালিকা আনা
        const [messages] = await db.query(
            `SELECT * FROM seller_messages WHERE customer_id = ? AND seller_id = ? ORDER BY sms_send_time ASC`,
            [customerId, seller_id]
        );

        const formattedMessages = messages.map(msg => ({
            ...msg,
            sms_image: msg.sms_image ? formatImagePath(msg.sms_image) : null,
            sms_video: msg.sms_video ? formatImagePath(msg.sms_video) : null
        }));

        return res.json({ 
            success: true, 
            messages: formattedMessages, 
            userProfileImage, 
            sellerProfileImage 
        });
    } catch (error) {
        console.error("Error loading chat messages:", error);
        return res.status(500).json({ success: false, message: "Error loading chat" });
    }
});

// নতুন মেসেজ পাঠানোর রাউট (Cloudinary-তে ইমেজ/ভিডিও সেভ হবে)
router.post('/api/send-message', isAuthenticated, upload.single('mediaFile'), async (req, res) => {
    try {
        const { seller_id, sms_text } = req.body;
        const customerId = req.session.user.id;

        let sms_image = null;
        let sms_video = null;

        if (req.file) {
            // Cloudinary থেকে প্রাপ্ত সরাসরি পাবলিক URL নেওয়া হচ্ছে
            const fileUrl = req.file.path;
            
            if (req.file.mimetype.startsWith('image/')) {
                sms_image = fileUrl;
            } else if (req.file.mimetype.startsWith('video/')) {
                sms_video = fileUrl;
            }
        }

        await db.query(
            `INSERT INTO seller_messages (seller_id, customer_id, sms_text, sms_image, sms_video, sender_type, status) 
             VALUES (?, ?, ?, ?, ?, 'customer', 'Pending')`,
            [seller_id, customerId, sms_text || '', sms_image, sms_video]
        );

        return res.json({ success: true, message: "Message sent successfully" });
    } catch (error) {
        console.error("Error sending message:", error);
        return res.status(500).json({ success: false, message: "Error sending message", error: error.message });
    }
});

// চ্যাট ডিলিট রাউট (Cloudinary ফাইল সহ ডিলিট)
router.delete('/api/delete-conversation/:seller_id', isAuthenticated, async (req, res) => {
    try {
        const { seller_id } = req.params;
        const customerId = req.session.user.id;

        // ১. আগে ডাটাবেজ থেকে ঐ চ্যাটের সব মিডিয়া ফাইল (image & video) বের করা
        const [messages] = await db.query(
            `SELECT sms_image, sms_video FROM seller_messages 
             WHERE customer_id = ? AND seller_id = ? AND (sms_image IS NOT NULL OR sms_video IS NOT NULL)`,
            [customerId, seller_id]
        );

        // ২. ক্লাউডিনারি থেকে ফাইলগুলো ডিলিট করা
        for (const msg of messages) {
            const mediaUrl = msg.sms_image || msg.sms_video;
            if (mediaUrl && mediaUrl.includes('cloudinary.com')) {
                try {
                    // URL থেকে public_id বের করা (উদা: seller_messages/1715000000-filename)
                    const parts = mediaUrl.split('/');
                    const folderAndFileName = parts.slice(-2).join('/'); // 'seller_messages/filename.jpg'
                    const publicId = folderAndFileName.substring(0, folderAndFileName.lastIndexOf('.'));
                    
                    const isVideo = !!msg.sms_video;
                    await cloudinary.uploader.destroy(publicId, { resource_type: isVideo ? 'video' : 'image' });
                } catch (cErr) {
                    console.error("Cloudinary file deletion error:", cErr);
                }
            }
        }

        // ৩. ডাটাবেজ থেকে মেসেজগুলো মুছে ফেলা
        await db.query(
            `DELETE FROM seller_messages WHERE customer_id = ? AND seller_id = ?`,
            [customerId, seller_id]
        );

        return res.json({ success: true, message: "Conversation and media deleted successfully" });
    } catch (error) {
        console.error("Error deleting conversation:", error);
        return res.status(500).json({ success: false, message: "Error deleting conversation" });
    }
});

module.exports = router;