const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
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
 * উইথড্র সফলভাবে সাবমিট হলে এডমিন/ইউজারের ইমেইলে নোটিফিকেশন পাঠানোর ফাংশন
 */
const sendWithdrawEmail = async (adminEmail, withdrawDetails) => {
    try {
        const mailOptions = {
            from: 'NexKartBD <admin.nexkartbd@gmail.com>',
            to: adminEmail,
            subject: 'Withdrawal Request Submitted Successfully - NexKartBD',
            html: `
                <div style="font-family: Arial, sans-serif; padding: 20px; background-color: #f4f6f8; border-radius: 10px;">
                    <div style="max-width: 600px; margin: auto; background: #ffffff; padding: 30px; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.05);">
                        <h2 style="color: #db2777; text-align: center;">NexKartBD Withdraw Portal</h2>
                        <p>প্রিয় <strong>${withdrawDetails.userName}</strong>,</p>
                        <p>আপনার উত্তোলনের অনুরোধটি সফলভাবে গ্রহণ করা হয়েছে এবং সিস্টেমে জমা হয়েছে।</p>
                        
                        <div style="background: #fdf2f8; padding: 15px; border-left: 4px solid #db2777; margin: 20px 0; border-radius: 4px;">
                            <p style="margin: 5px 0;"><strong>টাকার পরিমাণ:</strong> ৳${withdrawDetails.amount}</p>
                            <p style="margin: 5px 0;"><strong>পেমেন্ট মেথড:</strong> ${withdrawDetails.paymentType.toUpperCase()}</p>
                            <p style="margin: 5px 0;"><strong>ট্রানজেকশন আইডি:</strong> ${withdrawDetails.transactionId}</p>
                            <p style="margin: 5px 0;"><strong>স্ট্যাটাস:</strong> <span style="color: #d97706; font-weight: bold;">Pending</span></p>
                        </div>

                        <p style="font-size: 12px; color: #6b7280; text-align: center; margin-top: 30px;">
                            এটি একটি স্বয়ংক্রিয় ইমেইল। দয়া করে এই ইমেইলে সরাসরি রিপ্লাই করবেন না।
                        </p>
                    </div>
                </div>
            `
        };

        const info = await transporter.sendMail(mailOptions);
        console.log('Withdraw Email Sent:', info.response);
        return { success: true };
    } catch (error) {
        console.error('Email Send Error:', error);
        return { success: false, error };
    }
};

module.exports = { sendWithdrawEmail };