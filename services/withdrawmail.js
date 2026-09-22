require('dotenv').config();

/**
 * Google OAuth2 ব্যবহার করে সরাসরি Gmail API এর মাধ্যমে মেল পাঠানোর ফাংশন
 */
const sendMailWithGoogleOAuth = async ({ to, subject, html, text }) => {
  try {
    console.log('Generating Google OAuth2 access token...');

    // ১. রিফ্রেশ টোকেন ব্যবহার করে নতুন অ্যাক্সেস টোকেন জেনারেট করা
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_USER_CLIENT_ID,
        client_secret: process.env.GOOGLE_USER_CLIENT_SECRET,
        refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
        grant_type: 'refresh_token',
      }),
    });

    const tokenData = await tokenResponse.json();

    if (!tokenResponse.ok || !tokenData.access_token) {
      throw new Error(tokenData.error_description || tokenData.error || 'Failed to generate Google OAuth access token');
    }

    const accessToken = tokenData.access_token;
    console.log('Google Access Token generated successfully. Sending email...');

    // ২. জিমেইল পাঠানোর জন্য ইমেইল ফরম্যাটকে MIME (RFC 2822) ফরম্যাটে রূপান্তর করা
    // জিমেইল এপিআই-তে পাঠানোর জন্য বেসসিজ কোডিং (Base64url) করতে হয়
    const utf8Subject = `=?utf-8?B?${Buffer.from(subject).toString('base64')}?=`;
    const messageParts = [
      `To: ${to}`,
      `Subject: ${utf8Subject}`,
      'MIME-Version: 1.0',
      'Content-Type: text/html; charset=utf-8',
      '',
      html
    ];
    const message = messageParts.join('\r\n');
    
    // Base64url এনকোডিং
    const encodedMessage = Buffer.from(message)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    // ৩. Gmail API এ রিকোয়েস্ট পাঠানো
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

    console.log('Mail sent successfully via Google OAuth Gmail API!');
    return { success: true, provider: 'Google Gmail API' };

  } catch (error) {
    console.error(`Google OAuth Mail Error: ${error.message}`);
    throw error;
  }
};

/**
 * উইথড্র স্ট্যাটাস অনুযায়ী সেলারের কাছে প্রফেশনাল মেইল পাঠানোর ফাংশন
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
                            এটি একটি স্বয়ংক্রিয় সিস্টেম নোটিফিকেশন। দয়া করে এই মেইলে সরাসরি রিপ্লাই করবেন না。<br>
                            &copy; ${new Date().getFullYear()} NexKartBD. All rights reserved.
                        </div>
                    </div>
                </div>
            </body>
            </html>
        `;

        const textContent = `প্রিয় ${withdrawDetails.userName}, আপনার ৳${withdrawDetails.amount} টাকার উত্তোলনের অনুরোধের বর্তমান স্ট্যাটাস: ${statusText}. ট্রানজেকশন আইডি: ${withdrawDetails.transactionId}`;

        // Google OAuth API এর মাধ্যমে মেল ফাংশন কল করা হলো
        await sendMailWithGoogleOAuth({
            to: sellerEmail,
            subject: subjectLine,
            html: htmlContent,
            text: textContent
        });

        console.log(`Withdraw Status (${statusText}) Email Sent Successfully to Seller via Google OAuth!`);
        return { success: true };

    } catch (error) {
        console.error('Withdraw Email Send Error:', error.message);
        return { success: false, error: error.message };
    }
};

module.exports = { sendWithdrawEmail };