const { Resend } = require('resend');
require('dotenv').config();

// 1. Resend Setup (.env থেকে API Key নেওয়া হচ্ছে)
const resend = new Resend(process.env.RESEND_API_KEY);

/**
 * HTTP API ভিত্তিক ফলব্যাক মেল সিস্টেম (Resend -> Brevo)
 * কোনো প্রকার SMTP বা পোর্ট কল করা হয় না, তাই ক্লাউড সার্ভারে (Render/Vercel) কোনো টাইমআউট বা ENETUNREACH এরর আসবে না।
 */
const sendMailWithFallback = async ({ to, subject, html, text }) => {
  
  // --- 1st Try: Resend API ---
  try {
    console.log('Trying with Resend API...');
    const data = await resend.emails.send({
      from: 'NexKARTbd <onboarding@resend.dev>', // প্রয়োজনে আপনার ডোমেইন বা ভেরিফাইড মেইল দিতে পারেন
      to: [to],
      subject: subject,
      html: html,
      text: text,
    });

    if (data.error) throw new Error(data.error.message);
    console.log('Mail sent successfully via Resend!');
    return { success: true, provider: 'Resend' };

  } catch (resendError) {
    console.log(`Resend failed: ${resendError.message}. Switching to Brevo API...`);

    // --- 2nd Try: Brevo API (Native Fetch) ---
    try {
      const response = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
          'accept': 'application/json',
          'api-key': process.env.BREVO_API_KEY,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          sender: { name: "NexKARTBD", email: "no-reply@nexkartbd.com" },
          to: [{ email: to }],
          subject: subject,
          htmlContent: html,
          textContent: text
        })
      });

      if (!response.ok) {
        const errRes = await response.json();
        throw new Error(errRes.message || 'Brevo API request failed');
      }

      console.log('Mail sent successfully via Brevo!');
      return { success: true, provider: 'Brevo' };

    } catch (brevoError) {
      console.error(`Brevo also failed: ${brevoError.message}`);
      throw new Error('All email API providers (Resend, Brevo) failed!');
    }
  }
};

/**
 * উইথড্র স্ট্যাটাস অনুযায়ী অত্যন্ত প্রফেশনাল ও আধুনিক ডিজাইনের ইমেইল পাঠানোর ফাংশন
 */
