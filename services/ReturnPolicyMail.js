// services/ReturnPolicyMail.js
require('dotenv').config();

/**
 * Google OAuth2 ব্যবহার করে সরাসরি Gmail API এর মাধ্যমে প্রফেশনাল মেইল পাঠানোর ফাংশন
 */
const sendViaGoogleOAuth = async (to, subject, html) => {
    try {
        console.log('Generating Google OAuth2 access token for return policy notification...');

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
        console.log('Google Access Token generated successfully. Sending return policy email via Gmail API...');

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

        console.log('Return Policy Email sent successfully via Google OAuth Gmail API!');
        return { success: true, provider: 'Google Gmail API' };

    } catch (error) {
        console.error(`Google OAuth Return Policy Mail Error: ${error.message}`);
        throw error;
    }
};

/**
 * সেলারের কাছে রিটার্ন ও রিফান্ড রিকোয়েস্টের প্রফেশনাল মেইল পাঠানোর ফাংশন[cite: 5]
 */
const sendReturnEmail = async (sellerEmail, orderData) => {
    try {
        const subject = 'New Return & Refund Request Received';
        
        // প্রফেশনাল ও প্রিমিয়াম লুক ডিজাইন
        const html = `
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
                    .details-box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 20px; margin: 20px 0; }
                    .details-box ul { padding-left: 20px; margin: 0; }
                    .details-box li { margin-bottom: 8px; color: #475569; }
                    .btn { background-color: #4f46e5; color: #ffffff !important; padding: 10px 20px; border-radius: 6px; text-decoration: none; font-weight: 600; display: inline-block; margin-top: 15px; }
                    .email-footer { background: #f8fafc; padding: 20px; text-align: center; font-size: 12px; color: #94a3b8; border-top: 1px solid #e2e8f0; }
                </style>
            </head>
            <body>
                <div class="email-container">
                    <div class="email-header">
                        <h1>New Return Request</h1>
                    </div>
                    <div class="email-body">
                        <p>Hello,</p>
                        <p>A customer has requested a return for one of your products.</p>
                        
                        <div class="details-box">
                            <ul>
                                <li><b>Order ID:</b> ${orderData.order_id}[cite: 5]</li>
                                <li><b>Product ID:</b> ${orderData.product_id}[cite: 5]</li>
                                <li><b>Reason:</b> ${orderData.return_reason}[cite: 5]</li>
                                <li><b>Details:</b> ${orderData.return_details}[cite: 5]</li>
                                <li><b>Proof File:</b> <a href="https://www.nexkart.2bd.net${orderData.proof_file}" target="_blank">Click to view proof</a></li>
                            </ul>
                        </div>

                        <p>Please check your admin panel for more details[cite: 5] and take necessary action.</p>
                        
                        <a href="https://www.nexkart.2bd.net/admin/login" class="btn" target="_blank">Go to Admin Panel</a>
                    </div>
                    <div class="email-footer">
                        &copy; ${new Date().getFullYear()} NexKart. All rights reserved.
                    </div>
                </div>
            </body>
            </html>
        `;

        await sendViaGoogleOAuth(sellerEmail, subject, html);
    } catch (error) {
        console.error("Error sending return email via Google OAuth:", error);
    }
};

module.exports = { sendReturnEmail };