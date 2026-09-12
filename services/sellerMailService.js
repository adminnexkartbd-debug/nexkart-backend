const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    },
    family: 4, // 👈 এটি অবশ্যই দিতে হবে (IPv4 নিশ্চিত করার জন্য)
    tls: {
        rejectUnauthorized: false
    },
    connectionTimeout: 20000,
    greetingTimeout: 20000,
    socketTimeout: 20000
});

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

  return await transporter.sendMail({
    from: '"Admin System" <admin.nexkartbd@gmail.com>',
    to: email,
    subject: `Warning Notice - ${shopName}`,
    html
  });
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

  return await transporter.sendMail({
    from: '"Admin System" <admin.nexkartbd@gmail.com>',
    to: email,
    subject: 'Account Suspended Notice',
    html
  });
};

const sendSellerUnbanEmail = async (email) => {
  const html = `
    <div style="font-family: Arial, sans-serif; padding: 20px;">
      <h3 style="color: #059669;">Account Reactivated</h3>
      <p>Your seller account suspension has been lifted. You can now access your dashboard and operate your shop.</p>
    </div>
  `;

  return await transporter.sendMail({
    from: '"Admin System" <admin.nexkartbd@gmail.com>',
    to: email,
    subject: 'Account Reactivated Notice',
    html
  });
};

module.exports = {
  sendSellerWarningEmail,
  sendSellerBanEmail,
  sendSellerUnbanEmail
};