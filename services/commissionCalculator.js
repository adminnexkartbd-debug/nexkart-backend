const cron = require('node-cron');
const db = require('../db'); // আপনার ডাটাবেজ কানেকশন পাথ

async function processOrderCommissionUpdates() {
    try {
        // ১. vat_cm = 0 বা false (বা '0') থাকা সকল অর্ডার খুঁজে বের করা
        const [unprocessedOrders] = await db.query(
            `SELECT id, order_id, seller_id, total_amount 
             FROM orders 
             WHERE vat_cm = 0 OR vat_cm IS FALSE OR vat_cm = '0'`
        );

        if (!unprocessedOrders || unprocessedOrders.length === 0) {
            return; // প্রসেস করার মতো কোনো পেন্ডিং অর্ডার নেই
        }

        console.log(`[Commission Cron] ${unprocessedOrders.length} টি পেন্ডিং অর্ডারের কমিশন হিসাব করা হচ্ছে...`);

        const COMMISSION_RATE = 8.1; // ৮.৫% কমিশন

        for (const order of unprocessedOrders) {
            const { id: orderDbId, order_id, seller_id, total_amount } = order;
            const numericTotal = parseFloat(total_amount) || 0;

            if (numericTotal <= 0) {
                console.log(`[Commission Cron] Order ID: ${order_id} - মোট টাকা ০ থাকায় স্কিপ করা হয়েছে।`);
                continue;
            }

            // ২. ৮.৫% কমিশন ও সেলারের বাকি প্রাপ্তি হিসাব
            const commissionAmount = parseFloat(((numericTotal * COMMISSION_RATE) / 100).toFixed(2));
            const remainingSellerAmount = parseFloat((numericTotal - commissionAmount).toFixed(2));
            const currentDate = new Date().toISOString().slice(0, 19).replace('T', ' ');

            // ৩. commission_table-এ তথ্য ইনসার্ট করা
            await db.query(
                `INSERT INTO commission_table 
                 (order_number, commission_rate, commission_amount, seller_id, date) 
                 VALUES (?, ?, ?, ?, ?)`,
                [order_id, COMMISSION_RATE, commissionAmount, seller_id, currentDate]
            );

            // ৪. admins টেবিলে seller_id অনুযায়ী (admins.id = orders.seller_id) total_sales আপডেট করা
            if (seller_id) {
                await db.query(
                    `UPDATE admins 
                     SET total_sales = COALESCE(total_sales, 0) + ? 
                     WHERE id = ?`,
                    [remainingSellerAmount, seller_id]
                );
            }

            // ৫. প্রসেস শেষে orders টেবিলে vat_cm = 1 (true) করা
            await db.query(
                `UPDATE orders SET vat_cm = 1 WHERE id = ?`,
                [orderDbId]
            );

            console.log(`✅ [Commission Cron] Order: ${order_id} | Commission: ৳${commissionAmount} | Seller (${seller_id}) Total Sales Added: ৳${remainingSellerAmount}`);
        }

    } catch (error) {
        console.error("❌ [Commission Cron Error]:", error);
    }
}

// প্রতি ৩০ সেকেন্ড পর পর ব্যাকগ্রাউন্ডে চলবে
const startCommissionCron = () => {
    cron.schedule('*/30 * * * * *', () => {
        processOrderCommissionUpdates();
    });
    console.log("Commission & Sales Update Cron Job Started...");
};

module.exports = startCommissionCron;