const cron = require('node-cron');
const db = require('../db'); 
require('dotenv').config();

/**
 * Google OAuth2 ব্যবহার করে সরাসরি Gmail API এর মাধ্যমে মেইল পাঠানোর ফাংশন
 */
async function sendViaGoogleOAuth(to, subject, html, text) {
    try {
        console.log('Generating Google OAuth2 access token for withdraw cron...');

        const clientId = process.env.GOOGLE_USER_CLIENT_ID;
        const clientSecret = process.env.GOOGLE_USER_CLIENT_SECRET;
        const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;

        if (!clientId || !clientSecret || !refreshToken) {
            throw new Error('Google OAuth credentials (Client ID, Secret, or Refresh Token) are missing in environment variables!');
        }

        const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
                client_id: clientId,
                client_secret: clientSecret,
                refresh_token: refreshToken,
                grant_type: 'refresh_token',
            }),
        });

        const tokenData = await tokenResponse.json();

        if (!tokenResponse.ok || !tokenData.access_token) {
            throw new Error(tokenData.error_description || tokenData.error || 'Failed to generate Google OAuth access token');
        }

        const accessToken = tokenData.access_token;
        console.log('Google Access Token generated successfully. Sending mail via Gmail API...');

        // Handle multiple recipients if passed as an array
        const recipientList = Array.isArray(to) ? to.join(', ') : to;

        const utf8Subject = `=?utf-8?B?${Buffer.from(subject).toString('base64')}?=`;
        const messageParts = [
            `To: ${recipientList}`,
            `Subject: ${utf8Subject}`,
            'MIME-Version: 1.0',
            'Content-Type: text/html; charset=utf-8',
            '',
            html
        ];
        const message = messageParts.join('\r\n');
        
        const encodedMessage = Buffer.from(message)
            .toString('base64')
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=+$/, '');

        const gmailResponse = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                raw: encodedMessage,
            }),
        });

        const gmailData = await gmailResponse.json();

        if (!gmailResponse.ok) {
            throw new Error(gmailData.error?.message || 'Failed to send email via Gmail API');
        }

        console.log('Email sent successfully via Google OAuth Gmail API!');
        return { success: true, provider: 'Google Gmail API' };

    } catch (error) {
        console.error(`Google OAuth Mail Error: ${error.message}`);
        throw error;
    }
}

/**
 * ক্রন জব ফাংশন যা প্রতি ১ মিনিট পর পর রান করবে 
 * এবং যাদের send_mail = 0 আছে তাদের উইথড্র রিকোয়েস্ট সুপার এডমিন ও সেলারের কাছে মাত্র একবার পাঠাবে।
 */
