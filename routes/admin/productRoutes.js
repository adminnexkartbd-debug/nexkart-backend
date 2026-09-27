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

// চেকবক্স ভ্যালু পার্স করার ফাংশন
const parseCheckboxValue = (val) => {
  if (val === 1 || val === '1' || val === 'true' || val === true) {
    return 1;
  }
  return 0;
};

// ==========================================
// 🛠️ HELPER: SEO Friendly Unique Slug Generator
// ==========================================
async function generateUniqueSlug(title, currentProductId = null) {
  if (!title) return '';

  // ১. টাইটেলকে ক্লিন করে URL Friendly ফরম্যাটে রূপান্তর (বাংলা ও ইংরেজি সাপোর্ট সহ)
  let baseSlug = title
    .toString()
    .trim()
    .toLowerCase()
    .replace(/[\s\_]+/g, '-')       // স্পেস বা আন্ডারস্কোরকে হাইফেন (-) করা
    .replace(/[^\w\u0980-\u09FF\-]+/g, '') // বাংলা ও ইংরেজি অক্ষর/সংখ্যা ছাড়া বাকি সব চিহ্ন বাদ দেওয়া
    .replace(/\-\-+/g, '-')        // পর পর একাধিক হাইফেন থাকলে ১টি করা
    .replace(/^-+/, '')             // শুরুর হাইফেন ট্রিম করা
    .replace(/-+$/, '');            // শেষের হাইফেন ট্রিম করা

  if (!baseSlug) {
    baseSlug = 'product-' + Date.now();
  }

  let uniqueSlug = baseSlug;
  let counter = 1;

  // ২. ডাটাবেসে আগের কোনো ইউনিক স্ল্যাগ আছে কিনা চেক করে Unique Slug বানানো
  while (true) {
    let query = 'SELECT id FROM products WHERE slug = ?';
    let params = [uniqueSlug];

    if (currentProductId) {
      query += ' AND id != ?';
      params.push(currentProductId);
    }

    const [rows] = await db.query(query, params);
    if (rows.length === 0) {
      break; // ইউনিক পাওয়া গেছে
    }

    uniqueSlug = `${baseSlug}-${counter}`;
    counter++;
  }

  return uniqueSlug;
}

// Cloudinary URL থেকে public_id বের করার হেলপার
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

// GET All Products (Supports Search by Product ID and Title)
router.get('/all', async (req, res) => {
  try {
    const adminId = req.user ? req.user.id : (req.session && req.session.passport ? req.session.passport.user : (req.session && req.session.userId ? req.session.userId : null));

    if (!adminId) {
      return res.status(401).json({ success: false, message: "Unauthorized! অনুগ্রহ করে আবার লগইন করুন।" });
    }

    const { search } = req.query;
    const queryParams = [adminId];

    let query = `
      SELECT p.*, ANY_VALUE(pi.image_path) AS image_path 
      FROM products p 
      LEFT JOIN product_images pi ON p.id = pi.product_id 
      WHERE p.admin_id = ?
    `;

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

// GET Single Product by ID
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
        product_video: product.product_video || null,
        coin_offer: product.coin_offer || 'no',
        coin_percentage_value: product.coin_percentage_value || null
      }
    });

  } catch (err) {
    console.error('Fetch Single Product Error:', err);
    return res.status(500).json({ success: false, message: 'সার্ভার এরর!' });
  }
});

