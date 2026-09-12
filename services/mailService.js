const cron = require('node-cron');
const nodemailer = require('nodemailer');
const db = require('../db'); // আপনার ডাটাবেজ কানেকশন ফাইলের সঠিক পাথ দিন

const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
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

async function processOrderEmailNotifications() {
    try {
        // ২. যেসব অর্ডারে sendMail = 0 সেগুলোর সাথে admins টেবিল JOIN করে seller details এবং customer mail তুলে আনা
        const [pendingMailOrders] = await db.query(
            `SELECT 
                o.*, 
                a.email AS seller_email, 
                a.name AS seller_name 
             FROM orders o
             LEFT JOIN admins a ON o.seller_id = a.id
             WHERE o.sendMail = 0`
        );

        if (!pendingMailOrders || pendingMailOrders.length === 0) {
            return; // নতুন ইমেইল পাঠানোর মতো কোনো অর্ডার নেই
        }

        console.log(`[Mail Cron] ${pendingMailOrders.length} টি অর্ডারের ইমেইল প্রসেস করা হচ্ছে...`);

        // ৩. লুপ চালিয়ে সেলার এবং কাস্টমার উভয়কে ইমেইল পাঠানো
        for (const order of pendingMailOrders) {

            // --- A. সেলারের জন্য ইমেইল টেমপ্লেট ---
            if (order.seller_email) {
                const sellerMailOptions = {
                    from: '"E-Commerce Store" <mehedi.hasantanvir78@gmail.com>',
                    to: order.seller_email,
                    subject: `New Order Received! - Order #${order.order_id}`,
                    html: `
                        <div style="font-family: Arial, sans-serif; color: #333; line-height: 1.6; max-width: 600px;">
                            <h2 style="color: #2c3e50;">Hello ${order.seller_name || 'Seller'},</h2>
                            <p>You have received a new order!</p>
                            
                            <table style="width: 100%; border-collapse: collapse; margin-top: 15px;">
                                <tr style="background-color: #f2f2f2;">
                                    <th style="padding: 10px; border: 1px solid #ddd; text-align: left;">Field</th>
                                    <th style="padding: 10px; border: 1px solid #ddd; text-align: left;">Details</th>
                                </tr>
                                <tr><td style="padding: 8px; border: 1px solid #ddd;"><b>Order ID</b></td><td style="padding: 8px; border: 1px solid #ddd;">${order.order_id}</td></tr>
                                <tr><td style="padding: 8px; border: 1px solid #ddd;"><b>Product ID</b></td><td style="padding: 8px; border: 1px solid #ddd;">${order.product_id}</td></tr>
                                <tr><td style="padding: 8px; border: 1px solid #ddd;"><b>Quantity</b></td><td style="padding: 8px; border: 1px solid #ddd;">${order.quantity}</td></tr>
                                <tr><td style="padding: 8px; border: 1px solid #ddd;"><b>Total Amount</b></td><td style="padding: 8px; border: 1px solid #ddd;">${order.total_amount} BDT</td></tr>
                                <tr><td style="padding: 8px; border: 1px solid #ddd;"><b>Customer Name</b></td><td style="padding: 8px; border: 1px solid #ddd;">${order.customer_name}</td></tr>
                                <tr><td style="padding: 8px; border: 1px solid #ddd;"><b>Customer Phone</b></td><td style="padding: 8px; border: 1px solid #ddd;">${order.customer_phone}</td></tr>
                                <tr><td style="padding: 8px; border: 1px solid #ddd;"><b>Shipping Address</b></td><td style="padding: 8px; border: 1px solid #ddd;">${order.shipping_address}</td></tr>
                            </table>
                        </div>
                    `
                };

                await transporter.sendMail(sellerMailOptions);
                console.log(`[Mail Cron] Seller Email sent to: ${order.seller_email}`);
            }

            // --- B. কাস্টমারের জন্য ইমেইল টেমপ্লেট ---
            if (order.customer_email) {
                const customerMailOptions = {
                    from: '"E-Commerce Store" <mehedi.hasantanvir78@gmail.com>',
                    to: order.customer_email, // orders টেবিলের customer_email কলাম
                    subject: `Order Confirmation - Order #${order.order_id}`,
                    html: `
                        <div style="font-family: Arial, sans-serif; color: #333; line-height: 1.6; max-width: 600px;">
                            <h2 style="color: #27ae60;">Thank you for your order, ${order.customer_name}! 🎉</h2>
                            <p>We have received your order and it is currently being processed.</p>
                            
                            <h3>Order Summary:</h3>
                            <table style="width: 100%; border-collapse: collapse; margin-top: 10px;">
                                <tr style="background-color: #f2f2f2;">
                                    <th style="padding: 8px; border: 1px solid #ddd; text-align: left;">Item</th>
                                    <th style="padding: 8px; border: 1px solid #ddd; text-align: left;">Details</th>
                                </tr>
                                <tr><td style="padding: 8px; border: 1px solid #ddd;">Order ID</td><td style="padding: 8px; border: 1px solid #ddd;">${order.order_id}</td></tr>
                                <tr><td style="padding: 8px; border: 1px solid #ddd;">Quantity</td><td style="padding: 8px; border: 1px solid #ddd;">${order.quantity}</td></tr>
                                <tr><td style="padding: 8px; border: 1px solid #ddd;">Total Paid/Due</td><td style="padding: 8px; border: 1px solid #ddd;"><b>${order.total_amount} BDT</b></td></tr>
                                <tr><td style="padding: 8px; border: 1px solid #ddd;">Payment Method</td><td style="padding: 8px; border: 1px solid #ddd;">${order.payment_method}</td></tr>
                                <tr><td style="padding: 8px; border: 1px solid #ddd;">Shipping Address</td><td style="padding: 8px; border: 1px solid #ddd;">${order.shipping_address}</td></tr>
                            </table>

                            <br>
                            <p>If you have any questions, feel free to reply to this email or contact support.</p>
                            <p>Best Regards,<br><b>E-Commerce Team</b></p>
                        </div>
                    `
                };

                await transporter.sendMail(customerMailOptions);
                console.log(`[Mail Cron] Customer Email sent to: ${order.customer_email}`);
            }

            // ৪. উভয় ইমেইল সফলভাবে পাঠানোর পর sendMail = 1 (True) করে দেওয়া
            await db.query(
                `UPDATE orders SET sendMail = 1 WHERE id = ?`,
                [order.id]
            );

            console.log(`[Mail Cron] Order ID: ${order.order_id} status updated to sendMail = 1`);
        }

    } catch (error) {
        console.error("[Mail Cron] Error sending email:", error);
    }
}

// ক্রন জব সেটআপ (৩০ সেকেন্ড পর পর)
const startMailCron = () => {
    cron.schedule('*/30 * * * * *', () => {
        processOrderEmailNotifications();
    });
    console.log("Mail Cron Job running every 30 seconds...");
};

module.exports = startMailCron;