const sendWithdrawEmail = async (withdrawDetails) => {
    try {
        const sellerEmail = withdrawDetails.sellerEmail || withdrawDetails.email;
        
        if (!sellerEmail) {
            throw new Error('Seller email is missing in withdraw details!');
        }

        const status = (withdrawDetails.status || 'Pending').toLowerCase();
        
        let statusColor = '#d97706'; // Pending (Orange)
        let statusText = 'Pending';
        let badgeBg = '#fef3c7';
        let headerTitle = 'Withdrawal Request Received';
        let mainMessage = 'আপনার উত্তোলনের অনুরোধটি সফলভাবে সিস্টেমে জমা হয়েছে এবং বর্তমানে রিভিউ পর্যায়ে রয়েছে।';
        let subjectLine = 'Withdrawal Request Submitted Successfully - NexKartBD';

        if (status === 'approved' || status === 'success') {
            statusColor = '#16a34a'; // Green
            statusText = 'Approved';
            badgeBg = '#dcfce7';
            headerTitle = 'Withdrawal Request Approved! 🎉';
            mainMessage = 'সুসংবাদ! আপনার উত্তোলনের অনুরোধটি সফলভাবে অ্যাপ্রুভ করা হয়েছে। খুব শীঘ্রই আপনার নির্দিষ্ট পেমেন্ট অ্যাকাউন্টে টাকা পৌঁছে দেওয়া হবে।';
            subjectLine = 'Great News! Withdrawal Request Approved - NexKartBD';
        } else if (status === 'rejected' || status === 'failed') {
            statusColor = '#dc2626'; // Red
            statusText = 'Rejected';
            badgeBg = '#fee2e2';
            headerTitle = 'Withdrawal Request Update';
            mainMessage = 'দুঃখিত, কিছু অনিবার্য কারণবশত আপনার উত্তোলনের অনুরোধটি বাতিল (Rejected) করা হয়েছে। বিস্তারিত জানতে অনুগ্রহ করে সাপোর্টের সাথে যোগাযোগ করুন।';
            subjectLine = 'Important Update Regarding Your Withdrawal - NexKartBD';
        }

        // প্রিমিয়াম ও আধুনিক HTML ডিজাইন
        const htmlContent = `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="utf-8">
                <style>
                    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f3f4f6; margin: 0; padding: 0; }
                    .wrapper { width: 100%; table-layout: fixed; background-color: #f3f4f6; padding: 40px 0; }
                    .main-card { max-width: 600px; background-color: #ffffff; margin: 0 auto; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.08); }
                    .header { background: linear-gradient(135deg, #db2777 0%, #9333ea 100%); padding: 30px; text-align: center; color: #ffffff; }
                    .header h1 { margin: 0; font-size: 26px; font-weight: 700; letter-spacing: 0.5px; }
                    .header p { margin: 5px 0 0; font-size: 14px; opacity: 0.9; }
                    .content { padding: 35px 30px; color: #374151; }
                    .content h3 { color: #111827; font-size: 20px; margin-top: 0; margin-bottom: 20px; text-align: center; }
                    .details-box { background-color: #fdf2f8; border-left: 4px solid #db2777; padding: 20px; border-radius: 8px; margin: 25px 0; }
                    .details-row { display: flex; justify-content: space-between; margin: 10px 0; font-size: 14px; color: #4b5563; }
                    .badge { background-color: ${badgeBg}; color: ${statusColor}; padding: 5px 12px; border-radius: 20px; font-weight: bold; font-size: 12px; text-transform: uppercase; }
                    .footer { background-color: #f9fafb; padding: 20px; text-align: center; font-size: 12px; color: #9ca3af; border-top: 1px solid #e5e7eb; }
                </style>
            </head>
            <body>
                <div class="wrapper">
                    <div class="main-card">
                        <div class="header">
                            <h1>NexKartBD</h1>
                            <p>Secure Seller Payout Portal</p>
                        </div>
                        <div class="content">
                            <h3>${headerTitle}</h3>
                            <p>প্রিয় <strong>${withdrawDetails.userName || 'Valued Seller'}</strong>,</p>
                            <p style="line-height: 1.6;">${mainMessage}</p>
                            
                            <div class="details-box">
                                <p style="margin: 8px 0; font-size: 14px;"><strong>পরিমাণ:</strong> <span style="color: #db2777; font-size: 16px; font-weight: bold;">৳${withdrawDetails.amount}</span></p>
                                <p style="margin: 8px 0; font-size: 14px;"><strong>পেমেন্ট মেথড:</strong> ${withdrawDetails.paymentType ? withdrawDetails.paymentType.toUpperCase() : 'N/A'}</p>
                                <p style="margin: 8px 0; font-size: 14px;"><strong>ট্রানজেকশন আইডি:</strong> ${withdrawDetails.transactionId || 'N/A'}</p>
                                <p style="margin: 8px 0; font-size: 14px;"><strong>স্ট্যাটাস:</strong> <span class="badge">${statusText}</span></p>
                            </div>

                            <p style="font-size: 14px; line-height: 1.6; color: #4b5563;">আপনার যেকোনো প্রয়োজনে আমাদের মার্চেন্ট সাপোর্ট টিমের সাথে যোগাযোগ করতে পারেন।</p>
                        </div>
                        <div class="footer">
                            এটি একটি স্বয়ংক্রিয় সিস্টেম নোটিফিকেশন। দয়া করে এই মেইলে সরাসরি রিপ্লাই করবেন না।<br>
                            &copy; ${new Date().getFullYear()} NexKartBD. All rights reserved.
                        </div>
                    </div>
                </div>
            </body>
            </html>
        `;

        const textContent = `প্রিয় ${withdrawDetails.userName}, আপনার ৳${withdrawDetails.amount} টাকার উত্তোলনের অনুরোধের বর্তমান স্ট্যাটাস: ${statusText}. ট্রানজেকশন আইডি: ${withdrawDetails.transactionId}`;

        // সরাসরি HTTP API ভিত্তিক ফলব্যাক ফাংশন কল করা হলো
        const result = await sendMailWithFallback({
            to: sellerEmail,
            subject: subjectLine,
            html: htmlContent,
            text: textContent
        });

        console.log(`Withdraw Status (${statusText}) Email Sent Successfully to Seller via ${result.provider}!`);
        return { success: true };

    } catch (error) {
        console.error('Withdraw Email Send Error:', error.message);
        return { success: false, error: error.message };
    }
};

module.exports = { sendWithdrawEmail };