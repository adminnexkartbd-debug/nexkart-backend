const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const db = require('../../db');
const { v2: cloudinary } = require('cloudinary');
const { CloudinaryStorage } = require('multer-storage-cloudinary');
require('dotenv').config();

// Cloudinary Configuration (.env ফাইল থেকে তথ্য গ্রহণ করছে)
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Multer Cloudinary Storage Setup
const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'uploads', // Cloudinary-র যে ফোল্ডারে ইমেজ সেভ হবে
    allowed_formats: ['jpg', 'jpeg', 'png', 'webp', 'gif'],
    public_id: (req, file) => {
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
      return uniqueSuffix;
    },
  },
});

const upload = multer({ storage: storage });

// 🔴 সিলেক্ট করলে 1 পাঠাবে, না পাঠালে 0 (ডাটাবেজ ডিফল্ট) 🔴
const parseCheckboxValue = (val) => {
  if (val === 1 || val === '1' || val === 'true' || val === true) {
    return 1;
  }
  return 0; // যদি ফ্রন্ট থেকে না পাঠানো হয় (undefined) তবে ০ ধরে নিবে
};

// GET All Products (Supports Search by Product ID and Title)
router.get('/all', async (req, res) => {
  try {
    const adminId = req.user ? req.user.id : (req.session && req.session.passport ? req.session.passport.user : (req.session && req.session.userId ? req.session.userId : null));

    if (!adminId) {
      return res.status(401).json({ success: false, message: "Unauthorized! অনুগ্রহ করে আবার লগইন করুন।" });
    }

    const { search } = req.query;
    const queryParams = [adminId];

    // ANY_VALUE(pi.image_path) ব্যবহার করে ONLY_FULL_GROUP_BY এরর ফিক্স করা হয়েছে
    let query = `
      SELECT p.*, ANY_VALUE(pi.image_path) AS image_path 
      FROM products p 
      LEFT JOIN product_images pi ON p.id = pi.product_id 
      WHERE p.admin_id = ?
    `;

    // LOWER() ব্যবহার করে কেস-ইনসেনসিটিভ সার্চ ফিক্স করা হয়েছে
    if (search && search.trim() !== '') {
      query += ` AND (LOWER(p.product_id) LIKE LOWER(?) OR LOWER(p.title) LIKE LOWER(?))`;
      const searchTerm = `%${search.trim()}%`;
      queryParams.push(searchTerm, searchTerm);
    }

    query += `
      GROUP BY p.id 
      ORDER BY p.created_at DESC
    `;

    const [results] = await db.query(query, queryParams);
    return res.status(200).json({ success: true, products: results });

  } catch (err) {
    console.error('Fetch Error:', err);
    return res.status(500).json({ success: false, message: "প্রোডাক্ট লোড করতে সমস্যা হয়েছে!" });
  }
});

