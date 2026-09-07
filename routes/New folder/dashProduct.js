const express = require('express');
const router = express.Router();
const db = require('../db'); 
// 📌 ডাটাবেজ থেকে সব প্রোডাক্ট এবং সেগুলোর প্রথম ছবি ফেচ করার API Route
// 📌 ডাটাবেজ থেকে কাস্টমার ড্যাশবোর্ডের সব প্রোডাক্ট এবং প্রথম ছবি ফেচ করার API
router.get('/dashProduct', async (req, res) => {
    try {
        const query = `
            SELECT 
                p.id,
                p.product_id,
                p.admin_id,
                p.title,
                p.sku,
                p.category,
                p.shipping_from,
                p.promo_badge,
                p.guarantee,
                p.return_policy,
                p.cod_available,
                p.open_box_inspection,
                p.free_shipping,
                p.regular_price,
                p.sale_price,
                p.stock_quantity,
                p.sold_qty,
                p.stock_status,
                p.description,
                p.keywords,
                p.created_at,
                p.updated_at,
                MIN(pi.image_path) AS primary_image
            FROM products p
            LEFT JOIN product_images pi ON p.id = pi.product_id
            GROUP BY p.id
            ORDER BY p.id DESC
        `;

        // আপনার users.js এ db.query ব্যবহার করা হয়েছে
        const [products] = await db.query(query);

        res.json({
            success: true,
            count: products.length,
            products: products
        });

    } catch (error) {
        console.error("Dashboard Product Load Error:", error);
        res.status(500).json({ success: false, message: "Server Error" });
    }
});

module.exports = router;