const nodemailer = require('nodemailer');

// OAuth2 ব্যবহার করে Gmail Transporter কনফিগারেশন
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        type: 'OAuth2',
        user: process.env.EMAIL_USER,             // admin.nexkartbd@gmail.com
        clientId: process.env.GOOGLE_CLIENT_ID,     // Google Cloud Client ID
        clientSecret: process.env.GOOGLE_CLIENT_SECRET, // Google Cloud Client Secret
        refreshToken: process.env.GOOGLE_REFRESH_TOKEN  // Playground থেকে পাওয়া 1//04... টোকেনটি
    }
});

/**
 * উইথড্র সফলভাবে সাবমিট হলে নোটিফিকেশন পাঠানোর ফাংশন
 */
const sendWithdrawEmail = async (adminEmail, withdrawDetails) => {
    try {
        const mailOptions = {
            from: `NexKartBD <${process.env.EMAIL_USER}>`,
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
        console.log('Withdraw Email Sent via OAuth2:', info.response);
        return { success: true };
    } catch (error) {
        console.error('Email Send Error:', error);
        return { success: false, error };
    }
};

module.exports = { sendWithdrawEmail };