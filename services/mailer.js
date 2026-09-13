const { Resend } = require('resend');
const SibApiV3Sdk = require('@getbrevo/brevo');
const Mailjet = require('node-mailjet');
require('dotenv').config();

// 1. Resend Setup
const resend = new Resend(process.env.RESEND_API_KEY);

// 2. Brevo Setup
let defaultClient = SibApiV3Sdk.ApiClient.instance;
let apiKey = defaultClient.authentications['api-key'];
apiKey.apiKey = process.env.BREVO_API_KEY;
let brevoInstance = new SibApiV3Sdk.TransactionalEmailsApi();

// 3. Mailjet Setup
const mailjet = Mailjet.apiConnect(
  process.env.MAILJET_API_KEY,
  process.env.MAILJET_SECRET_KEY
);

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

    // --- 2nd Try: Brevo ---
    try {
      let sendSmtpEmail = new SibApiV3Sdk.SendSmtpEmail();
      sendSmtpEmail.subject = subject;
      sendSmtpEmail.htmlContent = html;
      sendSmtpEmail.sender = { name: "NexKART", email: "no-reply@nexkartbd.com" };
      sendSmtpEmail.to = [{ email: to }];

      await brevoInstance.sendTransacEmail(sendSmtpEmail);
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
                To: [{ Email: to, Name: "Customer" }],
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

module.exports = { sendMailWithFallback };