const express = require('express');
const router = express.Router();
// config ফোল্ডার প্রজেক্ট রুটে থাকলে
const db = require('../../db'); 

/**
 * @route   GET /api/admin/profile
 * @desc    কারেন্ট লগইন করা অ্যাডমিন বা সেলারের তথ্য আনবে
 */
router.get('/profile', async (req, res) => {
    try {
        // সেশন, টোকেন বা কুয়েরি পারাম থেকে admin_id নির্ণয়
        const adminId = req.user?.id || req.session?.adminId || req.session?.admin?.id;
        if (!adminId) return res.status(401).json({ success: false, message: "Please login again" }); 

        const [rows] = await db.execute('SELECT * FROM admins WHERE id = ?', [adminId]);

        if (rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Admin record not found' });
        }

        const adminData = rows[0];
        delete adminData.password; // নিরাপত্তার জন্য পাসওয়ার্ড বাদ দেওয়া হলো

        res.status(200).json({ success: true, data: adminData });
    } catch (error) {
        console.error('Error fetching admin profile:', error);
        res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
});

/**
 * @route   PUT /api/admin/profile/update
 * @desc    কারেন্ট অ্যাডমিন বা সেলারের প্রোফাইল তথ্য আপডেট করবে
 */
router.put('/profile/update', async (req, res) => {
    try {
        const adminId = req.user?.id || req.session?.adminId || req.session?.admin?.id;
        if (!adminId) return res.status(401).json({ success: false, message: "Please login again" });

        const {
            name,
            phone,
            address,
            shop_name,
            facebook_link,
            slogan,
            shop_about,
            payment_type,
            mobile_number,
            bank_acc_name,
            bank_acc_number,
            bank_name,
            bank_branch,
            routing_number
        } = req.body;

        if (typeof name !== "string" || !name.trim()) return res.status(400).json({ success: false, message: "Name is required" });
        const allowedPayments = ["none", "bkash", "nagad", "bank"];
        if (payment_type !== undefined && !allowedPayments.includes(payment_type)) return res.status(400).json({ success: false, message: "Invalid payment type" });
        const [existing] = await db.execute("SELECT payment_type FROM admins WHERE id = ?", [adminId]);
        if (!existing.length) return res.status(404).json({ success: false, message: "Seller not found" });
        const updateQuery = `
            UPDATE admins SET 
                name = ?, 
                phone = ?, 
                address = ?, 
                shop_name = ?, 
                facebook_link = ?, 
                slogan = ?, 
                shop_about = ?, 
                payment_type = ?, 
                mobile_number = ?, 
                bank_acc_name = ?, 
                bank_acc_number = ?, 
                bank_name = ?, 
                bank_branch = ?, 
                routing_number = ?
            WHERE id = ?
        `;

        const values = [
            name.trim(),
            phone || null,
            address || null,
            shop_name || null,
            facebook_link || null,
            slogan || null,
            shop_about || null,
            payment_type === undefined ? existing[0].payment_type : payment_type,
            mobile_number || null,
            bank_acc_name || null,
            bank_acc_number || null,
            bank_name || null,
            bank_branch || null,
            routing_number || null,
            adminId
        ];

        const [updated] = await db.execute(updateQuery, values);
        if (!updated.affectedRows) return res.status(404).json({ success: false, message: "Seller not found" });

        res.status(200).json({
            success: true,
            message: 'Profile updated successfully'
        });
    } catch (error) {
        console.error('Error updating admin profile:', error);
        res.status(500).json({ success: false, message: 'Failed to update profile', error: error.message });
    }
});

/**
 * @route   DELETE /api/admin/delete-account
 * @desc    ২৪ ঘণ্টার ডিলিট প্রসেস ইনিশিয়েট বা সময় পার হলে স্থায়ী ডিলিট করা
 */
router.delete('/delete-account', async (req, res) => {
    const adminId = req.user?.id || req.session?.adminId || req.session?.admin?.id;

    if (!adminId) {
        return res.status(400).json({ success: false, message: 'Admin ID required' });
    }

    try {
        const [rows] = await db.execute('SELECT * FROM admins WHERE id = ?', [adminId]);

        if (rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Admin account not found' });
        }

        const admin = rows[0];

        // ১. যদি রিকুয়েস্ট আগেই করা থাকে এবং ২৪ ঘণ্টা পেরিয়ে যায়, তবে সব ডিলিট হবে
        if (admin.is_deletion_pending && admin.delete_requested_at) {
            const requestTime = new Date(admin.delete_requested_at).getTime();
            const currentTime = new Date().getTime();
            const hoursPassed = (currentTime - requestTime) / (1000 * 60 * 60);

            if (hoursPassed >= 24) {
                const connection = await db.getConnection();
                try {
                    await connection.beginTransaction();

                    // products ডিলিট করা
                    await connection.execute('DELETE FROM products WHERE admin_id = ?', [adminId]);

                    // admin account ডিলিট করা
                    await connection.execute('DELETE FROM admins WHERE id = ?', [adminId]);

                    await connection.commit();
                    connection.release();

                    return res.status(200).json({
                        success: true,
                        isPermanentlyDeleted: true,
                        message: 'Account and associated products deleted permanently after 24 hours.'
                    });
                } catch (err) {
                    await connection.rollback();
                    connection.release();
                    throw err;
                }
            } else {
                const remainingHours = Math.ceil(24 - hoursPassed);
                return res.status(400).json({
                    success: false,
                    message: `Deletion request already pending. Account will be deleted in ${remainingHours} hours unless canceled.`
                });
            }
        }

        // ২. প্রথমবার ডিলিট বাটন প্রেস করলে ২৪ ঘণ্টার সময় সেট হবে
        await db.execute(
            'UPDATE admins SET is_deletion_pending = 1, delete_requested_at = NOW() WHERE id = ?',
            [adminId]
        );

        res.status(200).json({
            success: true,
            isScheduled: true,
            message: 'Account deletion initiated. Your account and products will be deleted after 24 hours if not canceled.'
        });

    } catch (error) {
        console.error('Error in delete-account route:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to process account deletion', 
            error: error.message 
        });
    }
});

/**
 * @route   POST /api/admin/cancel-delete
 * @desc    ২৪ ঘণ্টার মধ্যে অ্যাকাউন্টে ব্যাক করলে ডিলিট প্রসেস ক্যানসেল করা
 */
router.post('/cancel-delete', async (req, res) => {
    const adminId = req.user?.id || req.session?.adminId || req.session?.admin?.id;

    if (!adminId) {
        return res.status(400).json({ success: false, message: 'Admin ID required' });
    }

    try {
        await db.execute(
            'UPDATE admins SET is_deletion_pending = 0, delete_requested_at = NULL WHERE id = ?',
            [adminId]
        );

        res.status(200).json({
            success: true,
            message: 'Account deletion process has been successfully canceled.'
        });
    } catch (error) {
        console.error('Error canceling deletion:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to cancel deletion request',
            error: error.message
        });
    }
});
module.exports = router;