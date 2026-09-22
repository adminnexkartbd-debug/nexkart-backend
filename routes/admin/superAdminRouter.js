const express = require('express');
const router = express.Router();
const path = require('path');
const db = require('../../db');
const { google } = require('googleapis');

const { sendWithdrawEmail } = require('../../services/withdrawmail');
const { 
    sendSellerWarningEmail, 
    sendSellerBanEmail, 
    sendSellerUnbanEmail 
} = require('../../services/sellerMailService');// Super Admin Auth Guard Middleware

function ensureSuperAdmin(req, res, next) {
    if (req.isAuthenticated && req.isAuthenticated()) {
        if (req.user && (req.user.super_admin === 'approved' || req.user.role === 'superadmin')) {
            return next();
        } else {
            return res.status(403).json({ error: 'Permission Denied' });
        }
    }
    return res.status(401).json({ error: 'Unauthorized Access' });
}

// ১. Super Admin Page Render
router.get('/superAdmin.html', (req, res) => {
    res.sendFile(path.join(__dirname, '../../public/admin/superAdmin.html'));
});

// ২. Logged-in Super Admin Info API
router.get('/api/current-super-admin', ensureSuperAdmin, (req, res) => {
    if (!req.user) {
        return res.status(401).json({ error: 'User not logged in' });
    }
    res.json({
        name: req.user.name || 'Super Admin',
        picture: req.user.picture || '/default-avatar.png'
    });
});

// ৩. Pending Register Requests API
router.get('/api/pending-requests', ensureSuperAdmin, async (req, res) => {
    const query = `
        SELECT id, name, email, picture, shop_name, status, super_admin, created_at 
        FROM admins 
        WHERE status = 'pending' 
        ORDER BY created_at DESC
    `;
    
    try {
        const [results] = await db.query(query);
        res.json(results);
    } catch (err) {
        console.error('Database Error:', err);
        res.status(500).json({ error: 'Database query failed' });
    }
});

// ৪. Approve / Reject Action API (Register Requests)
router.post('/api/update-request-status', ensureSuperAdmin, async (req, res) => {
    const { adminId, status } = req.body;

    if (!['approved', 'rejected'].includes(status)) {
        return res.status(400).json({ error: 'Invalid status' });
    }

    const query = "UPDATE admins SET status = ? WHERE id = ?";
    
    try {
        const [result] = await db.query(query, [status, adminId]);
        res.json({ success: true, message: `Status updated to ${status}` });
    } catch (err) {
        console.error('Database Update Error:', err);
        res.status(500).json({ error: 'Update failed' });
    }
});

// ================= VERIFICATION REQUESTS APIs =================

// ৫. Get User Verification Requests (JOIN with admins)
router.get('/api/verification-requests', ensureSuperAdmin, async (req, res) => {
    const query = `
        SELECT 
            vd.id AS doc_id,
            vd.user_id,
            vd.document_type,
            vd.document_number,
            vd.file_url,
            vd.status AS doc_status,
            vd.created_at AS doc_created_at,
            a.name,
            a.email,
            a.picture,
            a.is_verified
        FROM verification_doc vd
        JOIN admins a ON vd.user_id = a.id
        ORDER BY vd.created_at DESC
    `;

    try {
        const [results] = await db.query(query);
        res.json(results);
    } catch (err) {
        console.error('Database Error:', err);
        res.status(500).json({ error: 'Verification requests fetch failed' });
    }
});

// ৬. Update Verification Document Status & Admin Verified Status
router.post('/api/update-verification-status', ensureSuperAdmin, async (req, res) => {
    const { docId, userId, status } = req.body;

    if (!['approved', 'rejected'].includes(status)) {
        return res.status(400).json({ error: 'Invalid status' });
    }

    try {
        await db.query("UPDATE verification_doc SET status = ? WHERE id = ?", [status, docId]);

        const isVerifiedVal = status === 'approved' ? 1 : 0;
        await db.query("UPDATE admins SET is_verified = ? WHERE id = ?", [isVerifiedVal, userId]);

        res.json({ success: true, message: `Verification request ${status}` });
    } catch (err) {
        console.error('Database Update Error:', err);
        res.status(500).json({ error: 'Status update failed' });
    }
});

