// services/ReturnPolicyMail.js
const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
         user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
    }
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
                    <li><b>Proof File:</b> <a href="http://yourdomain.com${orderData.proof_file}">Click to view proof</a></li>
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