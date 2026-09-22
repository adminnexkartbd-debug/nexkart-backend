const axios = require('axios');

/**
 * Google OAuth2 ব্যবহার করে সরাসরি Gmail API এর মাধ্যমে প্রফেশনাল মেইল পাঠানোর ফাংশন (Pure .env based)
 */
async function sendViaGoogleOAuth(to, subject, html) {
    try {
        console.log('Generating Google OAuth2 access token for notification...');

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

        console.log('Email sent successfully via Google OAuth Gmail API!');
        return true;

    } catch (error) {
        console.error(`Google OAuth Mail Error: ${error.message}`);
        return false;
    }
}

async function sendEmailWithGoogle(to, subject, html) {
    return await sendViaGoogleOAuth(to, subject, html);
}

// Exported Functions for Sellers with Professional Design
const sendSellerWarningEmail = async (email, shopName, reason) => {
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8">
        <style>
            body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; background-color: #f4f7f6; margin: 0; padding: 0; }
            .email-container { max-width: 600px; margin: 40px auto; background: #ffffff; border-radius: 10px; overflow: hidden; box-shadow: 0 4px 15px rgba(0,0,0,0.05); }
            .email-header { background: linear-gradient(135deg, #d97706 0%, #b45309 100%); padding: 30px; text-align: center; color: #ffffff; }
            .email-header h1 { margin: 0; font-size: 22px; font-weight: 600; }
            .email-body { padding: 40px 30px; color: #374151; line-height: 1.6; }
            .warning-box { background: #fffbeb; border: 1px solid #fde68a; border-left: 4px solid #d97706; padding: 15px 20px; border-radius: 0 6px 6px 0; margin: 20px 0; color: #92400e; }
            .email-footer { background: #f8fafc; padding: 20px; text-align: center; font-size: 12px; color: #94a3b8; border-top: 1px solid #e2e8f0; }
        </style>
    </head>
    <body>
        <div class="email-container">
            <div class="email-header">
                <h1>Official Warning Notice</h1>
            </div>
            <div class="email-body">
                <p>Dear Seller (<strong>${shopName}</strong>),</p>
                <p>System admin has issued an official warning regarding your store activities.</p>
                <div class="warning-box">
                    <strong>Reason:</strong> ${reason}
                </div>
                <p>Please resolve this issue promptly to avoid any further service disruptions or account suspension.</p>
            </div>
            <div class="email-footer">
                &copy; ${new Date().getFullYear()} NexKart. All rights reserved.
            </div>
        </div>
    </body>
    </html>
  `;
  return await sendEmailWithGoogle(email, `Warning Notice - ${shopName}`, html);
};

const sendSellerBanEmail = async (email, reason) => {
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8">
        <style>
            body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; background-color: #f4f7f6; margin: 0; padding: 0; }
            .email-container { max-width: 600px; margin: 40px auto; background: #ffffff; border-radius: 10px; overflow: hidden; box-shadow: 0 4px 15px rgba(0,0,0,0.05); }
            .email-header { background: linear-gradient(135deg, #dc2626 0%, #b91c1c 100%); padding: 30px; text-align: center; color: #ffffff; }
            .email-header h1 { margin: 0; font-size: 22px; font-weight: 600; }
            .email-body { padding: 40px 30px; color: #374151; line-height: 1.6; }
            .ban-box { background: #fef2f2; border: 1px solid #fecaca; border-left: 4px solid #dc2626; padding: 15px 20px; border-radius: 0 6px 6px 0; margin: 20px 0; color: #991b1b; }
            .email-footer { background: #f8fafc; padding: 20px; text-align: center; font-size: 12px; color: #94a3b8; border-top: 1px solid #e2e8f0; }
        </style>
    </head>
    <body>
        <div class="email-container">
            <div class="email-header">
                <h1>Account Suspension Notice</h1>
            </div>
            <div class="email-body">
                <p>Hello,</p>
                <p>Your seller account has been suspended by the administration due to policy violations.</p>
                <div class="ban-box">
                    <strong>Reason:</strong> ${reason}
                </div>
                <p>If you believe this is a mistake, please contact our support team.</p>
            </div>
            <div class="email-footer">
                &copy; ${new Date().getFullYear()} NexKart. All rights reserved.
            </div>
        </div>
    </body>
    </html>
  `;
  return await sendEmailWithGoogle(email, 'Account Suspended Notice', html);
};

const sendSellerUnbanEmail = async (email) => {
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8">
        <style>
            body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; background-color: #f4f7f6; margin: 0; padding: 0; }
            .email-container { max-width: 600px; margin: 40px auto; background: #ffffff; border-radius: 10px; overflow: hidden; box-shadow: 0 4px 15px rgba(0,0,0,0.05); }
            .email-header { background: linear-gradient(135deg, #059669 0%, #047857 100%); padding: 30px; text-align: center; color: #ffffff; }
            .email-header h1 { margin: 0; font-size: 22px; font-weight: 600; }
            .email-body { padding: 40px 30px; color: #374151; line-height: 1.6; }
            .success-box { background: #f0fdf4; border: 1px solid #bbf7d0; border-left: 4px solid #059669; padding: 15px 20px; border-radius: 0 6px 6px 0; margin: 20px 0; color: #065f46; }
            .email-footer { background: #f8fafc; padding: 20px; text-align: center; font-size: 12px; color: #94a3b8; border-top: 1px solid #e2e8f0; }
        </style>
    </head>
    <body>
        <div class="email-container">
            <div class="email-header">
                <h1>Account Reactivated</h1>
            </div>
            <div class="email-body">
                <p>Hello,</p>
                <div class="success-box">
                    Your seller account suspension has been successfully lifted.
                </div>
                <p>You can now access your dashboard and operate your shop normally.</p>
            </div>
            <div class="email-footer">
                &copy; ${new Date().getFullYear()} NexKart. All rights reserved.
            </div>
        </div>
    </body>
    </html>
  `;
  return await sendEmailWithGoogle(email, 'Account Reactivated Notice', html);
};

module.exports = {
  sendSellerWarningEmail,
  sendSellerBanEmail,
  sendSellerUnbanEmail,
  sendEmailWithGoogle
};