// ================= ALL ORDERS APIs =================

// ৭. All Orders Fetch API
router.get('/api/all-orders', ensureSuperAdmin, async (req, res) => {
    const query = `
        SELECT 
            id, order_id, user_id, product_id, seller_id, quantity, variant, 
            subtotal_price, delivery_charge, discount_amount, total_amount, 
            payment_method, selected_gateway, payment_status, order_status, 
            tracking_number, customer_name, customer_email, customer_phone, 
            shipping_address, created_at 
        FROM orders 
        ORDER BY created_at DESC
    `;
    
    try {
        const [results] = await db.query(query);
        res.json(results);
    } catch (err) {
        console.error('Database Fetch Error:', err);
        res.status(500).json({ error: 'Failed to fetch orders' });
    }
});

// ৮. Update Order/Payment Status API
router.post('/api/update-order-status', ensureSuperAdmin, async (req, res) => {
    const { id, field, value } = req.body;

    if (!['payment_status', 'order_status'].includes(field)) {
        return res.status(400).json({ error: 'Invalid field update' });
    }

    const query = `UPDATE orders SET ${field} = ? WHERE id = ?`;

    try {
        await db.query(query, [value, id]);
        res.json({ success: true, message: `${field} updated successfully` });
    } catch (err) {
        console.error('Database Update Error:', err);
        res.status(500).json({ error: 'Failed to update order status' });
    }
});

// ================= ALL COMMISSIONS API =================

// ৯. Fetch All Commissions (JOIN with admins for Seller Name and Email)
router.get('/api/all-commissions', ensureSuperAdmin, async (req, res) => {
    const query = `
        SELECT 
            c.id, 
            c.order_number, 
            c.commission_rate, 
            c.commission_amount, 
            c.seller_id, 
            c.date,
            a.name AS seller_name,
            a.email AS seller_email
        FROM commission_table c
        LEFT JOIN admins a ON c.seller_id = a.id
        ORDER BY c.date DESC
    `;

    try {
        const [results] = await db.query(query);
        res.json(results);
    } catch (err) {
        console.error('Database Fetch Error:', err);
        res.status(500).json({ error: 'Failed to fetch commissions' });
    }
});

// ================= TICKETS & COMPLAINS APIs =================

// ১০. সকল Support Tickets ফেস করার API
router.get('/api/tickets', ensureSuperAdmin, async (req, res) => {
    const query = `
        SELECT id, ticket_number, full_name, email, issue_category, message, attachment_path, status, admin_reply, created_at 
        FROM tickets 
        ORDER BY created_at DESC
    `;
    try {
        const [results] = await db.query(query);
        res.json(results);
    } catch (err) {
        console.error('Database Fetch Error:', err);
        res.status(500).json({ error: 'Failed to fetch tickets' });
    }
});

router.post(['/api/update-ticket-reply', '/admin/api/update-ticket-reply'], async (req, res) => {
    const { ticketId, adminReply, status } = req.body;

    if (!ticketId || !adminReply) {
        return res.status(400).json({ success: false, error: 'Ticket ID and Reply are required' });
    }

    const query = `UPDATE tickets SET admin_reply = ?, status = ?, updated_at = NOW() WHERE id = ?`;

    try {
        const [result] = await db.query(query, [adminReply, status || 'closed', ticketId]);
        if (result.affectedRows > 0) {
            return res.json({ success: true, message: 'Reply saved successfully' });
        } else {
            return res.status(404).json({ success: false, error: 'Ticket not found' });
        }
    } catch (err) {
        console.error('Database Update Error:', err);
        return res.status(500).json({ success: false, error: 'Failed to send reply' });
    }
});

// ================= IPR REPORTS APIs =================

// ১. IPR Reports Fetch করার API
router.get('/api/ipr-reports', ensureSuperAdmin, async (req, res) => {
    const query = `
        SELECT id, user_id, brand_name, contact_email, infringement_type, product_url, description, status, created_at 
        FROM ipr_reports 
        ORDER BY created_at DESC
    `;
    
    try {
        const [results] = await db.query(query);
        res.json(results);
    } catch (err) {
        console.error('Database Error:', err);
        res.status(500).json({ error: 'Failed to fetch IPR reports' });
    }
});

