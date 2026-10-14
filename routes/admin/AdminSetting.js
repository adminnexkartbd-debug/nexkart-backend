const express = require('express');
const router = express.Router();
// config ফোল্ডার প্রজেক্ট রুটে থাকলে
const db = require('../../db'); 

/**
 * @route   GET /api/admin/profile
 * @desc    কারেন্ট লগইন করা অ্যাডমিন বা সেলারের তথ্য আনবে
 */
function requireSellerProfile(req, res, next) {
    const user = req.user;
    if (!user || user.user_type === 'user' || !['seller', 'super_admin'].includes(user.role)) {
        return res.status(401).json({ success: false, message: 'Please login to your seller account again.' });
    }
    req.profileAdminId = user.id;
    next();
}

router.get('/profile', requireSellerProfile, async (req, res) => {
    try {
        const [rows] = await db.execute('SELECT * FROM admins WHERE id = ?', [req.profileAdminId]);
        if (!rows.length) return res.status(404).json({ success: false, message: 'Account not found' });
        const { password, verification_code, temp_data, ...safeProfile } = rows[0];
        res.json({ success: true, data: safeProfile });
    } catch (err) {
        console.error('Profile load failed:', err);
        res.status(500).json({ success: false, message: 'Could not load profile' });
    }
});

router.put('/profile/update', requireSellerProfile, async (req, res) => {
    try {
        const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
        if (!name) return res.status(400).json({ success: false, message: 'Seller name is required.' });
        if (name.length > 255) return res.status(400).json({ success: false, message: 'Seller name is too long.' });
        const fields = ['name','phone','address','shop_name','facebook_link','slogan','shop_about',
            'mobile_number','bank_acc_name','bank_acc_number','bank_name','bank_branch','routing_number'];
        const lengths = { phone:20, mobile_number:20, shop_name:255, facebook_link:255,
            slogan:255, bank_acc_name:255, bank_acc_number:100, bank_name:255,
            bank_branch:255, routing_number:100 };
        const values = [];
        for (const field of fields) {
            const value = field === 'name' ? name : (req.body[field] == null ? null : String(req.body[field]).trim() || null);
            if (value && lengths[field] && value.length > lengths[field]) {
                return res.status(400).json({ success: false, message: field + ' exceeds allowed length.' });
            }
            values.push(value);
        }
        const [result] = await db.execute(
            'UPDATE admins SET ' + fields.map(f => '`' + f + '` = ?').join(', ') + ' WHERE id = ?',
            [...values, req.profileAdminId]
        );
        if (!result.affectedRows) return res.status(404).json({ success: false, message: 'Seller not found.' });
        res.json({ success: true, message: 'Profile updated successfully' });
    } catch (err) {
        console.error('Profile update failed:', err);
        res.status(500).json({ success: false, message: 'Failed to update profile. Please contact support.' });
    }
});

/**
 * @route   DELETE /api/admin/delete-account
 * @desc    ২৪ ঘণ্টার ডিলিট প্রসেস ইনিশিয়েট বা সময় পার হলে স্থায়ী ডিলিট করা
 */
router.delete('/delete-account', async (req, res) => {
    const adminId = req.user ? req.user.id : (req.body.admin_id || req.query.admin_id);

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
    const adminId = req.user ? req.user.id : (req.body.admin_id || req.query.admin_id);

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