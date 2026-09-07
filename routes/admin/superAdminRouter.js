const express = require('express');
const router = express.Router();
const path = require('path');
const db = require('../../db');

// Super Admin Auth Guard Middleware
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

// ২. Email পাঠানোর পর Status Update (resolved) করার API
router.post('/api/update-ipr-status', ensureSuperAdmin, async (req, res) => {
    const { id, email } = req.body;

    if (!id) {
        return res.status(400).json({ success: false, error: 'IPR Report ID is required' });
    }

    try {
        // ১. ইমেইল পাঠানো
        if (email) {
            const nodemailer = require('nodemailer');
            const transporter = nodemailer.createTransport({
                service: 'gmail',
                auth: {
                    user: process.env.EMAIL_USER,
                    pass: process.env.EMAIL_PASS
                }
            });

            await transporter.sendMail({
                from: '"IPR Protection Team" <mehedi.hasantanvir78@gmail.com>',
                to: email,
                subject: 'Update on Your IPR Infringement Report',
                text: `আপনার IPR রিপোর্টটি (ID: ${id}) সফলভাবে পর্যালোচনা এবং সমাধান করা হয়েছে। ধন্যবাদ!`
            });
        }

        // ২. ইমেইল পাঠানো সফল হলে ডাটাবেজে status = 'resolved' হবে
        const query = "UPDATE ipr_reports SET status = 'resolved' WHERE id = ?";
        const [result] = await db.query(query, [id]);

        if (result.affectedRows > 0) {
            return res.json({ success: true, message: 'Mail sent successfully & status updated to resolved' });
        } else {
            return res.status(404).json({ success: false, error: 'IPR report not found' });
        }

    } catch (err) {
        console.error('Error in sending mail or database update:', err);
        return res.status(500).json({ success: false, error: 'Failed to send mail or update status' });
    }
});

// ================= SELLER STATUS LIST API =================
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

// Update Seller Action API & Send Mail
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

    // অ্যাকশন অনুযায়ী ইমেইল নোটিফিকেশন পাঠানো
    if (seller && seller.email) {
      const nodemailer = require('nodemailer');
      const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
        }
      });

      let subject = `Account Action Update - ${seller.shop_name || 'Shop'}`;
      let text = `Your seller account action has been updated to: ${status.toUpperCase()}`;
      
      if (status === 'warning') {
        text = `Warning Notice: Your account has received a warning. Please check your dashboard.`;
      } else if (status === 'suspended') {
        text = `Suspension Notice: Your seller account has been suspended.`;
      } else if (status === 'active') {
        text = `Activation Notice: Your seller account is now active and running.`;
      }

      await transporter.sendMail({
        from: '"Admin System" <mehedi.hasantanvir78@gmail.com>',
        to: seller.email,
        subject: subject,
        text: text
      }).catch(err => console.error("Mail send error:", err));
    }

    res.json({ success: true, message: `Seller action updated to ${status}` });
  } catch (err) {
    console.error('Database Update Error:', err);
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
            // ৩. স্ট্যাটাস অনুযায়ী ইমেইল পাঠান (প্রফেশনাল HTML ফরম্যাটে)
            if (status === 'approved' || status === 'rejected') {
                const nodemailer = require('nodemailer');
                const transporter = nodemailer.createTransport({
                    service: 'gmail',
                    auth: {
                      user: process.env.EMAIL_USER,
                      pass: process.env.EMAIL_PASS
                    }
                });

                const subject = `Withdrawal Request ${status.toUpperCase()} - Payment Notification`;
                
                // সুন্দর এবং গোছানো HTML বডি যেখানে Transition ID এবং Date থাকবে
                const htmlBody = `
                    <div style="font-family: Arial, sans-serif; padding: 20px; border: 1px solid #eee; border-radius: 10px; max-width: 600px; margin: auto;">
                        <h2 style="color: ${status === 'approved' ? '#28a745' : '#dc3545'}; text-align: center;">
                            Withdrawal ${status.toUpperCase()}
                        </h2>
                        <p>Dear <strong>${request.user_name}</strong>,</p>
                        <p>Your withdrawal request has been <strong>${status}</strong> by the administration.</p>
                        
                        <div style="background: #f8f9fa; padding: 15px; border-radius: 5px; margin: 20px 0;">
                            <p style="margin: 8px 0;"><strong>Amount:</strong> ৳${request.amount}</p>
                          <p style="margin: 8px 0;"><strong>Transaction ID:</strong> ${request.transaction_id || 'N/A'}</p>
                            <p style="margin: 8px 0;"><strong>Date:</strong> ${new Date().toLocaleDateString()}</p>
                        </div>
                        
                        <p>If you have any questions or face any issues, please feel free to contact our support team.</p>
                        <p>Best Regards,<br><strong>Management Team</strong></p>
                    </div>
                `;

                await transporter.sendMail({
                    from: '"Payment System" <mehedi.hasantanvir78@gmail.com>',
                    to: request.email,
                    subject: subject,
                    html: htmlBody // টেক্সটের পরিবর্তে HTML ফরম্যাট ব্যবহার করা হয়েছে
                });
            }

            return res.json({ success: true, message: `Status updated to ${status} and formatted mail sent` });
        } else {
            return res.status(404).json({ success: false, error: 'Failed to update' });
        }
    } catch (err) {
        console.error('Database/Mail Error:', err);
        res.status(500).json({ success: false, error: 'Failed to update withdrawal status' });
    }
});

module.exports = router;