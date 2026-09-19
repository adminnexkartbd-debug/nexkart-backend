const axios = require('axios');
const mailjet = require('node-mailjet');

// Helper function: Resend API diye mail pathanor chesta
async function sendViaResend(to, subject, html) {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) throw new Error('Resend API key missing');

    const response = await axios.post('https://api.resend.com/emails', {
        from: 'Admin System <admin@nexkart.2bd.net>',
        to: [to],
        subject: subject,
        html: html
    }, {
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
        },
        timeout: 10000
    });
    return response.data;
}

// Helper function: Brevo API diye mail pathanor chesta
async function sendViaBrevo(to, subject, html) {
    const apiKey = process.env.BREVO_API_KEY;
    if (!apiKey) throw new Error('Brevo API key missing');

    const response = await axios.post('https://api.brevo.com/v3/smtp/email', {
        sender: { name: 'Admin System', email: 'admin.nexkartbd@gmail.com' },
        to: [{ email: to }],
        subject: subject,
        htmlContent: html
    }, {
        headers: {
            'api-key': apiKey,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        },
        timeout: 10000
    });
    return response.data;
}

// Helper function: Mailjet API diye mail pathanor chesta
async function sendViaMailjet(to, subject, html) {
    const publicKey = process.env.MAILJET_API_KEY;
    const secretKey = process.env.MAILJET_SECRET_KEY;
    if (!publicKey || !secretKey) throw new Error('Mailjet API keys missing');

    const mailjetClient = mailjet.apiConnect(publicKey, secretKey);
    const request = mailjetClient
        .post('send', { version: 'v3.1' })
        .request({
            Messages: [
                {
                    From: { Email: "admin.nexkartbd@gmail.com", Name: "Admin System" },
                    To: [{ Email: to }],
                    Subject: subject,
                    HTMLPart: html
                }
            ]
        });
    return await request;
}

// Master Fallback Function (Resend -> Brevo -> Mailjet)
async function sendEmailWithFallback(to, subject, html) {
    let lastError = null;

    // ১. Prothom chesta Resend diye
    try {
        await sendViaResend(to, subject, html);
        console.log("Email sent successfully via Resend API");
        return true;
    } catch (err) {
        console.warn("Resend API failed, trying Brevo...", err.message);
        lastError = err;
    }

    // ২. Ditiyo chesta Brevo diye
    try {
        await sendViaBrevo(to, subject, html);
        console.log("Email sent successfully via Brevo API");
        return true;
    } catch (err) {
        console.warn("Brevo API failed, trying Mailjet...", err.message);
        lastError = err;
    }

    // ৩. Tritiyo chesta Mailjet diye
    try {
        await sendViaMailjet(to, subject, html);
        console.log("Email sent successfully via Mailjet API");
        return true;
    } catch (err) {
        console.error("All email APIs failed (Resend, Brevo, Mailjet).", err.message);
        lastError = err;
    }

    throw lastError;
}

// Exported Functions
const sendSellerWarningEmail = async (email, shopName, reason) => {
  const html = `
    <div style="font-family: Arial, sans-serif; padding: 20px;">
      <h3 style="color: #d97706;">Official Warning Notice</h3>
      <p>Dear Seller (<b>${shopName}</b>),</p>
      <p>System admin has issued a warning regarding your account.</p>
      <p><b>Reason:</b> ${reason}</p>
      <p>Please resolve this issue promptly to avoid service disruption.</p>
    </div>
  `;
  return await sendEmailWithFallback(email, `Warning Notice - ${shopName}`, html);
};

const sendSellerBanEmail = async (email, reason) => {
  const html = `
    <div style="font-family: Arial, sans-serif; padding: 20px;">
      <h3 style="color: #dc2626;">Account Suspended Notice</h3>
      <p>Your seller account has been banned/suspended by administration.</p>
      <p><b>Reason:</b> ${reason}</p>
      <p>Contact support if you think this is a mistake.</p>
    </div>
  `;
  return await sendEmailWithFallback(email, 'Account Suspended Notice', html);
};

const sendSellerUnbanEmail = async (email) => {
  const html = `
    <div style="font-family: Arial, sans-serif; padding: 20px;">
      <h3 style="color: #059669;">Account Reactivated</h3>
      <p>Your seller account suspension has been lifted. You can now access your dashboard and operate your shop.</p>
    </div>
  `;
  return await sendEmailWithFallback(email, 'Account Reactivated Notice', html);
};

module.exports = {
  sendSellerWarningEmail,
  sendSellerBanEmail,
  sendSellerUnbanEmail
};