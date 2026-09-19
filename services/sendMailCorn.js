const cron = require('node-cron');
const db = require('../db'); 
const { Resend } = require('resend');
const Mailjet = require('node-mailjet');
const PDFDocument = require('pdfkit');
require('dotenv').config();

// ১. Resend Setup
const resend = new Resend(process.env.RESEND_API_KEY);

// ২. Mailjet Setup
const mailjet = Mailjet.apiConnect(
  process.env.MAILJET_API_KEY,
  process.env.MAILJET_SECRET_KEY
);

// Helper: Generate PDF Buffer for Invoice
const createInvoicePDF = (reqData) => {
    return new Promise((resolve, reject) => {
        try {
            const doc = new PDFDocument({ margin: 50 });
            let buffers = [];

            doc.on('data', chunk => buffers.push(chunk));
            doc.on('end', () => resolve(Buffer.concat(buffers)));

            // PDF Design Header
            doc.fontSize(22).fillColor('#db2777').text('NexKartBD', { align: 'center' });
            doc.fontSize(12).fillColor('#6b7280').text('Official Withdrawal Invoice', { align: 'center' });
            doc.moveDown(2);

            // Invoice Meta details
            doc.fontSize(10).fillColor('#333333');
            doc.text(`Transaction ID: ${reqData.transaction_id}`);
            doc.text(`Date: ${new Date().toLocaleString()}`);
            doc.text(`Status: ${reqData.status.toUpperCase()}`);
            doc.moveDown(1.5);

            // Table / Details Box
            doc.rect(50, doc.y, 500, 120).stroke('#e5e7eb');
            const startY = doc.y + 15;
            doc.text(`Seller / User Name: ${reqData.user_name}`, 70, startY);
            doc.text(`Amount: ৳${reqData.amount}`, 70, startY + 25);
            doc.text(`Payment Method: ${String(reqData.payment_type).toUpperCase()}`, 70, startY + 50);
            
            if (reqData.payment_type === 'bank') {
                doc.text(`Bank Name: ${reqData.bank_name || 'N/A'}`, 70, startY + 75);
                doc.text(`Acc Number: ${reqData.bank_acc_number || 'N/A'}`, 70, startY + 95);
            } else {
                doc.text(`Mobile Number: ${reqData.mobile_number || 'N/A'}`, 70, startY + 75);
            }

            doc.moveDown(8);
            doc.fontSize(10).fillColor('#9ca3af').text('This is a computer-generated invoice from NexKartBD.', { align: 'center' });

            doc.end();
        } catch (err) {
            reject(err);
        }
    });
};

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

                // খ. যে সেলার উইথড্র দিয়েছে তার ইমেইল এবং আসল PDF ইনভয়েস জেনারেট করে পাঠানো
                const [sellerRows] = await db.query(
                    `SELECT email FROM admins WHERE id = ?`,
                    [reqData.admin_id]
                );

                if (sellerRows.length > 0 && sellerRows[0].email) {
                    const sellerEmail = sellerRows[0].email;

                    // রিয়েল PDF Buffer জেনারেট করা
                    const pdfBuffer = await createInvoicePDF(reqData);

                    const sellerMailOptions = {
                        to: sellerEmail,
                        subject: `Withdrawal Request Confirmation & PDF Invoice - ${reqData.transaction_id}`,
                        html: `
                            <div style="font-family: Arial, sans-serif; padding: 20px; background-color: #f4f6f8; border-radius: 10px;">
                                <div style="max-width: 600px; margin: auto; background: #ffffff; padding: 30px; border-radius: 8px;">
                                    <h2 style="color: #db2777; text-align: center;">Withdrawal Request Submitted</h2>
                                    <p>প্রিয় ${reqData.user_name}, আপনার ৳${reqData.amount} টাকার উইথড্র রিকোয়েস্ট সফলভাবে জমা হয়েছে।</p>
                                    <p>আপনার উইথড্রর অফিশিয়াল ইনভয়েসটি এই মেইলের সাথে **PDF** আকারে অ্যাটাচ করা আছে।</p>
                                </div>
                            </div>
                        `,
                        text: `Your withdrawal request of ৳${reqData.amount} has been submitted successfully. Please check the attached PDF invoice.`,
                        attachments: [
                            {
                                filename: `Withdraw-Invoice-${reqData.transaction_id}.pdf`,
                                content: pdfBuffer,
                            }
                        ]
                    };

                    await sendMailWithFallback(sellerMailOptions);
                    console.log(`Withdraw Confirmation & PDF Invoice Sent to Seller: ${sellerEmail}`);
                }

                // ৪. ইমেইল পাঠানো সফল হলে withdraw_request টেবিলের send_mail ফিল্ড 1 করে দেওয়া
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