// ADD Product (Supports Images, Video, Coin Offer Data, and Slug)
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
    const imageFiles = files ? files['images'] : null;
    const videoFiles = files ? files['product_video'] : null;

    if (!imageFiles || imageFiles.length < 3) {
      return res.status(400).json({ success: false, message: "কমপক্ষে ৩টি প্রোডাক্টের ছবি আপলোড করা বাধ্যতামূলক!" });
    }

    const productVideoPath = videoFiles && videoFiles.length > 0 ? videoFiles[0].path : null;

    const {
      product_id, title, brand_name, category, sub_category, shipping_from, promo_badge,
      delivery_charge, delivery_limit, delivery_time, guarantee, return_policy, 
      cod_available, open_box_inspection, free_shipping,
      regular_price, sale_price, stock_quantity, stock_status, description, keywords, highlights,
      products_variant, coin_offer_toggle, coin_percentage
    } = req.body;

    // 🔥 Dynamic Unique Slug Generator
    const slug = await generateUniqueSlug(title);

    const soldQty = 0;
    const cleanBrand = (brand_name && String(brand_name).trim() !== '') ? String(brand_name).trim() : 'N/A';
    const finalStockStatus = (stock_status && String(stock_status).trim() !== '') ? stock_status : 'in_stock';

    const finalCod = parseCheckboxValue(cod_available);
    const finalOpenBox = parseCheckboxValue(open_box_inspection);
    const finalFreeShipping = parseCheckboxValue(free_shipping);

    const finalCoinOffer = coin_offer_toggle || 'no';
    const finalCoinPercentage = (finalCoinOffer === 'yes' && coin_percentage) ? coin_percentage : null;

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
        product_id, admin_id, title, slug, category, sub_category, shipping_from, promo_badge, 
        product_highlights, products_variant, guarantee, return_policy, cod_available, open_box_inspection, free_shipping,
        delivery_charge, delivery_limit, delivery_time, 
        regular_price, sale_price, stock_quantity, sold_qty, stock_status, 
        description, keywords, brand_name, product_video, coin_offer, coin_percentage_value, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
    `;

    const productValues = [
      product_id, 
      adminId, 
      title, 
      slug,
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
      cleanBrand,
      productVideoPath,
      finalCoinOffer,
      finalCoinPercentage
    ];

    const [result] = await db.query(productQuery, productValues);
    const dbInternalId = result.insertId;

    const imageQuery = `INSERT INTO product_images (product_id, image_path) VALUES ?`;
    const imageValues = imageFiles.map(file => [dbInternalId, file.path]);
    await db.query(imageQuery, [imageValues]);

    return res.status(200).json({ 
      success: true, 
      message: "সফলভাবে প্রোডাক্ট, ভিডিও এবং কয়েন অফার সহ অ্যাড করা হয়েছে! 🎉",
      slug: slug
    });

  } catch (error) {
    console.error('Server Error:', error);
    return res.status(500).json({ success: false, message: "সার্ভারে ইন্টারনাল এরর দেখা দিয়েছে।" });
  }
});

// UPDATE Product (Supports Slug update, Image update, Video update & Coin offer update)
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
            product_id, title, brand_name, category, sub_category, shipping_from, promo_badge,
            delivery_charge, delivery_time, delivery_limit, guarantee, return_policy, 
            cod_available, open_box_inspection, free_shipping,
            regular_price, sale_price, stock_quantity, stock_status, description, keywords,
            kept_image_ids, replaced_original_ids, 'highlights[]': highlightsArray, highlights,
            products_variant, coin_offer_toggle, coin_percentage, remove_video
        } = req.body;

        // 🔥 টাইটেল পরিবর্তন হলে নতুন Slug তৈরি, তা না হলে আগেরটি রাখা
        let slug = existingProduct.slug;
        if (title && title.trim() !== existingProduct.title) {
          slug = await generateUniqueSlug(title, productId);
        }
        
        const cleanBrand = (brand_name && String(brand_name).trim() !== '') ? String(brand_name).trim() : 'N/A';
        const finalStockStatus = (stock_status && String(stock_status).trim() !== '') ? stock_status : 'in_stock';

        const finalCod = parseCheckboxValue(cod_available);
        const finalOpenBox = parseCheckboxValue(open_box_inspection);
        const finalFreeShipping = parseCheckboxValue(free_shipping);

        const finalCoinOffer = coin_offer_toggle || existingProduct.coin_offer || 'no';
        const finalCoinPercentage = (finalCoinOffer === 'yes' && coin_percentage) ? coin_percentage : (finalCoinOffer === 'yes' ? existingProduct.coin_percentage_value : null);

        let productVideoPath = existingProduct.product_video;
        if (remove_video === '1') {
            if (existingProduct.product_video) {
                const oldVideoPublicId = getCloudinaryPublicId(existingProduct.product_video);
                if (oldVideoPublicId) {
                    await cloudinary.uploader.destroy(oldVideoPublicId, { resource_type: 'video' }).catch(err => console.error("Cloudinary Video Delete Error:", err));
                }
            }
            productVideoPath = null;
        }

        if (req.files && req.files['product_video'] && req.files['product_video'][0]) {
            if (existingProduct.product_video) {
                const oldVideoPublicId = getCloudinaryPublicId(existingProduct.product_video);
                if (oldVideoPublicId) {
                    await cloudinary.uploader.destroy(oldVideoPublicId, { resource_type: 'video' }).catch(err => console.error("Cloudinary Video Delete Error:", err));
                }
            }
            productVideoPath = req.files['product_video'][0].path;
        }

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
                product_id = ?, title = ?, slug = ?, delivery_limit = ?, category = ?, sub_category = ?, shipping_from = ?, promo_badge = ?,
                product_highlights = ?, products_variant = ?, guarantee = ?, return_policy = ?, cod_available = ?, open_box_inspection = ?, free_shipping = ?, delivery_charge = ?, delivery_time = ?,
                regular_price = ?, sale_price = ?, stock_quantity = ?, stock_status = ?,
                description = ?, keywords = ?, brand_name = ?, product_video = ?, coin_offer = ?, coin_percentage_value = ?
            WHERE id = ? AND admin_id = ?
        `;

        await db.query(updateQuery, [
            product_id, title, slug, delivery_limit || 1, category, sub_category || null, shipping_from, promo_badge,
            highlightsString, finalVariant, guarantee, return_policy, finalCod, finalOpenBox, finalFreeShipping, delivery_charge || 60, delivery_time || '2-3 Days',
            regular_price, finalSalePrice, stock_quantity,
            finalStockStatus, description, keywords, cleanBrand, productVideoPath, finalCoinOffer, finalCoinPercentage, productId, adminId
        ]);

        let keptIds = [];
        try {
            keptIds = JSON.parse(kept_image_ids || '[]');
        } catch (e) {
            keptIds = [];
        }

        const [existingImages] = await db.query('SELECT id, image_path FROM product_images WHERE product_id = ?', [productId]);
        for (let img of existingImages) {
            if (!keptIds.includes(String(img.id)) && !keptIds.includes(img.id)) {
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

// DELETE Product
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

    if (product.product_video) {
      const videoPublicId = getCloudinaryPublicId(product.product_video);
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

    return res.status(200).json({ success: true, message: "প্রোডাক্ট এবং ছবি/ভিডিও সফলভাবে ডিলিট করা হয়েছে!" });
  } catch (err) {
    console.error('Delete Error:', err);
    return res.status(500).json({ success: false, message: "ডেটাবেজ থেকে ডিলিট করতে সমস্যা হয়েছে!" });
  }
});

module.exports = router;