// ২. Email পাঠানোর পর Status Update (resolved) করার API (Google API use kore)
router.post('/api/update-ipr-status', ensureSuperAdmin, async (req, res) => {
    const { id, email } = req.body;

    if (!id) {
        return res.status(400).json({ success: false, error: 'IPR Report ID is required' });
    }

    try {
        // ১. Google API OAuth2 client setup ebong mail pathano
        if (email) {
            const oauth2Client = new google.auth.OAuth2(
                process.env.GOOGLE_USER_CLIENT_ID,
                process.env.GOOGLE_USER_CLIENT_SECRET,
                process.env.GOOGLE_OAUTH_REDIRECT_URI
            );

            oauth2Client.setCredentials({
                refresh_token: process.env.GOOGLE_REFRESH_TOKEN
            });

            const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
            
            const subject = 'Update Regarding Your Intellectual Property Rights (IPR) Infringement Report';
            const htmlContent = `
                <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
                  <h2 style="color: #047857; border-bottom: 2px solid #10b981; padding-bottom: 10px; margin-top: 0;">IPR Report Status: Resolved</h2>
                  <p>Dear Valued Brand Representative,</p>
                  <p>Thank you for bringing this matter to our attention. We have carefully reviewed your Intellectual Property Rights (IPR) infringement report (Report ID: <b>${id}</b>).</p>
                  <p>Our team has successfully processed your request and taken the necessary action regarding the reported product listing in accordance with our marketplace policies.</p>
                  <p style="margin-top: 25px;">Thank you for your cooperation and for helping us maintain a safe, secure, and authentic marketplace.</p>
                  <br/>
                  <p style="margin-bottom: 0;">Best regards,</p>
                  <p style="margin-top: 5px;"><b>NexKart Administration Team</b></p>
                </div>
            `;

            const utf8Subject = `=?utf-8?B?${Buffer.from(subject).toString('base64')}?=`;
            const messageParts = [
                `To: ${email}`,
                `Subject: ${utf8Subject}`,
                'MIME-Version: 1.0',
                'Content-Type: text/html; charset=utf-8',
                '',
                htmlContent,
            ];
            const message = messageParts.join('\n');
            const encodedMessage = Buffer.from(message)
                .toString('base64')
                .replace(/\+/g, '-')
                .replace(/\//g, '_')
                .replace(/=+$/, '');

            await gmail.users.messages.send({
                userId: 'me',
                request_body: {
                    raw: encodedMessage,
                },
                requestBody: {
                    raw: encodedMessage,
                }
            });
        }

        // ২. Dataabase e status 'resolved' update kora
        const query = "UPDATE ipr_reports SET status = 'resolved' WHERE id = ?";
        const [result] = await db.query(query, [id]);

        if (result.affectedRows > 0) {
            return res.json({ success: true, message: 'Mail sent successfully via Google API & status updated to resolved' });
        } else {
            return res.status(404).json({ success: false, error: 'IPR report not found' });
        }

    } catch (err) {
        console.error('Error in Google API mail sending or database update:', err);
        return res.status(500).json({ success: false, error: 'Failed to send mail via Google API or update status' });
    }
});
// ================= SELLER ACTION/STATUS LIST API =================
router.get('/api/seller-status-list', ensureSuperAdmin, async (req, res) => {
    const query = `
        SELECT 
            id, 
            name, 
            shop_name, 
            email, 
            phone, 
            action 
        FROM admins 
        ORDER BY id DESC
    `;

    try {
        const [results] = await db.query(query);
        res.json(results);
    } catch (err) {
        console.error('Database Fetch Error:', err);
        res.status(500).json({ error: 'Failed to fetch seller action list' });
    }
});

// Update Seller Action API & Send Mail via sellerMailService
router.post('/api/update-seller-status', ensureSuperAdmin, async (req, res) => {
  const { sellerId, status } = req.body; // ফ্রন্টএন্ড থেকে আসা স্ট্যাটাস বা অ্যাকশন ভ্যালু

  const allowedActions = ['active', 'warning', 'suspended', 'delete'];
  if (!allowedActions.includes(status)) {
    return res.status(400).json({ success: false, error: 'Invalid action value' });
  }

  try {
    // সেলারের ইমেল এবং শপ নাম বের করে নেওয়া
    const [sellers] = await db.query("SELECT email, shop_name FROM admins WHERE id = ?", [sellerId]);
    const seller = sellers[0];

    // ডাটাবেজে action কলামে মান আপডেট
    let dbAction = status;
    if (status === 'delete') dbAction = 'inactive'; 

    const query = "UPDATE admins SET action = ? WHERE id = ?";
    await db.query(query, [dbAction, sellerId]);

    // অ্যাকশন অনুযায়ী sellerMailService থেকে প্রফেশনাল মেইল পাঠানো
    if (seller && seller.email) {
      if (status === 'warning') {
        await sendSellerWarningEmail(seller.email, seller.shop_name || 'Shop', 'Violation of terms and conditions. Please maintain guidelines.');
      } else if (status === 'suspended') {
        await sendSellerBanEmail(seller.email, 'Your account has been suspended by the administration.');
      } else if (status === 'active') {
        // যদি suspended বা warning থেকে আবার active করা হয়
        await sendSellerUnbanEmail(seller.email);
      }
    }

    res.json({ success: true, message: `Seller action updated to ${status} and email sent successfully!` });
  } catch (err) {
    console.error('Database/Mail Error:', err);
    res.status(500).json({ success: false, error: 'Failed to update seller action' });
  }
});


// ================= WITHDRAWAL REQUESTS APIS =================

// ১. সকল উইথড্র রিকোয়েস্ট ফেচ করার API
router.get('/api/withdrawal-requests', ensureSuperAdmin, async (req, res) => {
    const query = `
        SELECT 
            id, admin_id, user_name, user_profile, amount, payment_type, 
            mobile_number, bank_acc_name, bank_acc_number, bank_name, 
            bank_branch, routing_number, transaction_id, status, created_at 
        FROM withdraw_request 
        ORDER BY created_at DESC
    `;

    try {
        const [results] = await db.query(query);
        res.json(results);
    } catch (err) {
        console.error('Database Fetch Error:', err);
        res.status(500).json({ error: 'Failed to fetch withdrawal requests' });
    }
});
// ২. উইথড্র স্ট্যাটাস (Pending, Approved, Rejected) আপডেট করার API
router.post('/api/update-withdrawal-status', ensureSuperAdmin, async (req, res) => {
    const { id, status } = req.body;

    const allowedStatuses = ['pending', 'approved', 'rejected'];
    if (!allowedStatuses.includes(status)) {
        return res.status(400).json({ success: false, error: 'Invalid status value' });
    }

    try {
        // ১. ডাটাবেজ থেকে সেলারের ইমেইল, নাম এবং অন্যান্য তথ্য খুঁজে নিন
        const [rows] = await db.query(`
            SELECT wr.*, a.email 
            FROM withdraw_request wr 
            JOIN admins a ON wr.admin_id = a.id 
            WHERE wr.id = ?`, [id]);

        if (rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Request not found' });
        }

        const request = rows[0];

        // ২. ডাটাবেজে স্ট্যাটাস আপডেট করুন
        const [result] = await db.query("UPDATE withdraw_request SET status = ? WHERE id = ?", [status, id]);

        if (result.affectedRows > 0) {
            // ৩. স্ট্যাটাস অনুযায়ী ফলব্যাক API মেল সিস্টেম কল করা হলো
            if (status === 'approved' || status === 'rejected') {
                await sendWithdrawEmail({
                    sellerEmail: request.email,
                    userName: request.user_name,
                    amount: request.amount,
                    paymentType: request.payment_type,
                    transactionId: request.transaction_id,
                    status: status
                });
            }

            return res.json({ success: true, message: `Status updated to ${status} and mail sent successfully!` });
        } else {
            return res.status(404).json({ success: false, error: 'Failed to update' });
        }
    } catch (err) {
        console.error('Database/Mail Error:', err);
        res.status(500).json({ success: false, error: 'Failed to update withdrawal status' });
    }
});

module.exports = router;