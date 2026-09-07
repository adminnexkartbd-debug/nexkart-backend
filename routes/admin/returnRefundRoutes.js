const express = require('express');
const router = express.Router();
const db = require('../../db');


const { sendReturnStatusEmail } = require('../../services/returnAdminMailService');

// API Route to fetch return & refund data (with seller_id filter)
router.get('/api/return-refunds', async (req, res) => {
    try {
        const sellerId = req.query.seller_id || req.session?.seller_id; 

        let query = `
            SELECT 
                r.id as return_id,
                r.order_id,
                r.return_reason,
                r.return_details,
                r.proof_file,
                r.status,
                r.created_at,
                r.seller_id,
                u.id as user_id,
                u.name as user_name,
                u.profile_image as user_profile,
                p.product_id as product_code,
                p.title as product_title,
                p.sale_price
            FROM order_returns r
            LEFT JOIN users u ON r.user_id = u.id
            LEFT JOIN products p ON r.product_id = p.id OR r.product_id = p.product_id
        `;

        let queryParams = [];

        if (sellerId) {
            query += ` WHERE r.seller_id = ? `;
            queryParams.push(sellerId);
        }

        query += ` ORDER BY r.created_at DESC `;

        const [results] = await db.query(query, queryParams);

        res.json({
            success: true,
            data: results
        });

    } catch (error) {
        console.error('Database/Server Error:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch data from database.', error: error.message });
    }
});

