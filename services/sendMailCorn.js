const cron = require('node-cron');
const db = require('../db'); 
const { Resend } = require('resend');
const Mailjet = require('node-mailjet');
require('dotenv').config();

// ১. Resend Setup
const resend = new Resend(process.env.RESEND_API_KEY);

// ২. Mailjet Setup
const mailjet = Mailjet.apiConnect(
  process.env.MAILJET_API_KEY,
  process.env.MAILJET_SECRET_KEY
);

// মাল্টিপল API ফলব্যাক সহ মেইল পাঠানোর ফাংশন (Resend -> Brevo -> Mailjet)
const sendMailWithFallback = async ({ to, subject, html, text, attachments }) => {
  // --- 1st Try: Resend ---
  try {
    console.log('Trying with Resend...');
    const payload = {
      from: 'NexKARTbd <onboarding@resend.dev>',
      to: Array.isArray(to) ? to : [to],
      subject: subject,
      html: html,
      text: text,
    };
    if (attachments) payload.attachments = attachments;

    const data = await resend.emails.send(payload);
    if (data.error) throw new Error(data.error.message);
    console.log('Mail sent successfully via Resend!');
    return { success: true, provider: 'Resend' };

  } catch (resendError) {
    console.log(`Resend failed: ${resendError.message}. Switching to Brevo...`);

    // --- 2nd Try: Brevo (Using Native Fetch API) ---
    try {
      const brevoPayload = {
        sender: { name: "NexKART", email: "no-reply@nexkartbd.com" },
        to: Array.isArray(to) ? to.map(email => ({ email })) : [{ email: to }],
        subject: subject,
        htmlContent: html,
        textContent: text
      };

      const response = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
          'accept': 'application/json',
          'api-key': process.env.BREVO_API_KEY,
          'content-type': 'application/json'
        },
        body: JSON.stringify(brevoPayload)
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
        const mailjetMessages = Array.isArray(to) 
          ? to.map(email => ({ From: { Email: "pilot@mailjet.com", Name: "NexKART" }, To: [{ Email: email }], Subject: subject, HTMLPart: html, TextPart: text }))
          : [{ From: { Email: "pilot@mailjet.com", Name: "NexKART" }, To: [{ Email: to }], Subject: subject, HTMLPart: html, TextPart: text }];

        await mailjet
          .post('send', { version: 'v3.1' })
          .request({ Messages: mailjetMessages });

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
 * ক্রন জব ফাংশন যা প্রতি ১ মিনিট পর পর রান করবে 
 * এবং যাদের send_mail = 0 আছে তাদের উইথড্র রিকোয়েস্ট সুপার এডমিন ও সেলারের কাছে পাঠাবে।
 */
const initWithdrawCron = () => {
    // ক্রন এক্সপ্রেশন: প্রতি ১ মিনিট পর পর চলবে ('*/1 * * * *')
    cron.schedule('*/1 * * * *', async () => {
        try {
            // ১. withdraw_request টেবিল থেকে যেগুলোর send_mail = 0 সেগুলোর ডেটা নিয়ে আসা
            const [pendingRequests] = await db.query(
                `SELECT * FROM withdraw_request WHERE send_mail = 0`
            );

            if (pendingRequests.length === 0) {
                return; // কোনো নতুন রিকোয়েস্ট না থাকলে স্কিপ করবে
            }

            // ২. admins টেবিল থেকে যাদের status = 'approved' এবং super_admin = 'approved' তাদের ইমেইল খুঁজে বের করা
            const [superAdmins] = await db.query(
                `SELECT email FROM admins WHERE status = 'approved' AND super_admin = 'approved'`
            );

            const adminEmails = superAdmins.map(admin => admin.email).filter(Boolean);

            // ৩. প্রতিটি পেন্ডিং রিকোয়েস্টের জন্য কাজ শুরু করা
            for (const reqData of pendingRequests) {
                
                // ক. সুপার এডমিনদের জন্য মেইল পাঠানো (যদি সুপার এডমিন থাকে)
                if (adminEmails.length > 0) {
                    const adminHtml = `
                        <div style="font-family: Arial, sans-serif; padding: 20px; background-color: #f4f6f8; border-radius: 10px;">
                            <div style="max-width: 600px; margin: auto; background: #ffffff; padding: 30px; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.05);">
                                <h2 style="color: #db2777; text-align: center;">NexKartBD Withdraw Request Notification</h2>
                                <p>প্রিয় সুপার এডমিন,</p>
                                <p>নতুন একটি উইথড্র রিকোয়েস্ট সাবমিট করা হয়েছে। নিচে বিস্তারিত দেওয়া হলো:</p>
                                
                                <div style="background: #fdf2f8; padding: 15px; border-left: 4px solid #db2777; margin: 20px 0; border-radius: 4px;">
                                    <p style="margin: 5px 0;"><strong>ইউজারের নাম:</strong> ${reqData.user_name}</p>
                                    <p style="margin: 5px 0;"><strong>টাকার পরিমাণ:</strong> ৳${reqData.amount}</p>
                                    <p style="margin: 5px 0;"><strong>পেমেন্ট মেথড:</strong> ${String(reqData.payment_type).toUpperCase()}</p>
                                    <p style="margin: 5px 0;"><strong>ট্রানজেকশন আইডি:</strong> ${reqData.transaction_id}</p>
                                    <p style="margin: 5px 0;"><strong>স্ট্যাটাস:</strong> <span style="color: #d97706; font-weight: bold;">${reqData.status}</span></p>
                                </div>

                                <p style="font-size: 12px; color: #6b7280; text-align: center; margin-top: 30px;">
                                    এটি একটি স্বয়ংক্রিয় ক্রন জব নোটিফিকেশন ইমেইল।
                                </p>
                            </div>
                        </div>
                    `;

                    await sendMailWithFallback({
                        to: adminEmails,
                        subject: `New Withdrawal Request - TRX: ${reqData.transaction_id}`,
                        html: adminHtml,
                        text: `New withdrawal request from ${reqData.user_name} of amount ৳${reqData.amount}`
                    });
                    console.log(`Withdraw Email Sent to Super Admin(s) for TRX: ${reqData.transaction_id}`);
                }

                // খ. যে সেলার উইথড্র দিয়েছে তার ইমেইল এবং PDF ইনভয়েস বের করা
                const [sellerRows] = await db.query(
                    `SELECT email FROM admins WHERE id = ?`,
                    [reqData.admin_id]
                );

                if (sellerRows.length > 0 && sellerRows[0].email) {
                    const sellerEmail = sellerRows[0].email;

                    // সেলারের জন্য একটি সিম্পল টেক্সট-বেসড বা HTML ইনভয়েস ডিজাইন (যেটি PDF হিসেবে অ্যাটাচ হবে)
                    const invoiceHtml = `
                        <html>
                        <head>
                            <style>
                                body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; color: #333; padding: 20px; }
                                .box { max-width: 600px; margin: auto; border: 1px solid #ddd; padding: 30px; border-radius: 8px; background: #fff; }
                                h2 { color: #db2777; text-align: center; }
                                .details { background: #fdf2f8; padding: 15px; border-radius: 6px; margin: 20px 0; }
                                .details p { margin: 8px 0; }
                            </style>
                        </head>
                        <body>
                            <div class="box">
                                <h2>NexKartBD - Withdrawal Invoice</h2>
                                <p>প্রিয় <strong>${reqData.user_name}</strong>,</p>
                                <p>আপনার উইথড্র রিকোয়েস্ট সফলভাবে সিস্টেমে রেকর্ড করা হয়েছে। নিচে ইনভয়েস কপি দেওয়া হলো:</p>
                                <div class="details">
                                    <p><strong>Transaction ID:</strong> ${reqData.transaction_id}</p>
                                    <p><strong>Amount:</strong> ৳${reqData.amount}</p>
                                    <p><strong>Payment Method:</strong> ${String(reqData.payment_type).toUpperCase()}</p>
                                    <p><strong>Status:</strong> ${reqData.status}</p>
                                    <p><strong>Date:</strong> ${new Date().toLocaleString()}</p>
                                </div>
                                <p style="text-align: center; font-size: 12px; color: #777;">Thank you for using NexKartBD.</p>
                            </div>
                        </body>
                        </html>
                    `;

                    // HTML কে বেসড 64 এনকোড করে PDF বা HTML ফাইল হিসেবে অ্যাটাচমেন্ট তৈরি করা (Resend API সাপোর্ট করে)
                    const base64Invoice = Buffer.from(invoiceHtml).toString('base64');

                    const sellerMailOptions = {
                        to: sellerEmail,
                        subject: `Withdrawal Request Confirmation & Invoice - ${reqData.transaction_id}`,
                        html: `
                            <div style="font-family: Arial, sans-serif; padding: 20px; background-color: #f4f6f8; border-radius: 10px;">
                                <div style="max-width: 600px; margin: auto; background: #ffffff; padding: 30px; border-radius: 8px;">
                                    <h2 style="color: #db2777; text-align: center;">Withdrawal Request Submitted</h2>
                                    <p>প্রিয় ${reqData.user_name}, আপনার ৳${reqData.amount} টাকার উইথড্র রিকোয়েস্ট সফলভাবে জমা হয়েছে। মেইলের সাথে ইনভয়েস (PDF) অ্যাটাচ করা আছে।</p>
                                </div>
                            </div>
                        `,
                        text: `Your withdrawal request of ৳${reqData.amount} has been submitted successfully.`,
                        attachments: [
                            {
                                filename: `Withdraw-Invoice-${reqData.transaction_id}.html`,
                                content: base64Invoice,
                            }
                        ]
                    };

                    await sendMailWithFallback(sellerMailOptions);
                    console.log(`Withdraw Confirmation & Invoice Email Sent to Seller: ${sellerEmail}`);
                }

                // ৪. ইমেইল পাঠানো সফল হলে withdraw_request টেবিলের send_mail ফিল্ড 1 করে দেওয়া যাতে ডাবল মেইল না যায়
                await db.query(
                    `UPDATE withdraw_request SET send_mail = 1 WHERE id = ?`,
                    [reqData.id]
                );
            }

        } catch (error) {
            console.error('Withdraw Cron Job Error:', error);
        }
    });
};

module.exports = { initWithdrawCron };