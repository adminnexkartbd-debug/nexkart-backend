const express = require('express');
const router = express.Router();
const db = require('../../db');
const { google } = require('googleapis');

// Google OAuth2 Client Setup
const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID || '',
    process.env.GOOGLE_CLIENT_SECRET || '',
    process.env.GOOGLE_REDIRECT_URI || 'https://developers.google.com/oauthplayground'
);

// Set Refresh Token from Environment Variable
oauth2Client.setCredentials({
    refresh_token: process.env.GOOGLE_REFRESH_TOKEN || ''
});

const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

// Helper Function: MIME Email Create & Encode (HTTP API Format)
function createRawEmail({ to, from, subject, message, html }) {
    const str = [
        `From: ${from}`,
        `To: ${to}`,
        `Subject: ${subject}`,
        `MIME-Version: 1.0`,
        `Content-Type: multipart/alternative; boundary="boundary123"`,
        ``,
        `--boundary123`,
        `Content-Type: text/plain; charset=utf-8`,
        ``,
        message,
        ``,
        `--boundary123`,
        `Content-Type: text/html; charset=utf-8`,
        ``,
        html,
        ``,
        `--boundary123--`
    ].join('\r\n');

    return Buffer.from(str)
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
}

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

// Get Pending Seller Requests
router.get('/get-pending-requests', async (req, res) => {
    try {
        const query = `SELECT * FROM admins WHERE status = 'pending'`;
        const [results] = await db.query(query);
        res.status(200).json({ success: true, requests: results });
    } catch (error) {
        console.error('Error fetching pending requests:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Delete Seller Request
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

// Get All Admins Data
router.get('/get-all-admins', async (req, res) => {
    try {
        const [results] = await db.query(`SELECT * FROM admins`);
        res.status(200).json({ success: true, admins: results });
    } catch (error) {
        console.error('Error fetching all admins:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Permanent Suspension & Product Deletion with Google API Email Notification
router.post('/suspend-and-delete-admin', async (req, res) => {
    try {
        const { id } = req.body;
        if (!id) {
            return res.status(400).json({ success: false, message: 'Admin ID is required.' });
        }

        // 1. Fetch current admin details
        const [adminRows] = await db.query(`SELECT * FROM admins WHERE id = ?`, [id]);
        if (!adminRows || adminRows.length === 0) {
            return res.status(404).json({ success: false, message: 'Admin record not found.' });
        }

        const seller = adminRows[0];
        const sellerEmail = seller.email;

        // 2. Delete products where admin_id matches
        await db.query(`DELETE FROM products WHERE admin_id = ?`, [id]);

        // 3. Clear fields in admins table
        const resetQuery = `
            UPDATE admins 
            SET 
                name = NULL, email = NULL, password = NULL, picture = NULL,
                role = NULL, parent_admin_id = NULL, shop_name = NULL, phone = NULL,
                address = NULL, facebook_link = NULL, slogan = NULL, shop_about = NULL,
                payment_type = 'none', mobile_number = NULL, bank_acc_name = NULL,
                bank_acc_number = NULL, bank_name = NULL, bank_branch = NULL,
                routing_number = NULL, status = 'rejected', is_verified = 0,
                super_admin = 'pending', verification_code = NULL, temp_data = NULL,
                verification_doc = NULL, total_sales = 0.00, total_withdraw = 0.00,
                delete_requested_at = NULL, is_deletion_pending = 0,
                deletion_requested_at = NULL, action = 'suspended'
            WHERE id = ?
        `;
        await db.query(resetQuery, [id]);

        // 4. Send Email via Google REST API
        if (sellerEmail) {
            try {
                const rawEmail = createRawEmail({
                    to: sellerEmail,
                    from: process.env.GMAIL_USER || 'admin.nexkartbd@gmail.com',
                    subject: 'Account Permanently Suspended - Policy Violation',
                    message: `Dear User,\n\nYour account has been permanently suspended due to policy violations.`,
                    html: `
                        <div style="font-family: Arial, sans-serif; padding: 20px; color: #333;">
                            <h2 style="color: #dc2626;">Account Permanent Suspension Notice</h2>
                            <p>Dear User,</p>
                            <p>Your seller account has been <strong>permanently suspended and cleared</strong> due to policy/violence violations.</p>
                            <p>All products linked to your account have been deleted from our system.</p>
                            <br/>
                            <p>Regards,<br/><strong>NexKart Support Team</strong></p>
                        </div>
                    `
                });

                const response = await gmail.users.messages.send({
                    userId: 'me',
                    requestBody: {
                        raw: rawEmail
                    }
                });

                console.log('Google API Email sent successfully:', response.data.id);
            } catch (mailErr) {
                console.error('Error sending Google API mail:', mailErr.message);
            }
        }

        return res.status(200).json({ 
            success: true, 
            message: 'Seller account suspended, fields cleared, products deleted, and email notification sent via Google API.' 
        });

    } catch (error) {
        console.error('Error in suspend-and-delete-admin:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

module.exports = router;