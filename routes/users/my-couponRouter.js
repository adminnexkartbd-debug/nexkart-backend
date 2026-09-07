const express = require('express');
const router = express.Router();
const db = require('../../db'); // Promise-based mysql2 connection

router.get('/', async (req, res) => {
    try {
        const query = `
            SELECT 
                c.id,
                c.coupon_name,
                c.discount_amount,
                c.expiry_date,
                c.coupon_scope,
                c.product_id,
                c.product_name AS fallback_product_name,
                c.description AS coupon_description,
                p.title AS original_product_name,
                p.regular_price,
                p.sale_price
            FROM coupons c
            LEFT JOIN products p ON TRIM(c.product_id) = TRIM(p.product_id)
            ORDER BY c.id DESC
        `;

        // mysql2/promise ড্রাইভারের জন্য await ব্যবহার করা হলো
        const [results] = await db.query(query);

        const currentDate = new Date();

        const processedCoupons = (results || []).map(coupon => {
            const expiryDate = coupon.expiry_date ? new Date(coupon.expiry_date) : null;
            
            // ১. মেয়াদের তারিখ চেক
            const isDateExpired = expiryDate ? (expiryDate < currentDate) : true;

            // ২. প্রোডাক্টের নাম নির্ধারণ
            const productName = coupon.original_product_name || coupon.fallback_product_name || 'N/A';

            // ৩. Specific কুপনে প্রোডাক্ট না মিললে Expired
            const isProductMissing = (coupon.coupon_scope === 'specific') && (!coupon.original_product_name && !coupon.fallback_product_name);

            const isExpired = isDateExpired || isProductMissing;

            // প্রাইস ক্যালকুলেশন
            const originalPrice = parseFloat(coupon.sale_price || coupon.regular_price || 0);
            const discount = parseFloat(coupon.discount_amount || 0);

            let finalPrice = originalPrice - discount;
            if (finalPrice < 0) finalPrice = 0;

            return {
                id: coupon.id,
                coupon_name: coupon.coupon_name || '',
                discount_amount: discount,
                expiry_date: coupon.expiry_date,
                coupon_scope: coupon.coupon_scope || 'general',
                product_id: coupon.product_id || '',
                product_name: productName,
                original_price: originalPrice,
                final_price: finalPrice,
                description: coupon.coupon_description || '',
                is_expired: isExpired,
                status_reason: isProductMissing ? 'Product Not Found' : (isDateExpired ? 'Expired' : 'Active')
            };
        });

        return res.json({ success: true, coupons: processedCoupons });

    } catch (error) {
        console.error("❌ Database/Execution Error Detail:", error);
        return res.status(500).json({ 
            success: false, 
            message: "Server Error", 
            error: error.message || "Database execution failed" 
        });
    }
});

module.exports = router;