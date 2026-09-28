const express = require('express');
const router = express.Router();
const db = require('../db'); // Apnar database connection file path
const { create } = require('xmlbuilder2');

router.get('/sitemap.xml', async (req, res) => {
    try {
        const baseUrl = 'https://www.nexkartbd.com';

        // 1. Static Pages (Home, About, Contact, etc.)
        const staticPages = [
            '/',
            '/about',
            '/contact',
            '/privacy-policy',
            '/terms-and-conditions',
            '/all-products'
        ];

        // 2. Fetch Dynamic Products from Database
        const [products] = await db.query(`SELECT id, updated_at FROM products`);
        
        // 3. Fetch Dynamic Categories from Database (if available)
        // const [categories] = await db.query(`SELECT id, slug FROM categories`);

        // 4. Build XML Structure
        const root = create({ version: '1.0', encoding: 'UTF-8' })
            .ele('urlset', { xmlns: 'http://www.sitemaps.org/schemas/sitemap/0.9' });

        // Add Static Pages to XML
        staticPages.forEach(route => {
            root.ele('url')
                .ele('loc').txt(`${baseUrl}${route}`).up()
                .ele('changefreq').txt('daily').up()
                .ele('priority').txt(route === '/' ? '1.0' : '0.8').up();
        });

        // Add Dynamic Product Pages to XML
        products.forEach(product => {
            root.ele('url')
                .ele('loc').txt(`${baseUrl}/product/${product.id}`).up()
                .ele('lastmod').txt(product.updated_at ? new Date(product.updated_at).toISOString() : new Date().toISOString()).up()
                .ele('changefreq').txt('weekly').up()
                .ele('priority').txt('0.7').up();
        });

        // Generate XML String
        const xml = root.end({ prettyPrint: true });

        // Set Response Header to XML
        res.header('Content-Type', 'application/xml');
        res.status(200).send(xml);

    } catch (error) {
        console.error('Error generating sitemap:', error);
        res.status(500).send('Error generating sitemap');
    }
});

module.exports = router;