router.post('/api/return-refunds/update-status/:id', async (req, res) => {
    try {
        const returnId = req.params.id;
        const { status } = req.body;

        // ১. ডাটাবেজে স্ট্যাটাস আপডেট
        const updateQuery = `UPDATE order_returns SET status = ? WHERE id = ?`;
        await db.query(updateQuery, [status, returnId]);

        // ২. ইউজার, অর্ডার এবং রিটার্ন রিকোয়েস্টের বিস্তারিত তথ্য আনুন
        const [rows] = await db.query(
            `SELECT 
                r.id as return_id,
                r.order_id,
                r.return_reason,
                r.return_details,
                r.proof_file,
                r.status,
                u.name as user_name,
                u.email as user_email,
                p.title as product_title,
                p.product_id as product_code,
                p.sale_price
             FROM order_returns r
             LEFT JOIN users u ON r.user_id = u.id
             LEFT JOIN products p ON r.product_id = p.id OR r.product_id = p.product_id
             WHERE r.id = ?`, 
            [returnId]
        );

        // ৩. সুন্দর ও অ্যাট্রাক্টিভ ইমেইল টেমপ্লেট তৈরি করে মেইল সেন্ড করুন
        if (rows.length > 0 && rows[0].user_email) {
            const data = rows[0];
            const userEmail = data.user_email;
            const userName = data.user_name || 'Valued Customer';

            // স্ট্যাটাস অনুসারে কালার ব্যাজ নির্ধারণ
            let statusColor = '#ffc107'; // Pending - Yellow
            if (status === 'approved') statusColor = '#198754'; // Approved - Green
            if (status === 'rejected') statusColor = '#dc3545'; // Rejected - Red

            const emailHtml = `
            <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; background-color: #ffffff; border: 1px solid #e0e0e0; border-radius: 10px; overflow: hidden; box-shadow: 0 4px 10px rgba(0,0,0,0.05);">
                
                <!-- Header -->
                <div style="background-color: #212529; color: #ffffff; padding: 25px; text-align: center;">
                    <h2 style="margin: 0; font-size: 24px; font-weight: 600;">Return Request Update</h2>
                    <p style="margin: 5px 0 0 0; font-size: 14px; color: #cccccc;">Request ID: #${data.return_id}</p>
                </div>

                <!-- Body -->
                <div style="padding: 30px;">
                    <p style="font-size: 16px; color: #333333; margin-top: 0;">Hello <strong>${userName}</strong>,</p>
                    <p style="font-size: 15px; color: #555555; line-height: 1.5;">Your return request status has been updated. Below are the details of your request:</p>
                    
                    <!-- Status Badge Box -->
                    <div style="background-color: #f8f9fa; border-left: 5px solid ${statusColor}; padding: 15px; border-radius: 4px; margin: 20px 0;">
                        <span style="font-size: 14px; color: #666666; display: block; text-transform: uppercase; font-weight: bold;">Current Status</span>
                        <span style="font-size: 20px; font-weight: bold; color: ${statusColor}; text-transform: capitalize;">${status}</span>
                    </div>

                    <!-- Details Table -->
                    <h3 style="font-size: 16px; color: #212529; border-bottom: 2px solid #f0f0f0; padding-bottom: 8px; margin-top: 30px;">Request Information</h3>
                    <table style="width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 14px;">
                        <tr>
                            <td style="padding: 10px 0; color: #777777; width: 40%; font-weight: 500;">Order ID:</td>
                            <td style="padding: 10px 0; color: #333333; font-weight: 600;">#${data.order_id || 'N/A'}</td>
                        </tr>
                        <tr style="border-top: 1px solid #f0f0f0;">
                            <td style="padding: 10px 0; color: #777777; font-weight: 500;">Product Title:</td>
                            <td style="padding: 10px 0; color: #333333; font-weight: 600;">${data.product_title || 'N/A'}</td>
                        </tr>
                        <tr style="border-top: 1px solid #f0f0f0;">
                            <td style="padding: 10px 0; color: #777777; font-weight: 500;">Product Code:</td>
                            <td style="padding: 10px 0; color: #333333;">${data.product_code || 'N/A'}</td>
                        </tr>
                        <tr style="border-top: 1px solid #f0f0f0;">
                            <td style="padding: 10px 0; color: #777777; font-weight: 500;">Price:</td>
                            <td style="padding: 10px 0; color: #333333;">৳${data.sale_price || '0.00'}</td>
                        </tr>
                        <tr style="border-top: 1px solid #f0f0f0;">
                            <td style="padding: 10px 0; color: #777777; font-weight: 500;">Return Reason:</td>
                            <td style="padding: 10px 0; color: #dc3545; font-weight: 600;">${data.return_reason || 'N/A'}</td>
                        </tr>
                        <tr style="border-top: 1px solid #f0f0f0;">
                            <td style="padding: 10px 0; color: #777777; font-weight: 500;">Details / Description:</td>
                            <td style="padding: 10px 0; color: #555555;">${data.return_details || 'No details provided.'}</td>
                        </tr>
                        ${data.proof_file ? `
                        <tr style="border-top: 1px solid #f0f0f0;">
                            <td style="padding: 10px 0; color: #777777; font-weight: 500;">Attached Proof:</td>
                            <td style="padding: 10px 0;">
                                <a href="${data.proof_file}" target="_blank" style="color: #0d6efd; text-decoration: none; font-weight: 600;">View File / Image</a>
                            </td>
                        </tr>` : ''}
                    </table>

                    <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #e0e0e0; text-align: center;">
                        <p style="font-size: 13px; color: #888888; margin: 0;">If you have any questions regarding this update, please reply to this email or contact support.</p>
                    </div>
                </div>

                <!-- Footer -->
                <div style="background-color: #f8f9fa; padding: 15px; text-align: center; font-size: 12px; color: #999999; border-top: 1px solid #eeeeee;">
                    &copy; ${new Date().getFullYear()} Your Company Name. All rights reserved.
                </div>
            </div>
            `;

            try {
                await sendReturnStatusEmail(
                    userEmail,
                    `Update on Return Request #${data.return_id} [${status.toUpperCase()}]`,
                    emailHtml
                );
            } catch (mailError) {
                console.error('Mail Send Error:', mailError);
            }
        }

        res.json({ success: true, message: 'Status updated and detailed email sent successfully.' });
    } catch (error) {
        console.error('Update/Email Error:', error);
        res.status(500).json({ success: false, message: 'Failed to update status or send mail.', error: error.message });
    }
});

// Auth Middleware
function requireAuth(req, res, next) {
    // সেশন বা টোকেন চেক (আপনার প্রজেক্টের সেশন স্ট্রাকচার অনুযায়ী)
    if (req.user || (req.session && req.session.adminId)) {
        return next(); // ইউজার লগইন থাকলে পরবর্তী কোডে যাবে
    }
    
    // API রিকুয়েস্ট হলে JSON রিটার্ন করবে
    if (req.xhr || req.headers.accept.indexOf('json') > -1) {
        return res.status(401).json({ success: false, message: 'Unauthorized. Please login.' });
    }

    // সাধারন পেজ রিকুয়েস্ট হলে সরাসরি লগইন পেজে পাঠাবে
    res.redirect('/admin/login.html');
}

// আপনার রাউটগুলোতে ব্যবহার করার নিয়ম:
router.get('/profile', requireAuth, async (req, res) => {
    // এখানে আপনার আগের কোড থাকবে...
});

module.exports = router;