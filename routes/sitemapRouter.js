const express = require('express');
const router = express.Router();
const db = require('../db');
const { create } = require('xmlbuilder2');

router.get('/sitemap.xml', async (req, res) => {
    try {
        const baseUrl = 'https://www.nexkartbd.com';

        // Static & Public Pages
        const staticPages = [
            '/',
            '/user/index',
            '/user/category',
            '/user/dashboard',
            '/user/My-Coupons',
            '/user/seller-profile',
            '/user/userAbout',
            '/user/return-policy',
            '/user/Return-Refund-Requests',
            '/user/ipr-report',
            '/user/cslogin',
            '/user/cssignup'
        ];

        // 1. SELECT me `slug` field fetch karein (aur fallback ke liye `id` bhi)
        const [products] = await db.query(`SELECT id, slug, updated_at FROM products`);

        // Create XML Document
        const root = create({ version: '1.0', encoding: 'UTF-8' })
            .ele('urlset', { xmlns: 'http://www.sitemaps.org/schemas/sitemap/0.9' });

        // Add Static Pages to Sitemap
        staticPages.forEach(route => {
            root.ele('url')
                .ele('loc').txt(`${baseUrl}${route}`).up()
                .ele('changefreq').txt('daily').up()
                .ele('priority').txt(route === '/' ? '1.0' : '0.8').up();
        });

        // 2. Dynamic Product Pages me Slug URL build karein
        products.forEach(product => {
            // Agar product ka slug exist karta hai to Slug URL use karein, warna fallback id URL
            const productPath = product.slug 
                ? `/product/${product.slug}`  // Apne Frontend route URL pattern ke according change kar sakte hain (e.g. /product/slug ya /user/product-details/slug)
                : `/user/product-details?id=${product.id}`;

            root.ele('url')
                .ele('loc').txt(`${baseUrl}${productPath}`).up()
                .ele('lastmod').txt(product.updated_at ? new Date(product.updated_at).toISOString() : new Date().toISOString()).up()
                .ele('changefreq').txt('weekly').up()
                .ele('priority').txt('0.9').up();
        });

        const xml = root.end({ prettyPrint: true });

        res.header('Content-Type', 'application/xml');
        res.status(200).send(xml);

    } catch (error) {
        console.error('Error generating sitemap:', error);
        res.status(500).send('Error generating sitemap');
    }
});

module.exports = router;