// ADD Product
router.post('/add', upload.array('images', 10), async (req, res) => {
  try {
    const adminId = req.user ? req.user.id : (req.session && req.session.passport ? req.session.passport.user : (req.session && req.session.userId ? req.session.userId : null));

    if (!adminId) {
      return res.status(401).json({ success: false, message: "Unauthorized! অনুগ্রহ করে আবার লগইন করুন।" });
    }

    const files = req.files;

    if (!files || files.length < 3) {
      return res.status(400).json({ success: false, message: "কমপক্ষে ৩টি প্রোডাক্টের ছবি আপলোড করা বাধ্যতামূলক!" });
    }

    const {
      product_id, title, brand_name, category, sub_category, shipping_from, promo_badge,
      delivery_charge, delivery_limit, delivery_time, guarantee, return_policy, 
      cod_available, open_box_inspection, free_shipping,
      regular_price, sale_price, stock_quantity, stock_status, description, keywords, highlights,
      products_variant
    } = req.body;

    const soldQty = 0;
    const cleanBrand = (brand_name && String(brand_name).trim() !== '') ? String(brand_name).trim() : 'N/A';
    const finalStockStatus = (stock_status && String(stock_status).trim() !== '') ? stock_status : 'in_stock';

    // 🔴 ফ্রন্ট থেকে '1' আসলেই কেবল 1 হবে, অন্যথায় (না পাঠালে) 0 থাকবে 🔴
    const finalCod = parseCheckboxValue(cod_available);
    const finalOpenBox = parseCheckboxValue(open_box_inspection);
    const finalFreeShipping = parseCheckboxValue(free_shipping);

    let highlightList = [];
    if (Array.isArray(highlights)) {
      highlightList = highlights;
    } else if (typeof highlights === 'string') {
      highlightList = highlights.includes(',') ? highlights.split(',') : [highlights];
    }
    const highlightsString = highlightList.map(h => h.trim()).filter(h => h !== '').join(', ');

    const finalSalePrice = (sale_price && String(sale_price).trim() !== '') ? sale_price : null;
    const finalVariant = (products_variant && String(products_variant).trim() !== '') ? String(products_variant).trim() : null;

    const productQuery = `
      INSERT INTO products (
        product_id, admin_id, title, category, sub_category, shipping_from, promo_badge, 
        product_highlights, products_variant, guarantee, return_policy, cod_available, open_box_inspection, free_shipping,
        delivery_charge, delivery_limit, delivery_time, 
        regular_price, sale_price, stock_quantity, sold_qty, stock_status, 
        description, keywords, brand_name, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
    `;

    const productValues = [
      product_id, 
      adminId, 
      title, 
      category, 
      sub_category || null, 
      shipping_from, 
      promo_badge,
      highlightsString, 
      finalVariant,
      guarantee, 
      return_policy,
      finalCod,
      finalOpenBox,
      finalFreeShipping,
      delivery_charge || 60, 
      delivery_limit || 1, 
      delivery_time || '2-3 Days', 
      regular_price, 
      finalSalePrice, 
      stock_quantity, 
      soldQty, 
      finalStockStatus, 
      description, 
      keywords, 
      cleanBrand
    ];

    const [result] = await db.query(productQuery, productValues);
    const dbInternalId = result.insertId;

    const imageQuery = `INSERT INTO product_images (product_id, image_path) VALUES ?`;
    // 🔴 Cloudinary-র দেওয়া ফুল পাবলিক URL (`file.path`) সেভ হচ্ছে 🔴
    const imageValues = files.map(file => [dbInternalId, file.path]);
    await db.query(imageQuery, [imageValues]);

    return res.status(200).json({ 
      success: true, 
      message: "সফলভাবে প্রোডাক্টটি অ্যাড করা হয়েছে! 🎉" 
    });

  } catch (error) {
    console.error('Server Error:', error);
    return res.status(500).json({ success: false, message: "সার্ভারে ইন্টারনাল এরর দেখা দিয়েছে।" });
  }
});

