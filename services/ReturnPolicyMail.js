// services/ReturnPolicyMail.js
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

const sendReturnEmail = async (sellerEmail, orderData) => {
    try {
        const mailOptions = {
            from: 'admin.nexkartbd@gmail.com',
            to: sellerEmail,
            subject: 'New Return & Refund Request Received',
            html: `
                <h3>New Return Request</h3>
                <p>Hello, a customer has requested a return for one of your products.</p>
                <ul>
                    <li><b>Order ID:</b> ${orderData.order_id}</li>
                    <li><b>Product ID:</b> ${orderData.product_id}</li>
                    <li><b>Reason:</b> ${orderData.return_reason}</li>
                    <li><b>Details:</b> ${orderData.return_details}</li>
                    <li><b>Proof File:</b> <a href="http://nexkart.2bd.net${orderData.proof_file}">Click to view proof</a></li>
                </ul>
                <p>Please check your admin panel for more details.</p>
            `
        };

        await transporter.sendMail(mailOptions);
    } catch (error) {
        console.error("Error sending email:", error);
    }
};

module.exports = { sendReturnEmail };