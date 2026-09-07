const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const db = require('../../db'); // DB কানেকশন ফাইল পাথ চেক করুন

// Cloudinary এবং Multer Storage কনফিগারেশন
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');

// Cloudinary কনফিগারেশন
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

// Multer Storage হিসেবে Cloudinary কনফিগার করা
const storage = new CloudinaryStorage({
    cloudinary: cloudinary,
    params: {
        folder: 'profile_images', // Cloudinary ড্যাশবোর্ডে যে ফোল্ডারে ছবিগুলো সেভ হবে
        allowed_formats: ['jpg', 'jpeg', 'png', 'webp']
    }
});

const upload = multer({ storage: storage });

// URL: GET /user/get-user-profile
router.get('/get-user-profile', async (req, res) => {
    try {
        const userId = req.user ? req.user.id : (req.session && req.session.userId ? req.session.userId : null); 
        
        if (!userId) {
            return res.status(401).json({ success: false, message: 'Unauthorized: Please login first!' });
        }

        const [userRows] = await db.execute('SELECT * FROM users WHERE id = ?', [userId]);
        
        if (userRows.length === 0) {
            return res.status(404).json({ success: false, message: 'User not found!' });
        }

        let userData = userRows[0];

        const ratingQuery = `
            SELECT 
                COALESCE(AVG(r.rating), 0) AS seller_rating,
                COUNT(r.id) AS total_reviews
            FROM products p
            LEFT JOIN product_reviews r ON p.id = r.product_id
            WHERE p.admin_id = ?
        `;

        const [ratingRows] = await db.execute(ratingQuery, [userId]);

        if (ratingRows.length > 0) {
            userData.seller_rating = ratingRows[0].seller_rating;
            userData.total_reviews = ratingRows[0].total_reviews;
        } else {
            userData.seller_rating = 0;
            userData.total_reviews = 0;
        }

        res.json(userData);

    } catch (error) {
        console.error("Get Profile Error:", error);
        res.status(500).json({ success: false, message: 'Server error!' });
    }
});

// URL: POST /user/update-profile-picture
router.post('/update-profile-picture', upload.single('profile_image'), async (req, res) => {
    try {
        const userId = req.user ? req.user.id : (req.session && req.session.userId ? req.session.userId : null);
        
        if (!userId) {
            return res.status(401).json({ success: false, message: 'Unauthorized: Please login first!' });
        }

        if (!req.file) {
            return res.status(400).json({ success: false, message: 'No image uploaded!' });
        }

        // Cloudinary সফলভাবে ছবি আপলোড করলে req.file.path-এ সরাসরি ছবির পূর্ণাঙ্গ URL (https://res.cloudinary.com/...) দিয়ে দেয়
        const profileImageUrl = req.file.path;

        await db.execute('UPDATE users SET profile_image = ? WHERE id = ?', [profileImageUrl, userId]);

        return res.json({ 
            success: true, 
            profile_image: profileImageUrl, 
            message: 'Profile picture updated successfully!' 
        });
    } catch (error) {
        console.error("Update Profile Picture Error:", error);
        res.status(500).json({ success: false, message: 'Server error during image update!' });
    }
});

// URL: POST /user/update-profile
router.post('/update-profile', upload.none(), async (req, res) => {
    try {
        const userId = req.user ? req.user.id : (req.session && req.session.userId ? req.session.userId : null);
        
        if (!userId) {
            return res.status(401).json({ success: false, message: 'Unauthorized: Please login first!' });
        }

        const { name, phone_number, division, district, upazilla, union_area, post_code, block_house } = req.body;

        const updateQuery = `
            UPDATE users 
            SET name = ?, 
                phone_number = ?, 
                division = ?, 
                district = ?, 
                upazilla = ?, 
                union_area = ?, 
                post_code = ?, 
                block_house = ?
            WHERE id = ?
        `;

        await db.execute(updateQuery, [
            name || null,
            phone_number || null,
            division || null,
            district || null,
            upazilla || null,
            union_area || null,
            post_code || null,
            block_house || null,
            userId
        ]);

        return res.json({ success: true, message: 'Profile updated successfully!' });
    } catch (error) {
        console.error("Update Profile Error:", error);
        res.status(500).json({ success: false, message: 'Server error during profile update!' });
    }
});

module.exports = router;