// UPDATE Product
router.put('/update/:id', upload.fields([
    { name: 'replaced_images', maxCount: 10 },
    { name: 'new_images', maxCount: 10 }
]), async (req, res) => {
    try {
        const adminId = req.user ? req.user.id : (req.session && req.session.passport ? req.session.passport.user : (req.session && req.session.userId ? req.session.userId : null));

        if (!adminId) {
            return res.status(401).json({ success: false, message: "Unauthorized! অনুগ্রহ করে আবার লগইন করুন।" });
        }

        const productId = req.params.id;

        const [checkProd] = await db.query('SELECT * FROM products WHERE id = ? AND admin_id = ?', [productId, adminId]);
        if (checkProd.length === 0) {
            return res.status(403).json({ success: false, message: "এই প্রোডাক্টটি আপডেট করার অনুমতি আপনার নেই!" });
        }

        const {
            product_id, title, brand_name, category, sub_category, shipping_from, promo_badge,
            delivery_charge, delivery_time, delivery_limit, guarantee, return_policy, 
            cod_available, open_box_inspection, free_shipping,
            regular_price, sale_price, stock_quantity, stock_status, description, keywords,
            kept_image_ids, replaced_original_ids, 'highlights[]': highlightsArray, highlights,
            products_variant
        } = req.body;
        
        const cleanBrand = (brand_name && String(brand_name).trim() !== '') ? String(brand_name).trim() : 'N/A';
        const finalStockStatus = (stock_status && String(stock_status).trim() !== '') ? stock_status : 'in_stock';

        const finalCod = parseCheckboxValue(cod_available);
        const finalOpenBox = parseCheckboxValue(open_box_inspection);
        const finalFreeShipping = parseCheckboxValue(free_shipping);

        let finalHighlights = highlightsArray || highlights;
        let list = [];
        if (Array.isArray(finalHighlights)) {
            list = finalHighlights;
        } else if (typeof finalHighlights === 'string') {
            list = finalHighlights.includes(',') ? finalHighlights.split(',') : [finalHighlights];
        }
        const highlightsString = list.map(h => h.trim()).filter(h => h !== '').join(', ');

        const finalSalePrice = (sale_price !== undefined && sale_price !== null && String(sale_price).trim() !== '') ? sale_price : null;
        const finalVariant = (products_variant && String(products_variant).trim() !== '') ? String(products_variant).trim() : null;
        
        const updateQuery = `
            UPDATE products SET 
                product_id = ?, title = ?, delivery_limit = ?, category = ?, sub_category = ?, shipping_from = ?, promo_badge = ?,
                product_highlights = ?, products_variant = ?, guarantee = ?, return_policy = ?, cod_available = ?, open_box_inspection = ?, free_shipping = ?, delivery_charge = ?, delivery_time = ?,
                regular_price = ?, sale_price = ?, stock_quantity = ?, stock_status = ?,
                description = ?, keywords = ?, brand_name = ?
            WHERE id = ? AND admin_id = ?
        `;

        await db.query(updateQuery, [
            product_id, title, delivery_limit || 1, category, sub_category || null, shipping_from, promo_badge,
            highlightsString, finalVariant, guarantee, return_policy, finalCod, finalOpenBox, finalFreeShipping, delivery_charge || 60, delivery_time || '2-3 Days',
            regular_price, finalSalePrice, stock_quantity,
            finalStockStatus, description, keywords, cleanBrand, productId, adminId
        ]);

        let keptIds = [];
        try {
            keptIds = JSON.parse(kept_image_ids || '[]');
        } catch (e) {
            keptIds = [];
        }

        const [existingImages] = await db.query('SELECT id FROM product_images WHERE product_id = ?', [productId]);
        for (let img of existingImages) {
            if (!keptIds.includes(img.id)) {
                await db.query('DELETE FROM product_images WHERE id = ?', [img.id]);
            }
        }

        // 🔴 রিপ্লেস করা ইমেজের জায়গায় Cloudinary URL (`file.path`) বসানো 🔴
        if (req.files && req.files['replaced_images'] && replaced_original_ids) {
            const repFiles = req.files['replaced_images'];
            const repOriginalIds = Array.isArray(replaced_original_ids) ? replaced_original_ids : [replaced_original_ids];
            
            for (let i = 0; i < repFiles.length; i++) {
                if (repOriginalIds[i]) {
                    const newPath = repFiles[i].path; // Cloudinary URL
                    await db.query('UPDATE product_images SET image_path = ? WHERE id = ?', [newPath, repOriginalIds[i]]);
                }
            }
        }

        // 🔴 নতুন যুক্ত ইমেজের ক্ষেত্রে Cloudinary URL (`file.path`) ইনসার্ট করা 🔴
        if (req.files && req.files['new_images']) {
            for (let file of req.files['new_images']) {
                const newPath = file.path; // Cloudinary URL
                await db.query('INSERT INTO product_images (product_id, image_path) VALUES (?, ?)', [productId, newPath]);
            }
        }

        return res.status(200).json({ success: true, message: 'প্রোডাক্ট সফলভাবে আপডেট করা হয়েছে!' });

    } catch (err) {
        console.error('Update Error:', err);
        return res.status(500).json({ success: false, message: 'সার্ভারে আপডেট করতে সমস্যা হয়েছে!' });
    }
});

module.exports = router;