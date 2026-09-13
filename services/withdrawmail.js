import { sendMailWithFallback } from './mailer.js'; // আপনার তৈরি করা failover mailer file-টি import করুন

/**
 * উইথড্র সফলভাবে সাবমিট হলে নোটিফিকেশন পাঠানোর ফাংশন (Multi-API Fallback সহ)
 */
const sendWithdrawEmail = async (adminEmail, withdrawDetails) => {
    try {
        const htmlContent = `
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
        `;

        const textContent = `প্রিয় ${withdrawDetails.userName}, আপনার ৳${withdrawDetails.amount} টাকার উত্তোলনের অনুরোধটি সফলভাবে জমা হয়েছে। ট্রানজেকশন আইডি: ${withdrawDetails.transactionId}`;

        // Fallback ফাংশন কল করা হলো (Resend -> Brevo -> Mailjet)
        const result = await sendMailWithFallback({
            to: adminEmail,
            subject: 'Withdrawal Request Submitted Successfully - NexKartBD',
            html: htmlContent,
            text: textContent
        });

        console.log(`Withdraw Email Sent Successfully via ${result.provider}!`);
        return { success: true };

    } catch (error) {
        console.error('Withdraw Email Send Error:', error.message);
        return { success: false, error: error.message };
    }
};

export { sendWithdrawEmail };