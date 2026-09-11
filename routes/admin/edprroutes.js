const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const db = require('../../db');
const { v2: cloudinary } = require('cloudinary');
const { CloudinaryStorage } = require('multer-storage-cloudinary');
require('dotenv').config();

// Cloudinary Configuration
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Multer Cloudinary Storage Setup (Supports Images and Videos)
const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: async (req, file) => {
    let resourceType = 'image';
    let allowedFormats = ['jpg', 'jpeg', 'png', 'webp', 'gif'];
    
    if (file.mimetype.startsWith('video/')) {
      resourceType = 'auto';
      allowedFormats = ['mp4', 'mov', 'avi', 'webm', 'mkv'];
    }

    return {
      folder: 'uploads',
      resource_type: resourceType,
      allowed_formats: allowedFormats,
      public_id: Date.now() + '-' + Math.round(Math.random() * 1E9),
    };
  },
});

const upload = multer({ storage: storage });

function getCloudinaryPublicId(url) {
  if (!url || !url.includes('cloudinary.com')) return null;
  try {
    const parts = url.split('/upload/');
    if (parts.length < 2) return null;
    
    let publicIdWithExt = parts[1].replace(/^v\d+\//, '');
    
    const lastDotIndex = publicIdWithExt.lastIndexOf('.');
    if (lastDotIndex !== -1) {
      return publicIdWithExt.substring(0, lastDotIndex);
    }
    return publicIdWithExt;
  } catch (e) {
    console.error("Public ID parsing error:", e);
    return null;
  }
}

// ১. সব প্রোডাক্ট ফেচ করার রাউট
router.get('/all', async (req, res) => {
  try {
    const adminId = req.user ? req.user.id : (req.session && req.session.passport ? req.session.passport.user : (req.session && req.session.userId ? req.session.userId : null));

    if (!adminId) {
      return res.status(401).json({ success: false, message: "Unauthorized! অনুগ্রহ করে আবার লগইন করুন।" });
    }

    const query = `
      SELECT p.*, ANY_VALUE(pi.image_path) AS image_path 
      FROM products p 
      LEFT JOIN product_images pi ON p.id = pi.product_id 
      WHERE p.admin_id = ? 
      GROUP BY p.id 
      ORDER BY p.created_at DESC
    `;

    const [results] = await db.query(query, [adminId]);
    return res.status(200).json({ success: true, products: results });

  } catch (err) {
    console.error('Fetch Error:', err);
    return res.status(500).json({ success: false, message: "প্রোডাক্ট লোড করতে সমস্যা হয়েছে!" });
  }
});

// ২. নির্দিষ্ট একটি প্রোডাক্ট ফেচ করার রাউট
router.get('/:id', async (req, res) => {
  try {
    const adminId = req.user ? req.user.id : (req.session && req.session.passport ? req.session.passport.user : (req.session && req.session.userId ? req.session.userId : null));

    if (!adminId) {
      return res.status(401).json({ success: false, message: "Unauthorized! অনুগ্রহ করে আবার লগইন করুন।" });
    }

    const productId = req.params.id;

    const [products] = await db.query('SELECT * FROM products WHERE id = ? AND admin_id = ?', [productId, adminId]);
    
    if (products.length === 0) {
      return res.status(404).json({ success: false, message: 'প্রোডাক্টটি পাওয়া যায়নি বা আপনার অনুমতি নেই!' });
    }

    const product = products[0];

    const [images] = await db.query('SELECT id, image_path FROM product_images WHERE product_id = ?', [product.id]);

    return res.status(200).json({
      success: true,
      product: {
        ...product,
        images: images,
        highlights: product.product_highlights || '',
        sub_category: product.sub_category || '',
        products_variant: product.products_variant || null,
        video_url: product.video_url || null,
        coin_offer: product.coin_offer || 'no',
        coin_percentage_value: product.coin_percentage_value || 0
      }
    });

  } catch (err) {
    console.error('Fetch Single Product Error:', err);
    return res.status(500).json({ success: false, message: 'সার্ভার এরর!' });
  }
});

// ৩. প্রোডাক্ট এড করার রাউট
router.post('/add', upload.fields([
  { name: 'images', maxCount: 10 },
  { name: 'product_video', maxCount: 1 }
]), async (req, res) => {
  try {
    const adminId = req.user ? req.user.id : (req.session && req.session.passport ? req.session.passport.user : (req.session && req.session.userId ? req.session.userId : null));

    if (!adminId) {
      return res.status(401).json({ success: false, message: "Unauthorized! অনুগ্রহ করে আবার লগইন করুন।" });
    }

    const files = req.files;
    const galleryFiles = files && files['images'] ? files['images'] : [];

    if (!galleryFiles || galleryFiles.length < 3) {
      return res.status(400).json({ success: false, message: "কমপক্ষে ৩টি প্রোডাক্টের ছবি আপলোড করা বাধ্যতামূলক!" });
    }

    const {
      product_id, title, brand_name, category, sub_category, products_variant, shipping_from, promo_badge,
      delivery_charge, delivery_limit, delivery_time, guarantee, return_policy, cod_available, open_box_inspection,
      free_shipping, regular_price, old_price, sale_price, stock_quantity,
      stock_status, description, keywords, highlights, coin_offer_toggle, coin_percentage
    } = req.body;

    const cod = cod_available ? 1 : 0;
    const openBox = open_box_inspection ? 1 : 0;
    const freeShip = free_shipping ? 1 : 0;
    const soldQty = 0;

    const cleanBrand = (brand_name && String(brand_name).trim() !== '') ? String(brand_name).trim() : 'N/A';
    const variantData = (products_variant && products_variant.trim() !== '') ? products_variant.trim() : null;
    const cleanOldPrice = (old_price !== undefined && old_price !== null && String(old_price).trim() !== '') ? old_price : null;
    const cleanStockStatus = stock_status || 'in_stock';

    // Video URL handling
    let videoUrl = null;
    if (files && files['product_video'] && files['product_video'][0]) {
      videoUrl = files['product_video'][0].path;
    }

    // Coin Offer handling
    const coinOffer = coin_offer_toggle === 'yes' ? 'yes' : 'no';
    const coinPercentageVal = coinOffer === 'yes' && coin_percentage ? Number(coin_percentage) : 0;

    let highlightList = [];
    if (Array.isArray(highlights)) {
      highlightList = highlights;
    } else if (typeof highlights === 'string') {
      highlightList = highlights.includes(',') ? highlights.split(',') : [highlights];
    }
    const highlightsString = highlightList.map(h => h.trim()).filter(h => h !== '').join(', ');

    const productQuery = `
      INSERT INTO products (
        product_id, admin_id, title, category, sub_category, products_variant, shipping_from, promo_badge, 
        product_highlights, guarantee, return_policy, cod_available, open_box_inspection, 
        free_shipping, delivery_charge, delivery_limit, delivery_time, regular_price, old_price, sale_price, stock_quantity, sold_qty,
        stock_status, description, keywords, brand_name, video_url, coin_offer, coin_percentage_value, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
    `;

    const productValues = [
      product_id, adminId, title, category, sub_category || null, variantData, shipping_from, promo_badge,
      highlightsString, guarantee, return_policy, cod, openBox, freeShip,
      delivery_charge || 60, delivery_limit || 1, delivery_time || '2-3 Days', regular_price, cleanOldPrice, sale_price || null, stock_quantity, soldQty,
      cleanStockStatus, description, keywords, cleanBrand, videoUrl, coinOffer, coinPercentageVal
    ];

    const [result] = await db.query(productQuery, productValues);
    const dbInternalId = result.insertId;

    const imageQuery = `INSERT INTO product_images (product_id, image_path) VALUES ?`;
    const imageValues = galleryFiles.map(file => [dbInternalId, file.path]);
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

// ৪. প্রোডাক্ট আপডেট করার রাউট
router.put('/update/:id', upload.fields([
    { name: 'replaced_images', maxCount: 10 },
    { name: 'new_images', maxCount: 10 },
    { name: 'product_video', maxCount: 1 }
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

        const existingProduct = checkProd[0];

        const {
            product_id, title, brand_name, category, sub_category, products_variant, shipping_from, promo_badge,
            delivery_charge, delivery_limit, delivery_time, guarantee, return_policy, cod_available, open_box_inspection,
            free_shipping, regular_price, old_price, sale_price, stock_quantity,
            stock_status, description, keywords, kept_image_ids, replaced_original_ids,
            coin_offer_toggle, coin_percentage, remove_video,
            'highlights[]': highlightsArray, highlights
        } = req.body;

        const cod = cod_available === 'on' ? 1 : 0;
        const openBox = open_box_inspection === 'on' ? 1 : 0;
        const freeShip = free_shipping === 'on' ? 1 : 0;
        const cleanBrand = (brand_name && String(brand_name).trim() !== '') ? String(brand_name).trim() : 'N/A';
        const cleanOldPrice = (old_price !== undefined && old_price !== null && String(old_price).trim() !== '') ? old_price : null;
        const cleanStockStatus = stock_status || 'in_stock';
        const variantData = (products_variant && products_variant.trim() !== '') ? products_variant.trim() : null;

        // Coin Offer handling
        const coinOffer = coin_offer_toggle === 'yes' ? 'yes' : 'no';
        const coinPercentageVal = coinOffer === 'yes' && coin_percentage ? Number(coin_percentage) : 0;

        // Video URL update logic
        let videoUrl = existingProduct.video_url;
        if (remove_video === '1') {
            if (existingProduct.video_url) {
                const oldVideoPublicId = getCloudinaryPublicId(existingProduct.video_url);
                if (oldVideoPublicId) {
                    await cloudinary.uploader.destroy(oldVideoPublicId, { resource_type: 'video' }).catch(err => console.error("Cloudinary Video Delete Error:", err));
                }
            }
            videoUrl = null;
        }

        if (req.files && req.files['product_video'] && req.files['product_video'][0]) {
            if (existingProduct.video_url) {
                const oldVideoPublicId = getCloudinaryPublicId(existingProduct.video_url);
                if (oldVideoPublicId) {
                    await cloudinary.uploader.destroy(oldVideoPublicId, { resource_type: 'video' }).catch(err => console.error("Cloudinary Video Delete Error:", err));
                }
            }
            videoUrl = req.files['product_video'][0].path;
        }

        let rawHighlights = highlightsArray || highlights;
        let highlightList = [];
        if (Array.isArray(rawHighlights)) {
          highlightList = rawHighlights;
        } else if (typeof rawHighlights === 'string') {
          highlightList = rawHighlights.includes(',') ? rawHighlights.split(',') : [rawHighlights];
        }
        const highlightsString = highlightList.map(h => h.trim()).filter(h => h !== '').join(', ');

        const updateQuery = `
            UPDATE products SET 
                product_id = ?, title = ?, delivery_limit = ?, category = ?, sub_category = ?, products_variant = ?, shipping_from = ?, promo_badge = ?,
                product_highlights = ?, guarantee = ?, return_policy = ?, cod_available = ?, open_box_inspection = ?,
                free_shipping = ?, delivery_charge = ?, delivery_time = ?, regular_price = ?, old_price = ?, sale_price = ?, stock_quantity = ?,
                stock_status = ?, description = ?, keywords = ?, brand_name = ?, video_url = ?, coin_offer = ?, coin_percentage_value = ?
            WHERE id = ? AND admin_id = ?
        `;

        await db.query(updateQuery, [
            product_id, title, delivery_limit || 1, category, sub_category || null, variantData, shipping_from, promo_badge,
            highlightsString, guarantee, return_policy, cod, openBox,
            freeShip, delivery_charge || 60, delivery_time || '2-3 Days', regular_price, cleanOldPrice, sale_price || null, stock_quantity,
            cleanStockStatus, description, keywords, cleanBrand, videoUrl, coinOffer, coinPercentageVal, productId, adminId
        ]);

        let keptIds = [];
        try {
            keptIds = JSON.parse(kept_image_ids || '[]');
        } catch (e) {
            keptIds = [];
        }

        const [existingImages] = await db.query('SELECT id, image_path FROM product_images WHERE product_id = ?', [productId]);
        for (let img of existingImages) {
            if (!keptIds.includes(img.id)) {
                const publicId = getCloudinaryPublicId(img.image_path);
                if (publicId) {
                    await cloudinary.uploader.destroy(publicId).catch(err => console.error("Cloudinary Delete Error:", err));
                }
                await db.query('DELETE FROM product_images WHERE id = ?', [img.id]);
            }
        }

        if (req.files && req.files['replaced_images'] && replaced_original_ids) {
            const repFiles = req.files['replaced_images'];
            const repOriginalIds = Array.isArray(replaced_original_ids) ? replaced_original_ids : [replaced_original_ids];
            
            for (let i = 0; i < repFiles.length; i++) {
                if (repOriginalIds[i]) {
                    const [oldImg] = await db.query('SELECT image_path FROM product_images WHERE id = ?', [repOriginalIds[i]]);
                    if (oldImg.length > 0) {
                        const oldPublicId = getCloudinaryPublicId(oldImg[0].image_path);
                        if (oldPublicId) {
                            await cloudinary.uploader.destroy(oldPublicId).catch(err => console.error("Cloudinary Delete Error:", err));
                        }
                    }

                    const newPath = repFiles[i].path;
                    await db.query('UPDATE product_images SET image_path = ? WHERE id = ?', [newPath, repOriginalIds[i]]);
                }
            }
        }

        if (req.files && req.files['new_images']) {
            for (let file of req.files['new_images']) {
                const newPath = file.path;
                await db.query('INSERT INTO product_images (product_id, image_path) VALUES (?, ?)', [productId, newPath]);
            }
        }

        return res.status(200).json({ success: true, message: 'প্রোডাক্ট সফলভাবে আপডেট করা হয়েছে!' });

    } catch (err) {
        console.error('Update Error:', err);
        return res.status(500).json({ success: false, message: 'সার্ভারে আপডেট করতে সমস্যা হয়েছে!' });
    }
});

// ৫. সিকিউরড প্রোডাক্ট ডিলিট করার রাউট
router.delete('/delete/:id', async (req, res) => {
  try {
    const adminId = req.user ? req.user.id : (req.session && req.session.passport ? req.session.passport.user : (req.session && req.session.userId ? req.session.userId : null));

    if (!adminId) {
      return res.status(401).json({ success: false, message: "Unauthorized! অনুগ্রহ করে আবার লগইন করুন।" });
    }

    const productId = req.params.id;

    const [products] = await db.query(`SELECT * FROM products WHERE id = ? AND admin_id = ?`, [productId, adminId]);
    if (products.length === 0) {
      return res.status(403).json({ success: false, message: "এই প্রোডাক্টটি ডিলিট করার অনুমতি আপনার নেই!" });
    }

    const product = products[0];

    // Delete Cloudinary video if exists
    if (product.video_url) {
      const videoPublicId = getCloudinaryPublicId(product.video_url);
      if (videoPublicId) {
        await cloudinary.uploader.destroy(videoPublicId, { resource_type: 'video' }).catch(err => console.error("Video Cloudinary Delete Error:", err));
      }
    }

    const [images] = await db.query(`SELECT image_path FROM product_images WHERE product_id = ?`, [productId]);

    for (let img of images) {
      const publicId = getCloudinaryPublicId(img.image_path);
      if (publicId) {
        try {
          await cloudinary.uploader.destroy(publicId);
        } catch (cloudErr) {
          console.error(`Failed to delete Cloudinary image (${publicId}):`, cloudErr);
        }
      }
    }

    await db.query(`DELETE FROM product_images WHERE product_id = ?`, [productId]);
    await db.query(`DELETE FROM products WHERE id = ?`, [productId]);

    return res.status(200).json({ success: true, message: "Product and all associated images deleted successfully!" });
  } catch (err) {
    console.error('Delete Error:', err);
    return res.status(500).json({ success: false, message: "ডেটাবেজ থেকে ডিলিট করতে সমস্যা হয়েছে!" });
  }
});

module.exports = router;