const express = require('express');
const router = express.Router();
const db = require('../../db');

// Verify PIN
router.post('/verify-pin', async (req, res) => {
    try {
        const { pin } = req.body;
        if (pin === undefined || pin === null || pin === '') {
            return res.status(400).json({ success: false, message: 'Pin number is required.' });
        }
        const query = `SELECT secreat_code_admin FROM secreat LIMIT 1`;
        const [results] = await db.query(query);

        if (!results || results.length === 0) {
            return res.status(404).json({ success: false, message: 'Secret code configuration not found in database.' });
        }

        const dbPin = Number(results[0].secreat_code_admin);
        const userPin = Number(pin);

        if (dbPin === userPin) {
            if (req.session) {
                req.session.pinVerified = true;
            }
            return res.status(200).json({ success: true, message: 'Pin verified successfully.' });
        } else {
            return res.status(401).json({ success: false, message: 'Incorrect pin number. Please try again.' });
        }
    } catch (error) {
        console.error('Server error in /verify-pin:', error);
        res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
});

// Get Commission Rate
router.get('/get-commission', async (req, res) => {
    try {
        const [results] = await db.query(`SELECT commision_rate FROM comission LIMIT 1`);
        if (!results || results.length === 0) {
            return res.status(404).json({ success: false, message: 'Commission rate not found.' });
        }
        res.status(200).json({ success: true, rate: results[0].commision_rate });
    } catch (error) {
        console.error('Error fetching commission:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Update Commission Rate
router.post('/update-commission', async (req, res) => {
    try {
        const { rate } = req.body;
        if (rate === undefined || rate === null || rate === '') {
            return res.status(400).json({ success: false, message: 'Commission rate is required.' });
        }
        await db.query(`UPDATE comission SET commision_rate = ? WHERE id = 1`, [rate]);
        res.status(200).json({ success: true, message: 'Commission rate updated successfully.' });
    } catch (error) {
        console.error('Error updating commission:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Get Registered Users
router.get('/get-users', async (req, res) => {
    try {
        const [results] = await db.query(`SELECT id, name, created_at, email, phone_number, password FROM users`);
        res.status(200).json({ success: true, users: results });
    } catch (error) {
        console.error('Error fetching users:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Get All Sellers
router.get('/get-sellers', async (req, res) => {
    try {
        const query = `
            SELECT 
                id, name, email, shop_name, phone AS phone_number, password, is_verified, super_admin,
                COALESCE(total_sales, 0) AS total_sale,
                COALESCE(total_withdraw, 0) AS total_withdraw
            FROM admins 
            WHERE role = 'seller'
        `;
        const [results] = await db.query(query);
        res.status(200).json({ success: true, sellers: results });
    } catch (error) {
        console.error('Error fetching sellers:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Update Seller Status
router.post('/update-seller-status', async (req, res) => {
    try {
        const { id, super_admin } = req.body;
        if (!id || !super_admin) {
            return res.status(400).json({ success: false, message: 'Seller ID and status are required.' });
        }
        await db.query(`UPDATE admins SET super_admin = ? WHERE id = ?`, [super_admin, id]);
        res.status(200).json({ success: true, message: 'Seller super admin status updated successfully.' });
    } catch (error) {
        console.error('Error updating seller status:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ==================== NEW FEATURES ====================

// Get Pending Seller Requests (status = 'pending')
router.get('/get-pending-requests', async (req, res) => {
    try {
        const query = `
            SELECT * FROM admins 
            WHERE status = 'pending'
        `;
        const [results] = await db.query(query);
        res.status(200).json({ success: true, requests: results });
    } catch (error) {
        console.error('Error fetching pending requests:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Delete Seller Request from admins table
router.post('/delete-request', async (req, res) => {
    try {
        const { id } = req.body;
        if (!id) {
            return res.status(400).json({ success: false, message: 'Seller ID is required.' });
        }

        await db.query(`DELETE FROM admins WHERE id = ?`, [id]);
        res.status(200).json({ success: true, message: 'Seller request deleted successfully.' });
    } catch (error) {
        console.error('Error deleting seller request:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

module.exports = router;