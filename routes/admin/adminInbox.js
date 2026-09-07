const express = require('express');
const router = express.Router();
const db = require('../../db');
const cloudinary = require('cloudinary').v2;

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME || 'YOUR_CLOUD_NAME',
    api_key: process.env.CLOUDINARY_API_KEY || 'YOUR_API_KEY',
    api_secret: process.env.CLOUDINARY_API_SECRET || 'YOUR_API_SECRET'
});

function getCloudinaryPublicId(url) {
    if (!url || !url.includes('cloudinary.com')) return null;
    try {
        const parts = url.split('/upload/');
        if (parts.length < 2) return null;
        
        let path = parts[1].replace(/^v\d+\//, ''); 
        const lastDotIndex = path.lastIndexOf('.');
        if (lastDotIndex !== -1) {
            path = path.substring(0, lastDotIndex);
        }
        return path;
    } catch (err) {
        return null;
    }
}

router.get('/seller/profile', async (req, res) => {
    try {
        const sellerId = req.user?.id || req.session?.seller_id || req.session?.admin_id;

        if (!sellerId) {
            return res.status(401).json({ success: false, message: 'Unauthorized. Please log in first.' });
        }

        const [rows] = await db.query(
            "SELECT id, name, email, picture, shop_name, role FROM admins WHERE id = ?",
            [sellerId]
        );

        if (rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Seller profile not found' });
        }

        res.status(200).json({ success: true, seller: rows[0] });
    } catch (error) {
        console.error("Seller Profile Error:", error);
        res.status(500).json({ success: false, message: 'Server error while fetching seller profile' });
    }
});

router.get('/conversations/:seller_id', async (req, res) => {
    try {
        const { seller_id } = req.params;

        const query = `
            SELECT 
                m1.customer_id,
                m1.customer_name,
                m1.customer_image,
                m1.sms_text AS last_message,
                m1.sms_send_time AS last_message_time,
                m1.sender_type AS last_sender_type,
                m1.status AS last_status,
                (SELECT COUNT(*) FROM seller_messages WHERE seller_id = ? AND customer_id = m1.customer_id) AS total_messages
            FROM seller_messages m1
            INNER JOIN (
                SELECT customer_id, MAX(id) as max_id
                FROM seller_messages
                WHERE seller_id = ?
                GROUP BY customer_id
            ) m2 ON m1.id = m2.max_id
            ORDER BY m1.sms_send_time DESC
        `;

        const [conversations] = await db.query(query, [seller_id, seller_id]);

        res.status(200).json({ success: true, conversations: conversations });
    } catch (error) {
        console.error("Fetch Conversations Error:", error);
        res.status(500).json({ success: false, message: 'Failed to fetch conversations' });
    }
});

router.get('/messages/:seller_id/:customer_id', async (req, res) => {
    try {
        const { seller_id, customer_id } = req.params;

        await db.query(
            `UPDATE seller_messages SET status = 'Received' WHERE seller_id = ? AND customer_id = ? AND sender_type = 'customer' AND status = 'Pending'`,
            [seller_id, customer_id]
        );

        const query = `
            SELECT sm.* FROM seller_messages sm
            WHERE sm.seller_id = ? AND sm.customer_id = ? 
            ORDER BY sm.sms_send_time ASC
        `;
        const [messages] = await db.query(query, [seller_id, customer_id]);
        res.status(200).json({ success: true, messages });
    } catch (error) {
        console.error("Messages Error:", error);
        res.status(500).json({ success: false, message: 'Server Error' });
    }
});

router.post('/send-message', async (req, res) => {
    try {
        const seller_id = (req.session && (req.session.seller_id || req.session.admin_id)) ? (req.session.seller_id || req.session.admin_id) : req.body.seller_id;
        const { customer_id, sms_text, sms_image, sms_video } = req.body;

        if (!seller_id) {
            return res.status(400).json({ success: false, message: 'Seller ID missing' });
        }

        const [user] = await db.query('SELECT name, profile_image FROM users WHERE id = ?', [customer_id]);
        let customerName = user.length > 0 ? user[0].name : 'Customer';
        let customerImage = user.length > 0 ? user[0].profile_image : null;
        
        const query = `
            INSERT INTO seller_messages (seller_id, customer_id, customer_name, customer_image, sms_text, sms_image, sms_video, sender_type, admin_idRC, status, sms_send_time) 
            VALUES (?, ?, ?, ?, ?, ?, ?, 'seller', ?, 'Sent', NOW())
        `;
        await db.query(query, [seller_id, customer_id, customerName, customerImage, sms_text, sms_image || null, sms_video || null, seller_id]);
        
        res.status(200).json({ success: true, message: 'Message Sent Successfully' });
    } catch (error) {
        console.error("Send Message Error:", error);
        res.status(500).json({ success: false, message: 'Failed to send message' });
    }
});

router.delete('/conversation/:seller_id/:customer_id', async (req, res) => {
    try {
        const { seller_id, customer_id } = req.params;

        const [messages] = await db.query(
            `SELECT sms_image, sms_video FROM seller_messages WHERE seller_id = ? AND customer_id = ?`,
            [seller_id, customer_id]
        );

        for (const msg of messages) {
            if (msg.sms_image) {
                const imgPublicId = getCloudinaryPublicId(msg.sms_image);
                if (imgPublicId) {
                    await cloudinary.uploader.destroy(imgPublicId, { resource_type: 'image' }).catch(e => console.error("Cloudinary Image Delete Error:", e));
                }
            }
            if (msg.sms_video) {
                const videoPublicId = getCloudinaryPublicId(msg.sms_video);
                if (videoPublicId) {
                    await cloudinary.uploader.destroy(videoPublicId, { resource_type: 'video' }).catch(e => console.error("Cloudinary Video Delete Error:", e));
                }
            }
        }

        await db.query(`DELETE FROM seller_messages WHERE seller_id = ? AND customer_id = ?`, [seller_id, customer_id]);
        res.status(200).json({ success: true, message: 'Conversation & Cloudinary media deleted successfully' });
    } catch (error) {
        console.error("Delete Error:", error);
        res.status(500).json({ success: false, message: 'Failed to delete conversation' });
    }
});

router.get('/pending-count/:seller_id', async (req, res) => {
    try {
        const { seller_id } = req.params;
        const query = `
            SELECT COUNT(DISTINCT sm.customer_id) as total_pending 
            FROM seller_messages sm
            WHERE sm.seller_id = ? AND sm.sender_type = 'customer' AND sm.status = 'Pending'
        `;
        const [result] = await db.query(query, [seller_id]);
        res.status(200).json({ success: true, pendingCount: result[0].total_pending || 0 });
    } catch (error) {
        console.error("Pending Count Error:", error);
        res.status(500).json({ success: false, message: 'Server Error' });
    }
});

module.exports = router;