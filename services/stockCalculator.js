// services/stockCalculator.js
const cron = require('node-cron');
const db = require('../db'); // আপনার ডাটাবেজ কানেশন পাথটি সঠিকভাবে দিন

async function processOrderStockUpdates() {
    try {
        // ১. যেসকল অর্ডারের qtyCalculate = 0 সেগুলো খুঁজে বের করা
        const [uncalculatedOrders] = await db.query(
            `SELECT id, product_id, quantity FROM orders WHERE qtyCalculate = 0`
        );

        if (!uncalculatedOrders || uncalculatedOrders.length === 0) {
            return; // প্রসেস করার মতো কোনো নতুন অর্ডার নেই
        }

        console.log(`[Stock Cron] ${uncalculatedOrders.length} টি পেন্ডিং অর্ডারের স্টক প্রসেস করা হচ্ছে...`);

        // ২. প্রতিটি অর্ডার লুপ করে প্রোডাক্ট টেবিল আপডেট করা
        for (const order of uncalculatedOrders) {
            const { id: orderDbId, product_id, quantity } = order;
            const orderQty = parseInt(quantity, 10) || 0;

            if (orderQty <= 0) continue;

            // product_id টি সংখ্যা (id) নাকি স্ট্রিং (product_id) তা চেক করা হচ্ছে
            const isNumericId = !isNaN(product_id);
            const whereClause = isNumericId ? 'WHERE id = ?' : 'WHERE product_id = ?';

            // ডাটাবেজে প্রোডাক্ট আপডেট করা (stock_quantity মাইনাস এবং sold_qty প্লাস)
            const [updateResult] = await db.query(
                `UPDATE products 
                 SET stock_quantity = GREATEST(0, stock_quantity - ?), 
                     sold_qty = sold_qty + ?,
                     stock_status = IF(stock_quantity - ? <= 0, 'out_of_stock', stock_status)
                 ${whereClause}`,
                [orderQty, orderQty, orderQty, product_id]
            );

            // প্রোডাক্ট আপডেট সফল হলে অর্ডারের qtyCalculate = 1 করা
            if (updateResult.affectedRows > 0) {
                await db.query(
                    `UPDATE orders SET qtyCalculate = 1 WHERE id = ?`,
                    [orderDbId]
                );
                console.log(`[Stock Cron] Order ID: ${orderDbId} এর স্টক সফলভাবে হিসাব করা হয়েছে।`);
            }
        }

    } catch (error) {
        console.error("[Stock Cron] Error processing stock updates:", error);
    }
}

// প্রতি ৩০ সেকেন্ড পর পর ব্যাকগ্রাউন্ডে এই জবটি অটোমেটিক চলবে
const startStockCron = () => {
    cron.schedule('*/30 * * * * *', () => {
        processOrderStockUpdates();
    });
    console.log("Stock Update Cron Job Started...");
};

module.exports = startStockCron;