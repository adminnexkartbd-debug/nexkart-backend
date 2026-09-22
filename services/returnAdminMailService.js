// services/returnAdminMailService.js
require('dotenv').config();

/**
 * Google OAuth2 ব্যবহার করে সরাসরি Gmail API এর মাধ্যমে প্রফেশনাল মেইল পাঠানোর ফাংশন
 */
const sendViaGoogleOAuth = async (to, subject, html) => {
    try {
        console.log('Generating Google OAuth2 access token for return/refund notification...');

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
        console.log('Google Access Token generated successfully. Sending return/refund email via Gmail API...');

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

        console.log('Return/Refund Email sent successfully via Google OAuth Gmail API!');
        return { success: true, provider: 'Google Gmail API' };

    } catch (error) {
        console.error(`Google OAuth Return Mail Error: ${error.message}`);
        throw error;
    }
};

/**
 * রিটার্ন এবং রিফান্ড স্ট্যাটাস আপডেট মেইল পাঠানোর প্রফেশনাল সার্ভিস
 * @param {string} to - ইউজারের ইমেইল
 * @param {string} subject - ইমেইলের বিষয়
 * @param {string} html - ইমেইল বডি (HTML)[cite: 4]
 */
const sendReturnStatusEmail = async (to, subject, html) => {
    try {
        // ইমেইল ডিজাইন আরও প্রফেশনাল ও প্রিমিয়াম লুক দেওয়ার জন্য র‍্যাপার ব্যবহার করা হয়েছে
        const professionalHtml = `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="utf-8">
                <style>
                    body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; background-color: #f4f7f6; margin: 0; padding: 0; }
                    .email-container { max-width: 600px; margin: 40px auto; background: #ffffff; border-radius: 10px; overflow: hidden; box-shadow: 0 4px 15px rgba(0,0,0,0.05); }
                    .email-header { background: linear-gradient(135deg, #4f46e5 0%, #3b82f6 100%); padding: 30px; text-align: center; color: #ffffff; }
                    .email-header h1 { margin: 0; font-size: 22px; font-weight: 600; }
                    .email-body { padding: 40px 30px; color: #374151; line-height: 1.6; }
                    .content-box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 20px; margin: 20px 0; }
                    .email-footer { background: #f8fafc; padding: 20px; text-align: center; font-size: 12px; color: #94a3b8; border-top: 1px solid #e2e8f0; }
                </style>
            </head>
            <body>
                <div class="email-container">
                    <div class="email-header">
                        <h1>NexKart Return & Refund Notice</h1>
                    </div>
                    <div class="email-body">
                        <div class="content-box">
                            ${html}
                        </div>
                        <p style="font-size: 14px; color: #64748b;">If you have any questions regarding your return status, feel free to contact our support team.</p>
                    </div>
                    <div class="email-footer">
                        &copy; ${new Date().getFullYear()} NexKart. All rights reserved.
                    </div>
                </div>
            </body>
            </html>
        `;

        await sendViaGoogleOAuth(to, subject, professionalHtml);
        return { success: true };
    } catch (error) {
        console.error('Return Mail Sending Error:', error);
        throw error;
    }
};

module.exports = { sendReturnStatusEmail };