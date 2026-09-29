const express = require('express');
const dynamicRouter = express.Router();
const path = require('path');
const db = require('../../db'); // Database config path verify kore niben

// ==================== [ DYNAMIC PRODUCT ROUTES ] ====================

// 1. Dynamic Page Render Route (/user/product/iphone-15-pro)
dynamicRouter.get('/product/:slug', (req, res) => {
    res.sendFile(path.join(process.cwd(), 'public', 'users', 'product-details.html'));
});

// Fallback Route for Query Parameters (/user/product-details?slug=iphone-15-pro)
dynamicRouter.get('/product-details', (req, res) => {
    res.sendFile(path.join(process.cwd(), 'public', 'users', 'product-details.html'));
});

// 2. Product API Route (Fetches Product Data by Slug)
dynamicRouter.get('/api/product/:slug', async (req, res) => {
    try {
        const productSlug = req.params.slug;

        // Fetch product strictly by slug
        const [products] = await db.query(
            "SELECT * FROM products WHERE slug = ?", 
            [productSlug]
        );

        if (!products || products.length === 0) {
            return res.status(404).json({ success: false, message: 'Product paoya jayni' });
        }

        const product = products[0];

        // Fetch gallery images
        const [gallery] = await db.query(
            "SELECT image_url FROM product_images WHERE product_id = ?", 
            [product.id]
        );
        const gallery_images = gallery.map(g => g.image_url);

        // Fetch seller other products
        const [seller_products] = await db.query(
            "SELECT * FROM products WHERE (admin_id = ? OR seller_id = ?) AND id != ? LIMIT 4", 
            [product.admin_id || 0, product.seller_id || 0, product.id]
        );

        // Fetch suggested products
        const [suggested_products] = await db.query(
            "SELECT * FROM products WHERE category = ? AND id != ? LIMIT 4", 
            [product.category, product.id]
        );

        res.json({
            success: true,
            product,
            gallery_images,
            seller_products,
            suggested_products
        });
    } catch (err) {
        console.error("Dynamic Product Fetch Error:", err);
        res.status(500).json({ success: false, message: 'Server error occurred' });
    }
});

module.exports = dynamicRouter;