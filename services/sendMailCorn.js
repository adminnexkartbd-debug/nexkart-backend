const cron = require('node-cron');
const db = require('../db'); // আপনার ডাটাবেজ কানেকশন পাথ প্রয়োজন অনুযায়ী ঠিক করে নিন
const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    },
    family: 4, // 👈 এটি অবশ্যই দিতে হবে (IPv4 নিশ্চিত করার জন্য)
    tls: {
        rejectUnauthorized: false
    },
    connectionTimeout: 20000,
    greetingTimeout: 20000,
    socketTimeout: 20000
});

/**
 * ক্রন জব ফাংশন যা প্রতি ১ মিনিট পর পর রান করবে 
 * এবং যাদের send_mail = 0 আছে তাদের উইথড্র রিকোয়েস্ট শুধু সুপার এডমিনদের ইমেইলে পাঠাবে।
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

            if (superAdmins.length === 0) {
                console.log('Cron Job: No approved super admins found to send email.');
                return;
            }

            // সব অনুমোদিত সুপার এডমিনের ইমেইলের একটি অ্যারে তৈরি করা
            const adminEmails = superAdmins.map(admin => admin.email).filter(Boolean);

            if (adminEmails.length === 0) return;

            // ۳. প্রতিটি পেন্ডিং রিকোয়েস্টের জন্য ইমেইল পাঠানো এবং send_mail আপডেট করা
            for (const reqData of pendingRequests) {
                const mailOptions = {
                    from: 'NexKARTbd <admin.nexkartbd@gmail.com>',
                    to: adminEmails, // একসাথে সকল approved সুপার এডমিনদের কাছে চলে যাবে
                    subject: `New Withdrawal Request - TRX: ${reqData.transaction_id}`,
                    html: `
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
                    `
                };

                // ইমেইল সেন্ড করা
                await transporter.sendMail(mailOptions);
                console.log(`Withdraw Email Sent Successfully to Super Admin(s) for TRX: ${reqData.transaction_id}`);

                // ৪. ইমেইল পাঠানো সফল হলে withdraw_request টেবিলের send_mail ফিল্ড 1 (true) করে দেওয়া
                await db.query(
                    `UPDATE withdraw_request SET send_mail = 1 WHERE id = ?`,
                    [reqData.id]
                );
            }

        } catch (error) {
            console.error('Withdraw Cron Job Error:', error);
        }
    });
};

module.exports = { initWithdrawCron };