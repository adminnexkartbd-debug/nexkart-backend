const express = require('express');
const router = express.Router();
const path = require('path');
const crypto = require('crypto');
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

// Commission records enriched with COD ledger (one ledger row per order).
// The ledger is informational: its commission_amount is NOT added again to commission_table.
router.get('/api/all-commissions', ensureSuperAdmin, async (req, res) => {
    try {
        // The commission table is the source of truth. Optional report tables
        // must never prevent the primary commission list from loading.
        const [rows] = await db.query(`
            SELECT c.id, c.order_number, c.commission_rate, c.commission_amount,
                   c.seller_id, c.payment_type, c.date,
                   a.name AS seller_name, a.email AS seller_email
            FROM commission_table c
            LEFT JOIN admins a ON a.id = c.seller_id
            ORDER BY c.date DESC, c.id DESC
        `);
        const results = rows.map(row => ({
            ...row,
            cod_product_amount: null, cod_delivery_charge: null,
            cod_ledger_commission: null, cod_seller_amount: null,
            cod_collection_status: null, payment_method: null,
            payment_status: null, order_status: null, order_total: null,
            order_discount: null, order_subtotal: null
        }));
        const key = (order, seller) => `${String(order)}::${String(seller)}`;
        const index = new Map();
        for (const row of results) {
            const k = key(row.order_number, row.seller_id);
            if (!index.has(k)) index.set(k, []);
            index.get(k).push(row);
        }
        // Enrichment is best-effort and independent of commission loading.
        try {
            const [cols] = await db.query('SHOW COLUMNS FROM seller_cod_ledger');
            const names = new Set(cols.map(c => c.Field));
            const fields = ['product_amount','delivery_charge','commission_amount','seller_amount','collection_status']
                .filter(name => names.has(name));
            if (names.has('order_id') && names.has('seller_id') && fields.length) {
                const [ledger] = await db.query(`SELECT order_id, seller_id, ${fields.map(f => '`'+f+'`').join(', ')} FROM seller_cod_ledger`);
                const seen = new Set();
                for (const item of ledger) {
                    const k = key(item.order_id, item.seller_id);
                    if (seen.has(k)) continue;
                    seen.add(k);
                    for (const row of index.get(k) || []) {
                        if (item.product_amount !== undefined) row.cod_product_amount = item.product_amount;
                        if (item.delivery_charge !== undefined) row.cod_delivery_charge = item.delivery_charge;
                        if (item.commission_amount !== undefined) row.cod_ledger_commission = item.commission_amount;
                        if (item.seller_amount !== undefined) row.cod_seller_amount = item.seller_amount;
                        if (item.collection_status !== undefined) row.cod_collection_status = item.collection_status;
                    }
                }
            }
        } catch (extraErr) {
            console.warn('Optional COD ledger enrichment skipped:', extraErr.message);
        }
        try {
            const [cols] = await db.query('SHOW COLUMNS FROM orders');
            const names = new Set(cols.map(c => c.Field));
            const fields = ['payment_method','payment_status','order_status','total_amount','discount_amount','subtotal_price']
                .filter(name => names.has(name));
            if (names.has('order_id') && names.has('seller_id') && fields.length) {
                const [orders] = await db.query(`SELECT order_id, seller_id, ${fields.map(f => '`'+f+'`').join(', ')} FROM orders`);
                const seen = new Set();
                for (const item of orders) {
                    const k = key(item.order_id, item.seller_id);
                    if (seen.has(k)) continue;
                    seen.add(k);
                    for (const row of index.get(k) || []) {
                        if (item.payment_method !== undefined) row.payment_method = item.payment_method;
                        if (item.payment_status !== undefined) row.payment_status = item.payment_status;
                        if (item.order_status !== undefined) row.order_status = item.order_status;
                        if (item.total_amount !== undefined) row.order_total = item.total_amount;
                        if (item.discount_amount !== undefined) row.order_discount = item.discount_amount;
                        if (item.subtotal_price !== undefined) row.order_subtotal = item.subtotal_price;
                    }
                }
            }
        } catch (extraErr) {
            console.warn('Optional order enrichment skipped:', extraErr.message);
        }
        res.json(results);
    } catch (err) {
        console.error('Commission report primary query error:', err);
        res.status(500).json({ error: 'Failed to fetch commissions' });
    }
});

