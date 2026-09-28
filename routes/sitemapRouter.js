const express = require('express');
const router = express.Router();
const db = require('../db');
const { create } = require('xmlbuilder2');

router.get('/sitemap.xml', async (req, res) => {
    try {
        const baseUrl = 'https://www.nexkartbd.com';

        // Static & Public HTML Pages (Including dashboard and My-Coupons)
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

        // Fetch Dynamic Products for product-details URLs
        const [products] = await db.query(`SELECT id, updated_at FROM products`);

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

        // Add Dynamic Product Details Pages
        products.forEach(product => {
            root.ele('url')
                .ele('loc').txt(`${baseUrl}/user/product-details?id=${product.id}`).up()
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