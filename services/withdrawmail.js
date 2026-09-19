const { Resend } = require('resend');
const Mailjet = require('node-mailjet');
require('dotenv').config();

// 1. Resend Setup
const resend = new Resend(process.env.RESEND_API_KEY);

// 2. Mailjet Setup
const mailjet = Mailjet.apiConnect(
  process.env.MAILJET_API_KEY,
  process.env.MAILJET_SECRET_KEY
);

// Fallback Mail Sending Function (Resend -> Brevo -> Mailjet)
const sendMailWithFallback = async ({ to, subject, html, text }) => {
  
  // --- 1st Try: Resend ---
  try {
    console.log('Trying with Resend...');
    const data = await resend.emails.send({
      from: 'NexKARTbd <onboarding@resend.dev>',
      to: [to],
      subject: subject,
      html: html,
      text: text,
    });

    if (data.error) throw new Error(data.error.message);
    console.log('Mail sent successfully via Resend!');
    return { success: true, provider: 'Resend' };

  } catch (resendError) {
    console.log(`Resend failed: ${resendError.message}. Switching to Brevo...`);

    // --- 2nd Try: Brevo (Using Native Fetch API) ---
    try {
      const response = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
          'accept': 'application/json',
          'api-key': process.env.BREVO_API_KEY,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          sender: { name: "NexKART", email: "no-reply@nexkartbd.com" },
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
      console.log(`Brevo failed: ${brevoError.message}. Switching to Mailjet...`);

      // --- 3rd Try: Mailjet ---
      try {
        await mailjet
          .post('send', { version: 'v3.1' })
          .request({
            Messages: [
              {
                From: { Email: "pilot@mailjet.com", Name: "NexKART" },
                To: [{ Email: to, Name: "Seller" }],
                Subject: subject,
                HTMLPart: html,
                TextPart: text,
              }
            ]
          });

        console.log('Mail sent successfully via Mailjet!');
        return { success: true, provider: 'Mailjet' };

      } catch (mailjetError) {
        console.error(`Mailjet also failed: ${mailjetError.message}`);
        throw new Error('All email providers (Resend, Brevo, Mailjet) failed!');
      }
    }
  }
};

/**
 * উইথড্র স্ট্যাটাস অনুযায়ী ডায়নামিক ও প্রফেশনাল ইমেইল নোটিফিকেশন সরাসরি সেলারের কাছে পাঠানোর ফাংশন
 */
const sendWithdrawEmail = async (withdrawDetails) => {
    try {
        // Seller-er email check kora (withdrawDetails er modhye email ba sellerEmail thakte hobe)
        const sellerEmail = withdrawDetails.sellerEmail || withdrawDetails.email;
        
        if (!sellerEmail) {
            throw new Error('Seller email is missing in withdraw details!');
        }

        // স্ট্যাটাস চেক করা (Pending, Approved, Rejected) - ডিফল্ট Pending
        const status = (withdrawDetails.status || 'Pending').toLowerCase();
        
        let statusColor = '#d97706'; // Pending (Yellow/Orange)
        let statusText = 'Pending';
        let badgeBg = '#fef3c7';
        let headerTitle = 'Withdrawal Request Submitted';
        let mainMessage = 'আপনার উত্তোলনের অনুরোধটি সফলভাবে গ্রহণ করা হয়েছে এবং সিস্টেমে জমা হয়েছে।';
        let subjectLine = 'Withdrawal Request Submitted Successfully - NexKartBD';

        if (status === 'approved' || status === 'success') {
            statusColor = '#16a34a'; // Green
            statusText = 'Approved';
            badgeBg = '#dcfce7';
            headerTitle = 'Withdrawal Request Approved! 🎉';
            mainMessage = 'সুসংবাদ! আপনার উত্তোলনের অনুরোধটি সফলভাবে অ্যাপ্রুভ করা হয়েছে। খুব শীঘ্রই আপনার পেমেন্ট অ্যাকাউন্টে টাকা পৌঁছে যাবে।';
            subjectLine = 'Withdrawal Request Approved - NexKartBD';
        } else if (status === 'rejected' || status === 'failed') {
            statusColor = '#dc2626'; // Red
            statusText = 'Rejected';
            badgeBg = '#fee2e2';
            headerTitle = 'Withdrawal Request Status Update';
            mainMessage = 'দুঃখিত, আপনার উত্তোলনের অনুরোধটি কিছু কারণবশত বাতিল (Rejected) করা হয়েছে। বিস্তারিত জানতে সাপোর্টের সাথে যোগাযোগ করুন।';
            subjectLine = 'Withdrawal Request Status: Rejected - NexKartBD';
        }

        const htmlContent = `
            <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; padding: 25px; background-color: #f4f6f8; border-radius: 12px;">
                <div style="max-width: 600px; margin: auto; background: #ffffff; padding: 35px; border-radius: 10px; box-shadow: 0 4px 15px rgba(0,0,0,0.06);">
                    
                    <div style="text-align: center; margin-bottom: 25px;">
                        <h2 style="color: #db2777; margin: 0; font-size: 24px;">NexKartBD</h2>
                        <p style="color: #6b7280; font-size: 14px; margin-top: 5px;">Secure Withdrawal Portal</p>
                    </div>

                    <h3 style="color: #1f2937; text-align: center; margin-bottom: 15px;">${headerTitle}</h3>
                    <p style="color: #4b5563; font-size: 15px; line-height: 1.5;">প্রিয় <strong>${withdrawDetails.userName || 'Valued Seller'}</strong>,</p>
                    <p style="color: #4b5563; font-size: 15px; line-height: 1.5;">${mainMessage}</p>
                    
                    <div style="background: #fdf2f8; padding: 20px; border-left: 5px solid #db2777; margin: 25px 0; border-radius: 6px;">
                        <p style="margin: 8px 0; color: #374151; font-size: 14px;"><strong>টাকার পরিমাণ:</strong> <span style="color: #db2777; font-size: 16px; font-weight: bold;">৳${withdrawDetails.amount}</span></p>
                        <p style="margin: 8px 0; color: #374151; font-size: 14px;"><strong>পেমেন্ট মেথড:</strong> ${withdrawDetails.paymentType ? withdrawDetails.paymentType.toUpperCase() : 'N/A'}</p>
                        <p style="margin: 8px 0; color: #374151; font-size: 14px;"><strong>ট্রানজেকশন আইডি:</strong> ${withdrawDetails.transactionId || 'N/A'}</p>
                        <p style="margin: 8px 0; color: #374151; font-size: 14px;"><strong>স্ট্যাটাস:</strong> <span style="background: ${badgeBg}; color: ${statusColor}; padding: 4px 10px; border-radius: 20px; font-weight: bold; font-size: 13px;">${statusText}</span></p>
                    </div>

                    <p style="font-size: 13px; color: #6b7280; text-align: center; margin-top: 35px; border-top: 1px solid #e5e7eb; padding-top: 15px;">
                        এটি একটি স্বয়ংক্রিয় নোটিফিকেশন ইমেইল। দয়া করে এই মেইলে সরাসরি রিপ্লাই করবেন না。<br>
                        &copy; ${new Date().getFullYear()} NexKartBD. All rights reserved.
                    </p>
                </div>
            </div>
        `;

        const textContent = `প্রিয় ${withdrawDetails.userName}, আপনার ৳${withdrawDetails.amount} টাকার উত্তোলনের অনুরোধের বর্তমান স্ট্যাটাস: ${statusText}. ট্রানজেকশন আইডি: ${withdrawDetails.transactionId}`;

        // Fallback ফাংশন কল করা হলো (sellerEmail use kore)
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