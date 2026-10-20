const express = require('express');
const db = require('../../db');
const router = express.Router();
const SITE = 'https://www.nexkartbd.com';

function text(value) {
    return String(value ?? '')
        .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, ' ')
        .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, ' ')
        .replace(/<[^>]*>/g, ' ')
        .replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (match, code) => {
            const named = {amp:'&', lt:'<', gt:'>', quot:'"', apos:"'", nbsp:' '};
            if (code[0] !== '#') return named[code.toLowerCase()] || match;
            const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2),16) : parseInt(code.slice(1),10);
            return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : '';
        })
        .replace(/[^\u0009\u000A\u000D\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/gu, '')
        .replace(/\s+/g, ' ').trim();
}
function xml(value) {
    return String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
}
function imageUrl(value) {
    let raw = String(value || '').trim().replace(/\\/g, '/');
    if (!raw) return null;
    // Existing records may have /uploads/ prepended to an absolute image URL.
    raw = raw.replace(/^(\/?uploads\/)+(?=https?:\/\/)/i, '');
    if (!/^https?:\/\//i.test(raw) && !raw.startsWith('/')) raw = '/uploads/' + raw.replace(/^(uploads\/)+/i, '');
    try {
        const url = new URL(raw, SITE);
        return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
    } catch { return null; }
}
const tag = (name, value) => `<g:${name}>${xml(value)}</g:${name}>`;
function item(product) {
    const title = text(product.title).slice(0,150);
    const description = text(product.description || product.product_highlights || product.title).slice(0,5000);
    const image = imageUrl(product.primary_image);
    // Match the product page's price fallback and stock badge logic.
    const sale = Number(product.sale_price);
    const price = sale > 0 ? sale : Number(product.regular_price);
    if (!title || !image || !Number.isFinite(price) || price <= 0) return null;
    const link = product.slug ? `${SITE}/user/product/${encodeURIComponent(product.slug)}`
        : `${SITE}/user/product-details?id=${encodeURIComponent(product.id)}`;
    const brand = text(product.brand_name);
    return '<item>' + [
        tag('id', product.product_id || product.id), tag('title', title),
        tag('description', description), tag('link', link), tag('image_link', image),
        tag('price', price.toFixed(2) + ' BDT'),
        tag('availability', Number(product.stock_quantity) > 0 ? 'in_stock' : 'out_of_stock'),
        tag('condition', 'new'),
        product.category ? tag('product_type', text(product.category)) : '',
        brand && !/^(n\/?a|none|no brand|unbranded|generic)$/i.test(brand) ? tag('brand', brand) : ''
        // Do not invent GTIN/MPN or assert identifier_exists=false from missing data.
    ].join('') + '</item>';
}
router.get('/google-products.xml', async (req, res) => {
    try {
        const [products] = await db.query(`
            SELECT p.id, p.product_id, p.slug, p.title, p.description,
                   p.product_highlights, p.sale_price, p.regular_price,
                   p.stock_quantity, p.category, p.brand_name,
                   (SELECT pi.image_path FROM product_images pi
                    WHERE pi.product_id = p.id ORDER BY pi.id LIMIT 1) AS primary_image
            FROM products p WHERE p.status = 'active' ORDER BY p.id
        `);
        const items = products.map(item).filter(Boolean);
        const skipped = products.length - items.length;
        if (skipped) console.warn(`Merchant feed: skipped ${skipped} products missing a title, image or valid price.`);
        const body = '<?xml version="1.0" encoding="UTF-8"?>\n' +
            '<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0"><channel>' +
            '<title>NexKartBD Products</title><link>' + SITE + '</link>' +
            '<description>NexKartBD online product catalogue</description>' + items.join('\n') + '</channel></rss>';
        res.set('Cache-Control', 'no-store');
        res.set('X-Content-Type-Options', 'nosniff');
        return res.type('application/xml').send(body);
    } catch (error) {
        console.error('Google Merchant feed failed:', error.message);
        // Never return an empty successful feed when the database is unavailable.
        return res.status(503).type('text/plain').send('Product feed temporarily unavailable. Please retry later.');
    }
});
module.exports = router;