const initWithdrawCron = () => {
    // ক্রন এক্সপ্রেশন: প্রতি ১ মিনিট পর পর চলবে ('*/1 * * * *')
    cron.schedule('*/1 * * * *', async () => {
        try {
            // ১. withdraw_request টেবিল থেকে যেগুলোর send_mail = 0 সেগুলোর ডেটা নিয়ে আসা
            const [pendingRequests] = await db.query(
                `SELECT * FROM withdraw_request WHERE send_mail = 0`
            );

            if (pendingRequests.length === 0) {
                return; // কোনো নতুন রিকোয়েস্ট না থাকলে স্কিপ করবে
            }

            // ২. admins টেবিল থেকে যাদের status = 'approved' এবং super_admin = 'approved' তাদের ইমেইল খুঁজে বের করা
            const [superAdmins] = await db.query(
                `SELECT email FROM admins WHERE status = 'approved' AND super_admin = 'approved'`
            );

            const adminEmails = superAdmins.map(admin => admin.email).filter(Boolean);

            // ৩. প্রতিটি পেন্ডিং রিকোয়েস্টের জন্য কাজ শুরু করা
            for (const reqData of pendingRequests) {
                
                // সর্তকতা হিসেবে প্রথমেই send_mail = 1 আপডেট করে দেওয়া যাতে ডাবল মেইল সেন্ড হওয়ার কোনো সুযোগ না থাকে
                await db.query(
                    `UPDATE withdraw_request SET send_mail = 1 WHERE id = ? AND send_mail = 0`,
                    [reqData.id]
                );

                // ক. সুপার এডমিনদের জন্য প্রফেশনাল মেইল পাঠানো
                if (adminEmails.length > 0) {
                    const adminHtml = `
                        <div style="font-family: Arial, sans-serif; padding: 20px; background-color: #f4f6f8; border-radius: 10px;">
                            <div style="max-width: 600px; margin: auto; background: #ffffff; padding: 30px; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.05);">
                                <h2 style="color: #db2777; text-align: center;">NexKartBD Withdraw Request Notification</h2>
                                <p>প্রিয় সুপার এডমিন,</p>
                                <p>নতুন একটি উইথড্র রিকোয়েস্ট সাবমিট করা হয়েছে। নিচে বিস্তারিত দেওয়া হলো:</p>
                                
                                <div style="background: #fdf2f8; padding: 15px; border-left: 4px solid #db2777; margin: 20px 0; border-radius: 4px;">
                                    <p style="margin: 5px 0;"><strong>ইউজারের নাম:</strong> ${reqData.user_name}</p>
                                    <p style="margin: 5px 0;"><strong>টাকার পরিমাণ:</strong> ৳${reqData.amount}</p>
                                    <p style="margin: 5px 0;"><strong>পেমেন্ট মেথড:</strong> ${String(reqData.payment_type).toUpperCase()}</p>
                                    <p style="margin: 5px 0;"><strong>ট্রানজেকশন আইডি:</strong> ${reqData.transaction_id}</p>
                                    <p style="margin: 5px 0;"><strong>স্ট্যাটাস:</strong> <span style="color: #d97706; font-weight: bold;">${reqData.status}</span></p>
                                </div>

                                <p style="font-size: 12px; color: #6b7280; text-align: center; margin-top: 30px;">
                                    এটি একটি স্বয়ংক্রিয় ক্রন জব নোটিফিকেশন ইমেইল।
                                </p>
                            </div>
                        </div>
                    `;

                    // একসাথে সব সুপার এডমিনকে অথবা লুপ চালিয়ে মেইল পাঠানো
                    for (const adminEmail of adminEmails) {
                        try {
                            await sendViaGoogleOAuth(
                                adminEmail,
                                `New Withdrawal Request - TRX: ${reqData.transaction_id}`,
                                adminHtml,
                                `New withdrawal request from ${reqData.user_name} of amount ৳${reqData.amount}`
                            );
                            console.log(`Withdraw Email Sent to Super Admin: ${adminEmail} for TRX: ${reqData.transaction_id}`);
                        } catch (adminMailErr) {
                            console.error(`Failed to send email to admin ${adminEmail}:`, adminMailErr.message);
                        }
                    }
                }

                // খ. যে সেলার উইথড্র দিয়েছে তার ইমেইল খুঁজে বের করা এবং কনফার্মেশন মেইল পাঠানো
                const [sellerRows] = await db.query(
                    `SELECT email FROM admins WHERE id = ?`,
                    [reqData.admin_id]
                );

                if (sellerRows.length > 0 && sellerRows[0].email) {
                    const sellerEmail = sellerRows[0].email;

                    const sellerHtml = `
                        <div style="font-family: Arial, sans-serif; padding: 20px; background-color: #f4f6f8; border-radius: 10px;">
                            <div style="max-width: 600px; margin: auto; background: #ffffff; padding: 30px; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.05);">
                                <h2 style="color: #db2777; text-align: center;">Withdrawal Request Confirmation</h2>
                                <p>প্রিয় <strong>${reqData.user_name}</strong>,</p>
                                <p>আপনার ৳${reqData.amount} টাকার উইথড্র রিকোয়েস্ট সফলভাবে সিস্টেমে রেকর্ড করা হয়েছে।</p>
                                
                                <div style="background: #fdf2f8; padding: 15px; border-radius: 6px; margin: 20px 0;">
                                    <p style="margin: 8px 0;"><strong>Transaction ID:</strong> ${reqData.transaction_id}</p>
                                    <p style="margin: 8px 0;"><strong>Amount:</strong> ৳${reqData.amount}</p>
                                    <p style="margin: 8px 0;"><strong>Payment Method:</strong> ${String(reqData.payment_type).toUpperCase()}</p>
                                    <p style="margin: 8px 0;"><strong>Status:</strong> ${reqData.status}</p>
                                    <p style="margin: 8px 0;"><strong>Date:</strong> ${new Date().toLocaleString()}</p>
                                </div>

                                <p style="text-align: center; font-size: 12px; color: #777; margin-top: 30px;">Thank you for using NexKartBD.</p>
                            </div>
                        </div>
                    `;

                    try {
                        await sendViaGoogleOAuth(
                            sellerEmail,
                            `Withdrawal Request Confirmation - ${reqData.transaction_id}`,
                            sellerHtml,
                            `Your withdrawal request of ৳${reqData.amount} has been submitted successfully.`
                        );
                        console.log(`Withdraw Confirmation Email Sent to Seller: ${sellerEmail}`);
                    } catch (sellerMailErr) {
                        console.error(`Failed to send withdrawal email to seller ${sellerEmail}:`, sellerMailErr.message);
                    }
                }
            }

        } catch (error) {
            console.error('Withdraw Cron Job Error:', error);
        }
    });
};

module.exports = { initWithdrawCron };