// COD settlement: payment_type='unpaid' is the sole settlement eligibility condition.
// Use commission_table IDs, not order joins, to avoid duplicate deductions.
const settlementMoney = v => Math.round(Number(v || 0) * 100) / 100;
async function settlementEmail(to, subject, html, attachment) {
    if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) throw new Error('Seller email missing or invalid');
    const errors=[];
    // Try configured Resend first, then Gmail. One failed provider must not prevent fallback.
    if (process.env.RESEND_API_KEY && (process.env.SETTLEMENT_FROM_EMAIL || process.env.RESEND_FROM_EMAIL)) {
        try {
            const payload={from:process.env.SETTLEMENT_FROM_EMAIL || process.env.RESEND_FROM_EMAIL,to:[to],subject,html};
            if(attachment)payload.attachments=[{filename:'NexkartBD-Commission-Settlement.pdf',content:attachment.toString('base64')}];
            const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${process.env.RESEND_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify(payload)});
            const result=await response.json().catch(()=>({}));
            if(!response.ok || !result.id)throw new Error(result.message || `HTTP ${response.status}`);
            console.info('COD receipt email accepted by Resend:',result.id);
            return result.id;
        }catch(e){errors.push('Resend: '+e.message);console.error('COD receipt Resend failed; trying Gmail:',e.message);}
    }
    const required=['GOOGLE_USER_CLIENT_ID','GOOGLE_USER_CLIENT_SECRET','GOOGLE_REFRESH_TOKEN'];
    const missing=required.filter(k=>!process.env[k]);
    if(!missing.length){
        try {
            const oauth=new google.auth.OAuth2(process.env.GOOGLE_USER_CLIENT_ID,process.env.GOOGLE_USER_CLIENT_SECRET,process.env.GOOGLE_OAUTH_REDIRECT_URI);
            oauth.setCredentials({refresh_token:process.env.GOOGLE_REFRESH_TOKEN});
            const gmail=google.gmail({version:'v1',auth:oauth});
            const boundary='nexkart_settlement_'+crypto.randomBytes(8).toString('hex');
            const encodedSubject='=?UTF-8?B?'+Buffer.from(subject).toString('base64')+'?=';
            const from=process.env.SETTLEMENT_FROM_EMAIL || process.env.GMAIL_FROM_EMAIL || process.env.GOOGLE_SENDER_EMAIL;
            const parts=[...(from?[`From: ${from}`]:[]),`To: ${to}`,`Subject: ${encodedSubject}`,'MIME-Version: 1.0',`Content-Type: multipart/mixed; boundary="${boundary}"`,'',`--${boundary}`,'Content-Type: text/html; charset=UTF-8','Content-Transfer-Encoding: base64','',Buffer.from(html).toString('base64')];
            if(attachment)parts.push(`--${boundary}`,'Content-Type: application/pdf; name="NexkartBD-Commission-Settlement.pdf"','Content-Disposition: attachment; filename="NexkartBD-Commission-Settlement.pdf"','Content-Transfer-Encoding: base64','',attachment.toString('base64'));
            parts.push(`--${boundary}--`,'');
            const raw=Buffer.from(parts.join('\r\n')).toString('base64url');
            const sent=await gmail.users.messages.send({userId:'me',requestBody:{raw}});
            if(!sent.data?.id)throw new Error('Gmail did not return message ID');
            console.info('COD receipt email accepted by Gmail:',sent.data.id);
            return sent.data.id;
        }catch(e){errors.push('Gmail: '+(e.response?.data?.error?.message||e.message));console.error('COD receipt Gmail failed:',e.response?.data||e.message);}
    }else errors.push('Gmail OAuth missing: '+missing.join(', '));
    throw new Error('All settlement email providers failed. '+errors.join(' | '));
}
// Random opaque tokens are stored hashed in MySQL; no new .env secrets required.
const settlementOrigin = () => String(process.env.APP_URL || 'https://www.nexkartbd.com').replace(/\/$/, '');
const settlementTokenHash = token => crypto.createHash('sha256').update(token).digest('hex');
function makeSettlementLink(token) { return `${settlementOrigin()}/admin/cod-commission-payment/${encodeURIComponent(token)}`; }
router.get('/cod-commission-payment/:token', async (req,res)=>{
    try {
        const token=String(req.params.token||'');
        if(!/^[a-f0-9]{64}$/.test(token)) return res.status(404).send('Invalid payment link');
        const [[p]]=await db.query('SELECT id,seller_id,method,number,amount,status,expires_at FROM cod_commission_payment_requests WHERE token_hash=? LIMIT 1',[settlementTokenHash(token)]);
        if(!p || new Date(p.expires_at).getTime()<Date.now()) return res.status(410).send('Payment request expired or unavailable');
        if(p.status==='submitted') return res.type('html').send('<h2>Payment details submitted. Awaiting verification. Thank you!</h2>');
        if(p.status==='settled') return res.type('html').send('<h2>Commission already settled. Thank you!</h2>');
        const [[due]]=await db.query("SELECT COALESCE(SUM(c.commission_amount),0) AS amount FROM cod_commission_payment_items i JOIN commission_table c ON c.id=i.commission_id WHERE i.request_id=? AND c.seller_id=? AND LOWER(TRIM(c.payment_type))='unpaid'",[p.id,p.seller_id]);
        if(Number(due.amount)<=0) return res.send('<h2>Commission already settled. Thank you!</h2>');
        const amount=settlementMoney(due.amount);
        res.set('Cache-Control','no-store').type('html').send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>NexkartBD | Commission Payment</title><style>body{margin:0;background:#eef2f7;font:15px Arial;color:#0f172a;padding:24px}main{max-width:540px;margin:auto;background:white;border-radius:20px;box-shadow:0 10px 35px #1e293b18;overflow:hidden}header{background:#0f172a;padding:28px;color:white}header img{max-width:155px}section{padding:26px}.amount{background:#ecfdf5;border-radius:12px;padding:18px;font-size:27px;font-weight:bold}label{display:block;margin-top:18px;font-weight:600}input{box-sizing:border-box;width:100%;padding:13px;border:1px solid #cbd5e1;border-radius:9px;margin-top:7px;font-size:16px}button{background:#0f766e;border:0;color:white;padding:14px;width:100%;border-radius:10px;margin-top:22px;font-weight:bold;cursor:pointer}.hint{font-size:13px;color:#475569;line-height:1.6}#msg{margin-top:15px}</style></head><body><main><header><img src="${settlementLogoUrl}" alt="NexkartBD"><h2>Commission Payment</h2></header><section><p>Send the amount to the following ${settlementEscape(p.method.toUpperCase())} number.</p><div class="amount">৳${amount.toFixed(2)}</div><p><b>Method:</b> ${settlementEscape(p.method.toUpperCase())}<br><b>Number:</b> ${settlementEscape(p.number)}</p><p class="hint">After sending money, submit the number you paid from and the transaction ID. Payment will remain unpaid until Super Admin verifies it.</p><form id="payForm"><label>Sender mobile number<input name="sender_number" pattern="01[0-9]{9}" maxlength="11" required placeholder="01XXXXXXXXX"></label><label>Transaction ID (TrxID)<input name="transaction_id" maxlength="100" minlength="5" required placeholder="Enter your payment TrxID"></label><button type="submit">Submit Payment Details</button></form><p id="msg" role="status"></p><p class="hint">Thank you for being a NexkartBD seller.</p></section></main><script>document.getElementById('payForm').addEventListener('submit',async e=>{e.preventDefault();const f=e.target,b=f.querySelector('button'),m=document.getElementById('msg');b.disabled=true;m.textContent='Submitting...';try{const r=await fetch(location.pathname+'/submit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sender_number:f.sender_number.value,transaction_id:f.transaction_id.value})});const d=await r.json();if(!r.ok)throw Error(d.error||'Failed');m.textContent='Submitted successfully. NexkartBD will verify your payment. Thank you!';f.style.display='none';}catch(err){m.textContent=err.message;b.disabled=false;}});</script></body></html>`);
    }catch(err){console.error('Payment page:',err);res.status(500).send('Payment page temporarily unavailable');}
});
router.post('/cod-commission-payment/:token/submit',async(req,res)=>{
    const token=String(req.params.token||'');
    const sender=String(req.body?.sender_number||'').trim();
    const trx=String(req.body?.transaction_id||'').trim();
    if(!/^[a-f0-9]{64}$/.test(token)||!/^01\d{9}$/.test(sender)||! /^[A-Za-z0-9_-]{5,100}$/.test(trx))return res.status(400).json({error:'Valid mobile number and transaction ID required'});
    try{
        const [result]=await db.query("UPDATE cod_commission_payment_requests SET sender_number=?,transaction_id=?,status='submitted',submitted_at=NOW() WHERE token_hash=? AND expires_at>NOW() AND status='pending'",[sender,trx,settlementTokenHash(token)]);
        if(!result.affectedRows)return res.status(409).json({error:'Payment request expired or already settled'});
        res.json({success:true});
    }catch(err){console.error('Payment submission:',err);res.status(500).json({error:'Unable to submit payment details'});}
});
router.get('/api/cod-settlements/payment-submissions',ensureSuperAdmin,async(req,res)=>{
    try{const [rows]=await db.query("SELECT id,seller_id,method,number,amount,sender_number,transaction_id,submitted_at,status FROM cod_commission_payment_requests WHERE status='submitted' ORDER BY submitted_at DESC LIMIT 100");res.json(rows);}catch(err){console.error(err);res.status(500).json({error:'Unable to load submissions'});}
});
const settlementLogoUrl = 'https://res.cloudinary.com/yhctkgwj/image/upload/v1791893714/nexkart.png';
const settlementEscape = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function settlementMailHtml({ seller, amount, rows, title, message, method, number, paymentUrl, settled }) {
    const detail = rows.map(x => `<tr><td style="padding:11px;border-bottom:1px solid #e2e8f0">#${settlementEscape(x.order_number)}<br><small style="color:#64748b">Commission ID ${x.id}</small></td><td style="padding:11px;border-bottom:1px solid #e2e8f0;text-align:right">BDT ${settlementMoney(x.commission_amount).toFixed(2)}</td></tr>`).join('');
    const button = paymentUrl ? `<p style="margin:26px 0"><a href="${settlementEscape(paymentUrl)}" style="background:#0f766e;color:#fff;padding:14px 22px;border-radius:10px;text-decoration:none;font-weight:bold">Pay commission securely</a></p><p style="font-size:12px;color:#64748b;word-break:break-all">${settlementEscape(paymentUrl)}</p>` : '';
    return `<!doctype html><html><body style="margin:0;background:#f1f5f9;font-family:Arial,sans-serif;color:#0f172a"><div style="max-width:620px;margin:32px auto;background:#fff;border-radius:18px;overflow:hidden"><div style="background:#0f172a;padding:30px;color:#fff"><img src="${settlementLogoUrl}" alt="NexkartBD" style="max-height:54px;max-width:180px"><h1 style="margin:20px 0 4px;font-size:24px">${settlementEscape(title)}</h1><div style="color:#cbd5e1">NexkartBD Seller Finance</div></div><div style="padding:30px"><p>Hello ${settlementEscape(seller.name || 'Seller')},</p><p style="line-height:1.7">${settlementEscape(message)}</p><div style="background:${settled?'#ecfdf5':'#fff7ed'};padding:20px;border-radius:12px;margin:22px 0"><div style="font-size:12px;color:#475569">${settled?'TOTAL SETTLED':'TOTAL PAYMENT DUE'}</div><div style="font-size:29px;font-weight:bold">BDT ${amount.toFixed(2)}</div><div style="font-size:12px;color:#475569">${rows.length} commission record(s)</div></div>${method ? `<p><b>Payment method:</b> ${settlementEscape(method.toUpperCase())}<br><b>Payment number:</b> ${settlementEscape(number)}</p>`:''}${button}<table style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr style="background:#f8fafc"><th style="padding:11px;text-align:left">Order / Commission</th><th style="padding:11px;text-align:right">Amount</th></tr></thead><tbody>${detail}</tbody></table><p style="margin-top:24px;line-height:1.7">${settled?'Thank you for settling your commission. We truly appreciate your partnership and continued trust in NexkartBD. Your detailed settlement receipt is attached as a PDF.':'After paying, please share your transaction ID with NexkartBD support. Your commissions will remain unpaid until the payment is verified.'}</p><p>Warm regards,<br><b>NexkartBD Team</b></p></div><div style="background:#f8fafc;padding:18px;text-align:center;font-size:12px;color:#64748b">NexkartBD · <a href="https://www.nexkartbd.com">www.nexkartbd.com</a></div></div></body></html>`;
}
async function settlementFetchLogo() {
    const https = require('https');
    return new Promise(resolve => {
        const request = https.get(settlementLogoUrl, {timeout:3500}, response => {
            if (response.statusCode !== 200) { response.resume(); return resolve(null); }
            const chunks=[]; let size=0;
            response.on('data', chunk => { size+=chunk.length; if(size>800000) response.destroy(); else chunks.push(chunk); });
            response.on('end', () => resolve(size<=800000 ? Buffer.concat(chunks) : null));
            response.on('error', () => resolve(null));
        });
        request.on('timeout', () => request.destroy()); request.on('error', () => resolve(null));
    });
}
async function settlementPdf(seller, rows, amount, mode='balance') {
    const PDFDocument = require('pdfkit');
    const logo = await settlementFetchLogo();
    return new Promise((resolve, reject) => {
        const doc = new PDFDocument({ margin: 44, size: 'A4', bufferPages:true });
        const chunks=[]; doc.on('data',x=>chunks.push(x)); doc.on('end',()=>resolve(Buffer.concat(chunks))); doc.on('error',reject);
        const dark='#0f172a', teal='#0f766e', muted='#64748b';
        function pageHeader(){
            doc.rect(0,0,595,126).fill(dark);
            if(logo) { try { doc.image(logo,44,26,{fit:[125,48]}); } catch(e) { doc.fillColor('#fff').font('Helvetica-Bold').fontSize(21).text('NexkartBD',44,34); } }
            else doc.fillColor('#fff').font('Helvetica-Bold').fontSize(21).text('NexkartBD',44,34);
            doc.fillColor('#cbd5e1').font('Helvetica').fontSize(10).text('SELLER FINANCE  /  OFFICIAL RECEIPT',44,91);
            doc.y=151;
        }
        pageHeader();
        doc.fillColor(dark).font('Helvetica-Bold').fontSize(20).text('Commission Settlement Receipt');
        doc.moveDown(.5).fillColor(muted).font('Helvetica').fontSize(10).text(`Issued: ${new Date().toISOString().replace('T',' ').slice(0,19)} UTC`);
        doc.moveDown(.8).fillColor(dark).font('Helvetica-Bold').fontSize(11).text(`Seller: ${String(seller.name||seller.id).replace(/[^\x20-\x7E]/g,'')}`);
        doc.font('Helvetica').fontSize(10).text(`Seller ID: ${seller.id}     Email: ${seller.email||'N/A'}`);
        doc.moveDown(.7).roundedRect(44,doc.y,507,76,10).fill('#ecfdf5');
        const cardY=doc.y; doc.fillColor(teal).font('Helvetica-Bold').fontSize(11).text('PAYMENT SETTLED',60,cardY+14); doc.fontSize(22).text(`BDT ${amount.toFixed(2)}`,60,cardY+33);
        doc.y=cardY+99; doc.fillColor(muted).font('Helvetica').fontSize(10).text(`Settlement method: ${mode==='balance'?'Seller available balance deduction':'Manual payment verified by Super Admin'}`);
        doc.moveDown(1.4); doc.fillColor(dark).font('Helvetica-Bold').fontSize(11).text('COMMISSION BREAKDOWN'); doc.moveDown(.6);
        function heading(){const y=doc.y;doc.rect(44,y,507,25).fill('#e2e8f0');doc.fillColor(dark).font('Helvetica-Bold').fontSize(9).text('COMMISSION ID',53,y+8).text('ORDER',158,y+8).text('RATE',374,y+8).text('AMOUNT (BDT)',444,y+8);doc.y=y+30;}
        heading();
        rows.forEach((x,i)=>{if(doc.y>710){doc.addPage();pageHeader();heading();}const y=doc.y; if(i%2===0)doc.rect(44,y,507,26).fill('#f8fafc');doc.fillColor(dark).font('Helvetica').fontSize(9).text(String(x.id),53,y+8,{width:100}).text(String(x.order_number||''),158,y+8,{width:210}).text(`${x.commission_rate??'-'}%`,374,y+8,{width:55}).text(settlementMoney(x.commission_amount).toFixed(2),444,y+8,{width:98,align:'right'});doc.y=y+27;});
        if(doc.y>690){doc.addPage();pageHeader();}
        doc.moveDown().fillColor(teal).font('Helvetica-Bold').fontSize(12).text(`TOTAL SETTLED: BDT ${amount.toFixed(2)}`,44,doc.y,{align:'right',width:507});
        doc.moveDown(1.5).fillColor(dark).font('Helvetica-Bold').fontSize(11).text('Thank you for being a valued NexkartBD seller!');
        doc.moveDown(.4).fillColor(muted).font('Helvetica').fontSize(10).text('We appreciate your partnership. This receipt confirms the commission records listed above have been marked paid.');
        const count=doc.bufferedPageRange().count;for(let i=0;i<count;i++){doc.switchToPage(i);doc.fillColor(muted).font('Helvetica').fontSize(8).text(`NexkartBD  |  www.nexkartbd.com  |  Page ${i+1} of ${count}`,44,780,{width:507,align:'center',lineBreak:false});}doc.end();
    });
}
router.get('/api/cod-settlements', ensureSuperAdmin, async (req, res) => {
    try {
        const [rows] = await db.query(`SELECT c.id,c.order_number,c.commission_rate,c.commission_amount,c.seller_id,c.date,a.name AS seller_name,a.email AS seller_email,a.total_sales,a.total_withdraw,pr.id AS request_id,pr.status AS request_status,pr.amount AS request_amount,pr.sender_number,pr.transaction_id FROM commission_table c JOIN admins a ON a.id=c.seller_id LEFT JOIN cod_commission_payment_items pi ON pi.commission_id=c.id LEFT JOIN cod_commission_payment_requests pr ON pr.id=pi.request_id AND pr.status IN ('pending','submitted') AND pr.expires_at>NOW() WHERE LOWER(TRIM(c.payment_type))='unpaid' ORDER BY c.seller_id,c.id`);
        const grouped = new Map();
        for(const row of rows){
            if(!grouped.has(row.seller_id))grouped.set(row.seller_id,{seller_id:row.seller_id,seller_name:row.seller_name,seller_email:row.seller_email,available_balance:settlementMoney(Math.max(0,Number(row.total_sales||0)-Number(row.total_withdraw||0))),total_unpaid:0,commissions:[],requests:[]});
            const g=grouped.get(row.seller_id);
            if(row.request_id){let r=g.requests.find(x=>x.id===row.request_id);if(!r){r={id:row.request_id,status:row.request_status,amount:0,commissions:[],sender_number:row.sender_number,transaction_id:row.transaction_id};g.requests.push(r);}r.amount=settlementMoney(r.amount+Number(row.commission_amount||0));r.commissions.push({id:row.id,order_number:row.order_number,commission_amount:row.commission_amount});}
            else{g.total_unpaid=settlementMoney(g.total_unpaid+Number(row.commission_amount||0));g.commissions.push({id:row.id,order_number:row.order_number,commission_rate:row.commission_rate,commission_amount:row.commission_amount,date:row.date});}
        }
        res.json([...grouped.values()]);
    } catch(err){console.error('COD settlements load:',err);res.status(500).json({error:'Failed to load settlements; ensure COD_PAYMENT_LOCK_MIGRATION.sql was executed'});}
});
router.post('/api/cod-settlements/deduct', ensureSuperAdmin, async (req, res) => {
    const sellerId = Number(req.body?.seller_id);
    if (!Number.isSafeInteger(sellerId) || sellerId <= 0) return res.status(400).json({ error: 'Invalid seller ID' });
    try { require.resolve('pdfkit'); } catch (_) { return res.status(503).json({ error: 'PDFKit is not installed. Run npm install pdfkit before settling.' }); }
    let conn;
    try { conn = await db.getConnection(); } catch (err) { console.error('Settlement connection error:', err); return res.status(500).json({ error: 'Database connection unavailable' }); }
    let receipt;
    try {
        await conn.beginTransaction();
        const [[seller]] = await conn.query('SELECT id,name,email,total_sales,total_withdraw FROM admins WHERE id=? FOR UPDATE', [sellerId]);
        if (!seller) { await conn.rollback(); return res.status(404).json({ error: 'Seller not found' }); }
        const [rows] = await conn.query(`SELECT id,order_number,commission_rate,commission_amount FROM commission_table WHERE seller_id=? AND LOWER(TRIM(payment_type))='unpaid' AND NOT EXISTS (SELECT 1 FROM cod_commission_payment_items pi JOIN cod_commission_payment_requests pr ON pr.id=pi.request_id WHERE pi.commission_id=commission_table.id AND pr.status IN ('pending','submitted') AND pr.expires_at>NOW()) ORDER BY id FOR UPDATE`, [sellerId]);
        if (!rows.length) { await conn.rollback(); return res.status(409).json({ error: 'No unpaid commissions' }); }
        const amount = settlementMoney(rows.reduce((a,x) => a + Number(x.commission_amount || 0), 0));
        const balance = settlementMoney(Number(seller.total_sales || 0) - Number(seller.total_withdraw || 0));
        if (!(amount > 0) || balance < amount) { await conn.rollback(); return res.status(409).json({ error: 'Insufficient available balance', available_balance: Math.max(0,balance), total_unpaid: amount }); }
        // Increase total_withdraw to reduce available balance, preserving total_sales accounting.
        await conn.query('UPDATE admins SET total_withdraw=COALESCE(total_withdraw,0)+? WHERE id=?', [amount, sellerId]);
        const ids = rows.map(x => x.id);
        const [updated] = await conn.query(`UPDATE commission_table SET payment_type='paid' WHERE seller_id=? AND LOWER(TRIM(payment_type))='unpaid' AND id IN (${ids.map(() => '?').join(',')})`, [sellerId, ...ids]);
        if (updated.affectedRows !== ids.length) throw new Error('Concurrent settlement update conflict');
        await conn.commit();
        receipt = { seller, rows, amount };
    } catch (err) { try { await conn.rollback(); } catch (_) {} console.error('COD settlement deduction:', err); return res.status(500).json({ error: 'Settlement failed; no changes committed' }); }
    finally { conn.release(); }
    let email_sent = false, email_error = null;
    try {
        if (!receipt.seller.email) throw new Error('Seller email missing');
        const pdf = await settlementPdf(receipt.seller, receipt.rows, receipt.amount, 'balance');
        if (pdf.subarray(0,5).toString() !== '%PDF-') throw new Error('Invalid PDF receipt');
        await settlementEmail(receipt.seller.email, 'NexkartBD | Commission Settled - Thank You', settlementMailHtml({seller:receipt.seller,amount:receipt.amount,rows:receipt.rows,title:'Commission deducted and settled',message:'NexkartBD has deducted the commission listed below from your available seller balance. These commissions are now paid. Your official PDF statement is attached for your records.',settled:true}), pdf);
        email_sent = true;
    } catch (err) { email_error = err.message; console.error('Settlement committed but receipt email failed:', err); }
    res.json({ success: true, deducted: receipt.amount, settled_ids: receipt.rows.map(x=>x.id), email_sent, email_error });
});
// Email-only retry: never deduct balance or update commissions again.
router.post('/api/cod-settlements/resend-receipt', ensureSuperAdmin, async (req,res)=>{
    const sellerId=Number(req.body?.seller_id);
    const ids=Array.isArray(req.body?.commission_ids) ? [...new Set(req.body.commission_ids.map(Number))] : [];
    const mode=req.body?.mode==='manual'?'manual':'balance';
    if(!Number.isSafeInteger(sellerId)||sellerId<=0||!ids.length||ids.length>500||ids.some(id=>!Number.isSafeInteger(id)||id<=0))return res.status(400).json({error:'Valid seller and settled commission IDs required'});
    try{
        const [[seller]]=await db.query('SELECT id,name,email FROM admins WHERE id=?',[sellerId]);
        if(!seller?.email)return res.status(404).json({error:'Seller email missing'});
        const [rows]=await db.query(`SELECT id,order_number,commission_rate,commission_amount FROM commission_table WHERE seller_id=? AND id IN (${ids.map(()=>'?').join(',')}) AND LOWER(TRIM(payment_type))='paid' ORDER BY id`,[sellerId,...ids]);
        if(rows.length!==ids.length)return res.status(409).json({error:'Some commission IDs are not settled. No email sent.'});
        const amount=settlementMoney(rows.reduce((a,x)=>a+Number(x.commission_amount||0),0));
        const pdf=await settlementPdf(seller,rows,amount,mode);
        if(!Buffer.isBuffer(pdf)||pdf.subarray(0,5).toString()!=='%PDF-')throw new Error('PDF generation failed');
        await settlementEmail(seller.email,'NexkartBD | Official Commission Settlement Receipt',settlementMailHtml({seller,amount,rows,title:mode==='balance'?'Commission deducted from your seller balance':'Commission payment successfully settled',message:mode==='balance'?'Your NexkartBD commission has been deducted from your available seller balance. The listed commission records are now paid. Please find your official PDF statement attached.':'Thank you for your payment. NexkartBD has verified your payment and settled the commission records listed below. Your official PDF receipt is attached.',settled:true}),pdf);
        res.json({success:true,email_sent:true});
    }catch(err){console.error('COD settlement receipt resend failed:',err);res.status(502).json({error:'Receipt email failed: '+err.message});}
});
router.post('/api/cod-settlements/payment-request', ensureSuperAdmin, async (req,res)=>{
    const sellerId=Number(req.body?.seller_id),method=String(req.body?.method||'').toLowerCase().trim(),number=String(req.body?.number||'').trim();
    if(!Number.isSafeInteger(sellerId)||sellerId<=0||!['bkash','nagad'].includes(method)||!/^01\d{9}$/.test(number))return res.status(400).json({error:'Choose bKash/Nagad and valid 11-digit number'});
    const conn=await db.getConnection();let details;
    try{
        await conn.beginTransaction();
        const [[seller]]=await conn.query('SELECT id,name,email FROM admins WHERE id=? FOR UPDATE',[sellerId]);
        if(!seller?.email){await conn.rollback();return res.status(404).json({error:'Seller email not found'});}
        const [rows]=await conn.query(`SELECT id,order_number,commission_rate,commission_amount FROM commission_table WHERE seller_id=? AND LOWER(TRIM(payment_type))='unpaid' AND NOT EXISTS (SELECT 1 FROM cod_commission_payment_items pi JOIN cod_commission_payment_requests pr ON pr.id=pi.request_id WHERE pi.commission_id=commission_table.id AND pr.status IN ('pending','submitted') AND pr.expires_at>NOW()) ORDER BY id FOR UPDATE`,[sellerId]);
        if(!rows.length){await conn.rollback();return res.status(409).json({error:'All current unpaid commissions already have active payment requests'});}
        const amount=settlementMoney(rows.reduce((a,x)=>a+Number(x.commission_amount||0),0));
        const token=crypto.randomBytes(32).toString('hex'),paymentUrl=makeSettlementLink(token);
        const [result]=await conn.query("INSERT INTO cod_commission_payment_requests (seller_id,token_hash,method,number,amount,status,expires_at) VALUES (?,?,?,?,?,'pending',DATE_ADD(NOW(),INTERVAL 7 DAY))",[sellerId,settlementTokenHash(token),method,number,amount]);
        for(const row of rows)await conn.query('INSERT INTO cod_commission_payment_items (request_id,commission_id,commission_amount) VALUES (?,?,?)',[result.insertId,row.id,row.commission_amount]);
        await conn.commit();details={seller,rows,amount,paymentUrl,request_id:result.insertId};
    }catch(err){try{await conn.rollback();}catch(_){}console.error('Payment request:',err);return res.status(500).json({error:'Failed to create payment request: '+err.message});}finally{conn.release();}
    try{await settlementEmail(details.seller.email,'NexkartBD | Commission Payment Request',settlementMailHtml({seller:details.seller,amount:details.amount,rows:details.rows,title:'Commission payment reminder',message:'This payment request covers only the commission IDs listed below. New commissions will be billed separately.',method,number,paymentUrl:details.paymentUrl,settled:false}));
        res.json({success:true,email_sent:true,total_unpaid:details.amount,payment_url:details.paymentUrl,request_id:details.request_id});
    }catch(err){console.error('Payment request saved but email failed:',err);res.json({success:true,email_sent:false,email_error:err.message,request_id:details.request_id,payment_url:details.paymentUrl,total_unpaid:details.amount});}
});

// Manual settlement is only for a payment the administrator has independently verified.
// No seller balance is deducted: funds were received outside the seller wallet.
router.post('/api/cod-settlements/mark-settled', ensureSuperAdmin, async (req,res)=>{
    const sellerId=Number(req.body?.seller_id),requestId=Number(req.body?.request_id);
    if(!Number.isSafeInteger(sellerId)||sellerId<=0||!Number.isSafeInteger(requestId)||requestId<=0) return res.status(400).json({error:'Invalid seller ID'});
    let conn;
    try {conn=await db.getConnection();} catch(err){return res.status(500).json({error:'Database connection unavailable'});}
    let receipt;
    try {
        await conn.beginTransaction();
        const [[seller]]=await conn.query('SELECT id,name,email FROM admins WHERE id=? FOR UPDATE',[sellerId]);
        if(!seller){await conn.rollback();return res.status(404).json({error:'Seller not found'});}
        const [[payment]]=await conn.query("SELECT id,status FROM cod_commission_payment_requests WHERE id=? AND seller_id=? AND status='submitted' FOR UPDATE",[requestId,sellerId]);
        if(!payment){await conn.rollback();return res.status(409).json({error:'A submitted payment request is required; verify the TrxID first'});}
        const [rows]=await conn.query("SELECT c.id,c.order_number,c.commission_rate,c.commission_amount FROM cod_commission_payment_items i JOIN commission_table c ON c.id=i.commission_id WHERE i.request_id=? AND c.seller_id=? AND LOWER(TRIM(c.payment_type))='unpaid' ORDER BY c.id FOR UPDATE",[requestId,sellerId]);
        if(!rows.length){await conn.rollback();return res.status(409).json({error:'No unpaid commissions to settle'});}
        const amount=settlementMoney(rows.reduce((sum,x)=>sum+Number(x.commission_amount||0),0));
        const ids=rows.map(x=>x.id);
        const [result]=await conn.query(`UPDATE commission_table SET payment_type='paid' WHERE seller_id=? AND LOWER(TRIM(payment_type))='unpaid' AND id IN (${ids.map(()=>'?').join(',')})`,[sellerId,...ids]);
        if(result.affectedRows!==ids.length) throw new Error('Concurrent update conflict');
        await conn.query("UPDATE cod_commission_payment_requests SET status='settled',settled_at=NOW() WHERE id=? AND seller_id=? AND status='submitted'",[requestId,sellerId]);
        await conn.commit(); receipt={seller,rows,amount};
    }catch(err){try{await conn.rollback();}catch(_){} console.error('Manual settlement failed:',err);return res.status(500).json({error:'Settlement failed; no changes committed'});}finally{conn.release();}
    let email_sent=false,email_error=null;
    try{
        if(!receipt.seller.email) throw new Error('Seller email missing');
        const pdf=await settlementPdf(receipt.seller,receipt.rows,receipt.amount,'manual');
        if (pdf.subarray(0,5).toString() !== '%PDF-') throw new Error('Invalid PDF receipt');
        await settlementEmail(receipt.seller.email,'NexkartBD | Payment Confirmed - Thank You',settlementMailHtml({seller:receipt.seller,amount:receipt.amount,rows:receipt.rows,title:'Your payment is confirmed',message:'Thank you! We have verified your payment and marked all the commission records listed below as paid.',settled:true}),pdf);
        email_sent=true;
    }catch(err){email_error=err.message;console.error('Manual settlement committed, receipt email failed:',err);}
    res.json({success:true,settled_amount:receipt.amount,settled_ids:receipt.rows.map(x=>x.id),email_sent,email_error});
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