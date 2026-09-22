const express = require('express');
const router = express.Router();
const db = require('../../db'); 

// Helper function current admin identifier ber korar jonno
const getCurrentAdminId = (req) => {
    return req.session?.adminId || req.headers['x-admin-id'] || req.query.adminId;
};

/**
 * @route   GET /api/control-employee/current-user
 * @desc    Fetch current logged-in user details from the 'admins' table
 */
router.get('/current-user', async (req, res) => {
    try {
        const adminId = getCurrentAdminId(req);

        if (!adminId) {
            return res.status(401).json({ 
                success: false, 
                message: 'Unauthorized: No active admin session found.' 
            });
        }

        const query = `
            SELECT 
                id, google_id, name, email, picture, role, parent_admin_id,
                action, shop_name, phone, address, facebook_link, slogan, 
                shop_about, payment_type, mobile_number, bank_acc_name, 
                bank_acc_number, bank_name, bank_branch, routing_number, 
                status, is_verified, super_admin, created_at, total_sales, 
                total_withdraw, is_deletion_pending
            FROM admins 
            WHERE id = ?
        `;

        const db = req.app.get('db'); 
        
        db.query(query, [adminId], (err, results) => {
            if (err) {
                console.error('Database error fetching current admin:', err);
                return res.status(500).json({ success: false, message: 'Internal server error' });
            }

            if (results.length === 0) {
                return res.status(404).json({ success: false, message: 'Admin user not found in database.' });
            }

            const adminUser = results[0];

            return res.status(200).json({
                success: true,
                message: 'Current admin details fetched successfully',
                data: {
                    id: adminUser.id,
                    name: adminUser.name,
                    email: adminUser.email,
                    role: adminUser.role,
                    shopName: adminUser.shop_name,
                    phone: adminUser.phone,
                    picture: adminUser.picture,
                    superAdminStatus: adminUser.super_admin,
                    status: adminUser.status,
                    isVerified: adminUser.is_verified,
                    totalSales: adminUser.total_sales,
                    totalWithdraw: adminUser.total_withdraw,
                    createdAt: adminUser.created_at
                }
            });
        });

    } catch (error) {
        console.error('Server error in /current-user:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

/**
 * @route   POST /api/control-employee/logout
 * @desc    Logout confirmation (Yes/No niye logout handle korbe)
 */
router.post('/logout', (req, res) => {
    try {
        const { confirmLogout } = req.body; // true (Yes) ba false (No)

        if (!confirmLogout) {
            return res.status(200).json({
                success: false,
                message: 'Logout cancelled by user.'
            });
        }

        if (req.session) {
            req.session.destroy((err) => {
                if (err) {
                    return res.status(500).json({ success: false, message: 'Could not log out, please try again.' });
                }
                res.clearCookie('connect.sid');
                return res.status(200).json({
                    success: true,
                    message: 'Successfully logged out.'
                });
            });
        } else {
            return res.status(200).json({
                success: true,
                message: 'Successfully logged out.'
            });
        }

    } catch (error) {
        console.error('Logout error:', error);
        res.status(500).json({ success: false, message: 'Internal server error during logout' });
    }
});

module.exports = router;