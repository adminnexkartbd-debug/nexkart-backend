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

// ৪. Approve / Reject Action API (Register Requests) with Professional Email
router.post('/api/update-request-status', ensureSuperAdmin, async (req, res) => {
    const { adminId, status } = req.body;

    if (!['approved', 'rejected'].includes(status)) {
        return res.status(400).json({ error: 'Invalid status' });
    }

    try {
        // ১. User-er email ebong name database theke fetch kora
        const [admins] = await db.query("SELECT email, name, shop_name FROM admins WHERE id = ?", [adminId]);
        const adminUser = admins[0];

        // ২. Database-e status update kora
        const query = "UPDATE admins SET status = ? WHERE id = ?";
        await db.query(query, [status, adminId]);

        // ৩. Google Gmail API / Mail Service er maddhome professional email pathano
        if (adminUser && adminUser.email) {
            const oauth2Client = new google.auth.OAuth2(
                process.env.GOOGLE_USER_CLIENT_ID,
                process.env.GOOGLE_USER_CLIENT_SECRET,
                process.env.GOOGLE_OAUTH_REDIRECT_URI
            );

            oauth2Client.setCredentials({
                refresh_token: process.env.GOOGLE_REFRESH_TOKEN
            });

            const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
            
            const isApproved = status === 'approved';
            const subject = isApproved 
                ? 'Congratulations! Your NexKart Seller Account is Approved! 🎉' 
                : 'Update Regarding Your NexKart Seller Registration Request ⚠️';
            
            // Professional & Modern HTML Email Template Design
            const htmlContent = `
                <div style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 40px 0;">
                  <table align="center" border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 600px; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.05);">
                    <!-- Header -->
                    <tr>
                      <td style="background-color: #0f172a; padding: 30px 40px; text-align: center;">
                        <h1 style="color: #ffffff; font-size: 24px; margin: 0; font-weight: 700; letter-spacing: 0.5px;">NexKart</h1>
                      </td>
                    </tr>
                    
                    <!-- Body Content -->
                    <tr>
                      <td style="padding: 40px 30px; color: #334155; font-size: 15px; line-height: 1.6;">
                        <p style="margin-top: 0; font-size: 18px; color: #1e293b; font-weight: 600;">Hello ${adminUser.name || 'Valued Applicant'},</p>
                        
                        <p>We are writing to update you regarding your seller registration request for your shop <b>"${adminUser.shop_name || 'Your Shop'}"</b> on NexKart.</p>
                        
                        <!-- Status Badge Box -->
                        <div style="margin: 30px 0; text-align: center;">
                          <span style="display: inline-block; padding: 10px 24px; font-size: 14px; font-weight: 700; text-transform: uppercase; border-radius: 50px; background-color: ${isApproved ? '#dcfce7' : '#fee2e2'}; color: ${isApproved ? '#166534' : '#991b1b'}; letter-spacing: 0.5px;">
                            Application Status: ${status}
                          </span>
                        </div>

                        <p style="background-color: #f1f5f9; padding: 16px 20px; border-left: 4px solid ${isApproved ? '#22c55e' : '#ef4444'}; border-radius: 4px; margin: 20px 0;">
                          ${isApproved 
                            ? '<b>অভিনন্দন!</b> সফলভাবে আপনার সেলার অ্যাকাউন্টটি অনুমোদন (Approved) করা হয়েছে। এখন আপনি আপনার ড্যাশবোর্ডে লগইন করে প্রোডাক্ট আপলোড এবং মার্কেটপ্লেস পরিচালনা করতে পারবেন।' 
                            : 'দুঃখিত, আপনার সেলার রেজিস্ট্রেশন অনুরোধটি এই মুহূর্তে অনুমোদিত হয়নি। সঠিক তথ্যের ঘাটতি বা পলিসি সংক্রান্ত কারণে এটি বাতিল হতে পারে। প্রয়োজনে আবার সঠিক তথ্য দিয়ে আবেদন করতে পারেন।'}
                        </p>

                        <p style="margin-top: 30px;">If you have any questions or need technical support, feel free to contact our administration team.</p>
                        
                        <p style="margin-top: 35px; margin-bottom: 0;">Best regards,</p>
                        <p style="margin-top: 4px; font-weight: 600; color: #0f172a;">The NexKart Team</p>
                      </td>
                    </tr>
                    
                    <!-- Footer -->
                    <tr>
                      <td style="background-color: #f8fafc; padding: 20px 30px; text-align: center; border-top: 1px solid #e2e8f0; color: #94a3b8; font-size: 12px;">
                        <p style="margin: 0;">&copy; ${new Date().getFullYear()} NexKart. All rights reserved.</p>
                        <p style="margin: 5px 0 0 0;">This is an automated system notification, please do not reply directly to this address.</p>
                      </td>
                    </tr>
                  </table>
                </div>
            `;

            const utf8Subject = `=?utf-8?B?${Buffer.from(subject).toString('base64')}?=`;
            const messageParts = [
                `To: ${adminUser.email}`,
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
                requestBody: {
                    raw: encodedMessage,
                }
            });
        }

        res.json({ success: true, message: `Status updated to ${status} and email sent successfully!` });
    } catch (err) {
        console.error('Database Update or Mail Error:', err);
        res.status(500).json({ error: 'Status update or email sending failed' });
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

// ৬. Update Verification Document Status & Admin Verified Status with Professional Google API Mail
router.post('/api/update-verification-status', ensureSuperAdmin, async (req, res) => {
    const { docId, userId, status } = req.body;

    if (!['approved', 'rejected'].includes(status)) {
        return res.status(400).json({ error: 'Invalid status' });
    }

    try {
        // ১. User er email ebong name database theke ana
        const [users] = await db.query("SELECT email, name FROM admins WHERE id = ?", [userId]);
        const user = users[0];

        // ২. Verification document status update kora
        await db.query("UPDATE verification_doc SET status = ? WHERE id = ?", [status, docId]);

        const isVerifiedVal = status === 'approved' ? 1 : 0;
        await db.query("UPDATE admins SET is_verified = ? WHERE id = ?", [isVerifiedVal, userId]);

        // ৩. Google Gmail API use kore professional email pathano
        if (user && user.email) {
            const oauth2Client = new google.auth.OAuth2(
                process.env.GOOGLE_USER_CLIENT_ID,
                process.env.GOOGLE_USER_CLIENT_SECRET,
                process.env.GOOGLE_OAUTH_REDIRECT_URI
            );

            oauth2Client.setCredentials({
                refresh_token: process.env.GOOGLE_REFRESH_TOKEN
            });

            const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
            
            const isApproved = status === 'approved';
            const subject = isApproved 
                ? 'Your NexKart Seller Account is Verified! 🎉' 
                : 'Action Required: NexKart Verification Update ⚠️';
            
            // Professional & Clean Email Template Design
            const htmlContent = `
                <div style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 40px 0;">
                  <table align="center" border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 600px; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.05);">
                    <!-- Header -->
                    <tr>
                      <td style="background-color: #0f172a; padding: 30px 40px; text-align: center;">
                        <h1 style="color: #ffffff; font-size: 24px; margin: 0; font-weight: 700; letter-spacing: 0.5px;">NexKart</h1>
                      </td>
                    </tr>
                    
                    <!-- Body Content -->
                    <tr>
                      <td style="padding: 40px 30px; color: #334155; font-size: 15px; line-height: 1.6;">
                        <p style="margin-top: 0; font-size: 18px; color: #1e293b; font-weight: 600;">Hello ${user.name || 'Valued User'},</p>
                        
                        <p>We wanted to update you regarding your recent account verification request submitted to the NexKart admin team.</p>
                        
                        <!-- Status Badge Box -->
                        <div style="margin: 30px 0; text-align: center;">
                          <span style="display: inline-block; padding: 10px 24px; font-size: 14px; font-weight: 700; text-transform: uppercase; border-radius: 50px; background-color: ${isApproved ? '#dcfce7' : '#fee2e2'}; color: ${isApproved ? '#166534' : '#991b1b'}; letter-spacing: 0.5px;">
                            Status: ${status}
                          </span>
                        </div>

                        <p style="background-color: #f1f5f9; padding: 16px 20px; border-left: 4px solid ${isApproved ? '#22c55e' : '#ef4444'}; border-radius: 4px; margin: 20px 0;">
                          ${isApproved 
                            ? '<b>Congratulations!</b> Your documents have been successfully verified. You now have full access to all seller features and marketplace privileges on NexKart.' 
                            : 'Unfortunately, your verification was not approved. This can happen due to unclear document images or mismatched information. Please re-submit valid documents or reach out to support.'}
                        </p>

                        <p style="margin-top: 30px;">If you have any questions or need assistance, feel free to reply directly to this email.</p>
                        
                        <p style="margin-top: 35px; margin-bottom: 0;">Best regards,</p>
                        <p style="margin-top: 4px; font-weight: 600; color: #0f172a;">The NexKart Team</p>
                      </td>
                    </tr>
                    
                    <!-- Footer -->
                    <tr>
                      <td style="background-color: #f8fafc; padding: 20px 30px; text-align: center; border-top: 1px solid #e2e8f0; color: #94a3b8; font-size: 12px;">
                        <p style="margin: 0;">&copy; ${new Date().getFullYear()} NexKart. All rights reserved.</p>
                        <p style="margin: 5px 0 0 0;">This is an automated system notification, please do not reply directly to this address unless necessary.</p>
                      </td>
                    </tr>
                  </table>
                </div>
            `;

            const utf8Subject = `=?utf-8?B?${Buffer.from(subject).toString('base64')}?=`;
            const messageParts = [
                `To: ${user.email}`,
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
                requestBody: {
                    raw: encodedMessage,
                }
            });
        }

        res.json({ success: true, message: `Verification request ${status} and professional email sent successfully!` });
    } catch (err) {
        console.error('Database/Mail Error:', err);
        res.status(500).json({ error: 'Status update or email sending failed' });
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

// Update Order/Payment Status API & Send Professional Mail via Google Gmail API
router.post('/api/update-order-status', ensureSuperAdmin, async (req, res) => {
    const { id, field, value } = req.body;

    if (!['payment_status', 'order_status'].includes(field)) {
        return res.status(400).json({ success: false, error: 'Invalid field update' });
    }

    try {
        // ১. Order-er sathe customer-er email, name ebong order details fetch kora
        const [orders] = await db.query("SELECT * FROM orders WHERE id = ?", [id]);
        const order = orders[0];

        if (!order) {
            return res.status(404).json({ success: false, error: 'Order not found' });
        }

        // ২. Database-e order status ba payment status update kora
        const query = `UPDATE orders SET ${field} = ? WHERE id = ?`;
        await db.query(query, [value, id]);

        // ৩. Google Gmail API use kore customer k update mail pathano
        if (order.customer_email) {
            const oauth2Client = new google.auth.OAuth2(
                process.env.GOOGLE_USER_CLIENT_ID,
                process.env.GOOGLE_USER_CLIENT_SECRET,
                process.env.GOOGLE_OAUTH_REDIRECT_URI
            );

            oauth2Client.setCredentials({
                refresh_token: process.env.GOOGLE_REFRESH_TOKEN
            });

            const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
            
            const subject = `Update on Your NexKart Order #${order.order_id || order.id} 🎉`;
            
            // Professional HTML Email Template
            const htmlContent = `
                <div style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 40px 0;">
                  <table align="center" border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 600px; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.05);">
                    <!-- Header -->
                    <tr>
                      <td style="background-color: #0f172a; padding: 30px 40px; text-align: center;">
                        <h1 style="color: #ffffff; font-size: 24px; margin: 0; font-weight: 700;">NexKart</h1>
                      </td>
                    </tr>
                    
                    <!-- Body Content -->
                    <tr>
                      <td style="padding: 40px 30px; color: #334155; font-size: 15px; line-height: 1.6;">
                        <p style="margin-top: 0; font-size: 18px; color: #1e293b; font-weight: 600;">Hello ${order.customer_name || 'Valued Customer'},</p>
                        
                        <p>We are writing to inform you that the status of your order <b>#${order.order_id || order.id}</b> has been updated.</p>
                        
                        <!-- Status Update Box -->
                        <div style="background-color: #f1f5f9; padding: 20px; border-left: 4px solid #10b981; border-radius: 6px; margin: 25px 0;">
                          <p style="margin: 0 0 6px 0; font-size: 12px; font-weight: 700; color: #64748b; text-transform: uppercase;">Updated Information:</p>
                          <p style="margin: 0; font-size: 14px; color: #1e293b;">
                            <b>${field === 'order_status' ? 'Order Status' : 'Payment Status'}:</b> 
                            <span style="text-transform: uppercase; color: #047857; font-weight: bold;">${value}</span>
                          </p>
                        </div>

                        <p>You can track your order status and shipping progress anytime by logging into your NexKart account.</p>
                        
                        <p style="margin-top: 35px; margin-bottom: 0;">Thank you for shopping with us!</p>
                        <p style="margin-top: 4px; font-weight: 600; color: #0f172a;">The NexKart Team</p>
                      </td>
                    </tr>
                    
                    <!-- Footer -->
                    <tr>
                      <td style="background-color: #f8fafc; padding: 20px 30px; text-align: center; border-top: 1px solid #e2e8f0; color: #94a3b8; font-size: 12px;">
                        <p style="margin: 0;">&copy; ${new Date().getFullYear()} NexKart. All rights reserved.</p>
                      </td>
                    </tr>
                  </table>
                </div>
            `;

            const utf8Subject = `=?utf-8?B?${Buffer.from(subject).toString('base64')}?=`;
            const messageParts = [
                `To: ${order.customer_email}`,
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
                requestBody: {
                    raw: encodedMessage,
                }
            });
        }

        res.json({ success: true, message: 'Order status updated and notification email sent successfully!' });
    } catch (err) {
        console.error('Database/Google Mail Error:', err);
        res.status(500).json({ success: false, error: 'Failed to update order status or send email' });
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

// ১১. Ticket Reply & Status Update with Google Gmail API & Lock Closed Tickets
router.post(['/api/update-ticket-reply', '/admin/api/update-ticket-reply'], ensureSuperAdmin, async (req, res) => {
    const { ticketId, adminReply, status } = req.body;

    if (!ticketId || !adminReply) {
        return res.status(400).json({ success: false, error: 'Ticket ID and Reply are required' });
    }

    try {
        // ১. টিকিট ডাটাবেজ থেকে চেক করা যে এটি আগে থেকেই ক্লোজড কিনা
        const [tickets] = await db.query("SELECT * FROM tickets WHERE id = ?", [ticketId]);
        const ticket = tickets[0];

        if (!ticket) {
            return res.status(404).json({ success: false, error: 'Ticket not found' });
        }

        if (ticket.status === 'closed') {
            return res.status(400).json({ success: false, error: 'This ticket is already closed. You cannot reply to a closed ticket.' });
        }

        const newStatus = status || 'closed';

        // ২. ডাটাবেজে এডমিন রিপ্লাই এবং স্ট্যাটাস আপডেট করা
        const query = `UPDATE tickets SET admin_reply = ?, status = ?, updated_at = NOW() WHERE id = ?`;
        const [result] = await db.query(query, [adminReply, newStatus, ticketId]);

        if (result.affectedRows === 0) {
            return res.status(404).json({ success: false, error: 'Failed to update ticket' });
        }

        // ৩. Google Gmail API ব্যবহার করে প্রফেশনাল ইমেল পাঠানো
        if (ticket.email) {
            const oauth2Client = new google.auth.OAuth2(
                process.env.GOOGLE_USER_CLIENT_ID,
                process.env.GOOGLE_USER_CLIENT_SECRET,
                process.env.GOOGLE_OAUTH_REDIRECT_URI
            );

            oauth2Client.setCredentials({
                refresh_token: process.env.GOOGLE_REFRESH_TOKEN
            });

            const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
            
            const isClosed = newStatus === 'closed';
            const subject = `Update on NexKart Support Ticket #${ticket.ticket_number || ticket.id} (${newStatus.toUpperCase()})`;
            
            const htmlContent = `
                <div style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 40px 0;">
                  <table align="center" border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 600px; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.05);">
                    <!-- Header -->
                    <tr>
                      <td style="background-color: #0f172a; padding: 30px 40px; text-align: center;">
                        <h1 style="color: #ffffff; font-size: 24px; margin: 0; font-weight: 700;">NexKart Support</h1>
                      </td>
                    </tr>
                    
                    <!-- Body Content -->
                    <tr>
                      <td style="padding: 40px 30px; color: #334155; font-size: 15px; line-height: 1.6;">
                        <p style="margin-top: 0; font-size: 18px; color: #1e293b; font-weight: 600;">Hello ${ticket.full_name || 'Valued User'},</p>
                        
                        <p>Our support team has responded to your support ticket <b>#${ticket.ticket_number || ticket.id}</b> regarding <i>"${ticket.issue_category || 'General Issue'}"</i>.</p>
                        
                        <!-- Status Badge Box -->
                        <div style="margin: 25px 0; text-align: center;">
                          <span style="display: inline-block; padding: 8px 20px; font-size: 13px; font-weight: 700; text-transform: uppercase; border-radius: 50px; background-color: ${isClosed ? '#fee2e2' : '#dcfce7'}; color: ${isClosed ? '#991b1b' : '#166534'};">
                            Ticket Status: ${newStatus}
                          </span>
                        </div>

                        <!-- Admin Reply Box -->
                        <div style="background-color: #f1f5f9; padding: 20px; border-left: 4px solid ${isClosed ? '#ef4444' : '#2563eb'}; border-radius: 6px; margin: 20px 0;">
                          <p style="margin: 0 0 8px 0; font-size: 12px; font-weight: 700; color: #64748b; text-transform: uppercase;">Official Admin Response:</p>
                          <p style="margin: 0; color: #1e293b; white-space: pre-wrap;">${adminReply}</p>
                        </div>

                        ${isClosed ? '<p style="color: #64748b; font-size: 13px; font-style: italic;">This ticket has now been closed. If you need further assistance, please open a new support ticket from your dashboard.</p>' : ''}

                        <p style="margin-top: 35px; margin-bottom: 0;">Best regards,</p>
                        <p style="margin-top: 4px; font-weight: 600; color: #0f172a;">The NexKart Support Team</p>
                      </td>
                    </tr>
                    
                    <!-- Footer -->
                    <tr>
                      <td style="background-color: #f8fafc; padding: 20px 30px; text-align: center; border-top: 1px solid #e2e8f0; color: #94a3b8; font-size: 12px;">
                        <p style="margin: 0;">&copy; ${new Date().getFullYear()} NexKart. All rights reserved.</p>
                      </td>
                    </tr>
                  </table>
                </div>
            `;

            const utf8Subject = `=?utf-8?B?${Buffer.from(subject).toString('base64')}?=`;
            const messageParts = [
                `To: ${ticket.email}`,
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
                requestBody: {
                    raw: encodedMessage,
                }
            });
        }

        return res.json({ success: true, message: 'Reply sent successfully via Google API and email dispatched!' });

    } catch (err) {
        console.error('Database/Google Mail Error:', err);
        return res.status(500).json({ success: false, error: 'Failed to send reply or email via Google API' });
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