const express = require('express');
const router = express.Router();
const path = require('path');
const db = require('../../db'); // আপনার ডাটাবেজ কানেকশন ফাইলের সঠিক পাথ দিন[cite: 2]
const axios = require('axios');
// পে-স্যুট সার্ভিস সঠিকভাবে ইম্পোর্ট করা হলো যাতে ReferenceError না ঘটে[cite: 2]
const { createPaySuitePayment } = require('../../services/paysuiteService');

// Authentication Middleware
const isAuthenticated = (req, res, next) => {
    const userId = req.user ? req.user.id : (req.session && req.session.user ? req.session.user.id : (req.session && req.session.userId ? req.session.userId : null));
    if (userId) {
        req.user = { id: userId };
        return next();
    }
    return res.status(401).json({ success: false, message: 'Unauthorized: Please login first!' });
};

// ==================== BDGate Payment Helper ====================
const createBDGatePayment = async (orderData, totalAmount) => {
    try {
        const response = await axios.post(`${process.env.BDGATE_API_URL}/checkout`, {
            amount: totalAmount,
            order_id: orderData.order_id,
            customer_name: orderData.name,
            customer_email: orderData.email,
            customer_phone: orderData.phone,
            payment_method: orderData.selected_gateway,
            callback_url: process.env.BDGATE_CALLBACK_URL
        }, {
            headers: {
                'Authorization': `Bearer ${process.env.BDGATE_API_KEY}`,
                'Content-Type': 'application/json'
            }
        });

        if (response.data && (response.data.checkout_url || response.data.url)) {
            return {
                success: true,
                payment_url: response.data.checkout_url || response.data.url,
                slug: response.data.slug || orderData.order_id
            };
        }
        return { success: false, message: 'Failed to generate BDGate checkout URL' };
    } catch (error) {
        console.error("BDGate API Error:", error.response?.data || error.message);
        return { success: false, message: error.response?.data?.message || 'BDGate payment initialization failed' };
    }
};

// ==================== HTML PAGE RENDER ====================
router.get('/cart-html', (req, res) => {
    res.sendFile(path.join(process.cwd(), 'public', 'users', 'cart-html.html'));
});

// ==================== 1. FETCH CART ITEMS API ====================
router.get('/api/cart-items', isAuthenticated, async (req, res) => {
    try {
        const userId = req.user.id;

        const query = `
            SELECT 
                c.id AS cart_id,
                c.user_id,
                c.product_id,
                c.quantity AS cart_quantity,
                p.title AS product_name,
                p.category,
                p.sale_price,
                p.regular_price,
                p.stock_quantity,
                p.delivery_charge,
                p.delivery_limit,
                p.free_shipping,
                p.cod_available,
                p.admin_id,
                COALESCE(
                    (
                        SELECT 
                            CASE 
                                WHEN pi.image_path LIKE 'http%' THEN pi.image_path
                                WHEN pi.image_path LIKE '/uploads/%' THEN pi.image_path
                                ELSE CONCAT('/uploads/', pi.image_path)
                            END
                        FROM product_images pi 
                        WHERE pi.product_id = p.id 
                        LIMIT 1
                    ), 
                    '/uploads/default.png'
                ) AS primary_image
            FROM cart c
            JOIN products p ON c.product_id = p.id
            WHERE c.user_id = ?
            ORDER BY c.id DESC
        `;

        const [items] = await db.execute(query, [userId]);

        const processedItems = items.map(item => {
            const isSoldOut = item.stock_quantity <= 0;
            return {
                ...item,
                is_sold_out: isSoldOut,
                price: item.sale_price > 0 ? parseFloat(item.sale_price) : parseFloat(item.regular_price)
            };
        });

        res.status(200).json({ success: true, data: processedItems });
    } catch (error) {
        console.error("Cart Fetch Error:", error);
        res.status(500).json({ success: false, message: "Internal server error" });
    }
});

// ==================== 2. ADD TO CART API ====================
router.post('/api/cart/add', isAuthenticated, async (req, res) => {
    try {
        const userId = req.user.id;
        const { product_id, quantity = 1 } = req.body;

        const [product] = await db.execute('SELECT id, stock_quantity FROM products WHERE id = ? OR product_id = ?', [product_id, product_id]);
        if (product.length === 0) {
            return res.status(404).json({ success: false, message: 'Product not found' });
        }

        const actualProductId = product[0].id;

        if (product[0].stock_quantity <= 0) {
            return res.status(400).json({ success: false, message: 'Item is sold out' });
        }

        const [existing] = await db.execute('SELECT id, quantity FROM cart WHERE user_id = ? AND product_id = ?', [userId, actualProductId]);

        if (existing.length > 0) {
            const newQty = existing[0].quantity + parseInt(quantity);
            await db.execute('UPDATE cart SET quantity = ? WHERE id = ?', [newQty, existing[0].id]);
        } else {
            await db.execute('INSERT INTO cart (user_id, product_id, quantity) VALUES (?, ?, ?)', [userId, actualProductId, quantity]);
        }

        res.status(200).json({ success: true, message: 'Product added to cart successfully' });
    } catch (error) {
        console.error("Add to Cart Error:", error);
        res.status(500).json({ success: false, message: "Internal server error" });
    }
});

// ==================== 3. UPDATE QUANTITY API ====================
router.post('/api/cart/update-qty', isAuthenticated, async (req, res) => {
    try {
        const userId = req.user.id;
        const { cart_id, quantity } = req.body;

        if (!cart_id || quantity < 1) {
            return res.status(400).json({ success: false, message: 'Invalid request data' });
        }

        await db.execute('UPDATE cart SET quantity = ? WHERE id = ? AND user_id = ?', [quantity, cart_id, userId]);
        res.status(200).json({ success: true, message: 'Cart updated successfully' });
    } catch (error) {
        console.error("Update Cart Qty Error:", error);
        res.status(500).json({ success: false, message: "Internal server error" });
    }
});

// ==================== 4. REMOVE ITEM API ====================
router.delete('/api/cart/remove/:id', isAuthenticated, async (req, res) => {
    try {
        const cartId = req.params.id;
        const userId = req.user.id;

        await db.execute('DELETE FROM cart WHERE id = ? AND user_id = ?', [cartId, userId]);
        res.status(200).json({ success: true, message: 'Item removed from cart' });
    } catch (error) {
        console.error("Remove Cart Error:", error);
        res.status(500).json({ success: false, message: "Internal server error" });
    }
});

// ==================== 5. APPLY COUPON API ====================
router.post('/api/cart/apply-coupon', isAuthenticated, async (req, res) => {
    try {
        const { coupon_code } = req.body;
        if (!coupon_code) {
            return res.status(400).json({ success: false, message: 'কুপন কোড প্রদান করুন!' });
        }

        const [coupons] = await db.query('SELECT * FROM coupons WHERE coupon_name = ?', [coupon_code]);
        if (coupons.length === 0) {
            return res.json({ success: false, message: 'ভুল কুপন কোড!' });
        }

        const coupon = coupons[0];
        if (coupon.expiry_date && new Date() > new Date(coupon.expiry_date)) {
            return res.json({ success: false, message: 'এই কুপনটির মেয়াদ শেষ হয়ে গেছে!' });
        }

        return res.json({
            success: true,
            coupon_name: coupon.coupon_name,
            discount_amount: coupon.discount_amount,
            message: 'Coupon applied successfully!'
        });
    } catch (error) {
        console.error("Apply Coupon Error:", error);
        return res.status(500).json({ success: false, message: 'Server error!' });
    }
});

// ==================== 6. CHECKOUT / PLACE ORDER FROM CART ====================
router.post('/api/cart/place-order', isAuthenticated, async (req, res) => {
    try {
        const userId = req.user.id;
        const { 
            payment_method, selected_gateway, 
            name, email, phone, division, district, upazilla, union_area, post_code, block_house, 
            discount_amount = 0 
        } = req.body;

        if (!name || !phone || !district || !block_house) {
            return res.status(400).json({ success: false, message: 'প্রয়োজনীয় অর্ডারের তথ্য অনুপস্থিত!' });
        }

        const [cartItems] = await db.query(`
            SELECT c.*, p.sale_price, p.regular_price, p.stock_quantity, p.sold_qty, p.admin_id, p.delivery_charge, p.delivery_limit, p.free_shipping, p.cod_available
            FROM cart c 
            JOIN products p ON c.product_id = p.id 
            WHERE c.user_id = ?
        `, [userId]);

        if (!cartItems || cartItems.length === 0) {
            return res.status(400).json({ success: false, message: 'আপনার কার্ট খালি!' });
        }

        if (payment_method === 'cod') {
            const hasNonCodItem = cartItems.some(item => Number(item.cod_available) === 0);
            if (hasNonCodItem) {
                return res.status(400).json({ success: false, message: 'কার্টের কিছু আইটেমের জন্য ক্যাশ অন ডেলিভারি প্রযোজ্য নয়।' });
            }
        }

        for (const item of cartItems) {
            if (item.stock_quantity < item.quantity) {
                return res.status(400).json({ success: false, message: `স্টক সংকট! প্রোডাক্টের স্টক বর্তমানে ${item.stock_quantity} টি।` });
            }
        }

        let totalSubtotal = 0;
        let totalDeliveryCharge = 0;

        cartItems.forEach(item => {
            const price = item.sale_price > 0 ? parseFloat(item.sale_price) : parseFloat(item.regular_price);
            totalSubtotal += price * item.quantity;

            let baseDelivery = Number(item.delivery_charge) || 60;
            if (Number(item.free_shipping) === 1) baseDelivery = 0;

            let itemDelivery = baseDelivery;
            const limit = Number(item.delivery_limit) || 1;
            if (limit > 0 && baseDelivery > 0) {
                itemDelivery = baseDelivery * Math.ceil(item.quantity / limit);
            }
            totalDeliveryCharge += itemDelivery;
        });

        const appliedDiscount = parseFloat(discount_amount) || 0;
        const grandTotal = Math.max(0, totalSubtotal - appliedDiscount) + totalDeliveryCharge;

        const fullAddress = [block_house, union_area, upazilla, district, division, post_code ? `Post Code: ${post_code}` : ''].filter(Boolean).join(', ');
        const baseOrderId = 'NXK-' + Date.now().toString().slice(-8) + Math.floor(100 + Math.random() * 900);

        if (req.session) {
            req.session.pendingOrder = {
                baseOrderId, userId, cartItems, totalDeliveryCharge, grandTotal, payment_method, name, email, phone, fullAddress
            };
        }

        // -----------------------------------------------------------------
        // PAYSUITE PAYMENT GATEWAY HANDLER
        // -----------------------------------------------------------------
        if (payment_method === 'paysuite') {
            const paysuiteResult = await createPaySuitePayment({
                order_id: baseOrderId,
                name, email, phone, selected_gateway
            }, grandTotal);

            if (!paysuiteResult.success) {
                return res.status(400).json({ success: false, message: paysuiteResult.message || 'PaySuite পেমেন্ট গেটওয়ে কানেক্ট করতে ব্যর্থ হয়েছে।' });
            }

            return res.json({
                success: true,
                order_id: baseOrderId,
                payment_url: paysuiteResult.payment_url
            });
        }

        // -----------------------------------------------------------------
        // BDGATE PAYMENT GATEWAY HANDLER
        // -----------------------------------------------------------------
        if (payment_method === 'bdgate') {
            const bdgateResult = await createBDGatePayment({
                order_id: baseOrderId,
                name, email, phone, selected_gateway
            }, grandTotal);

            if (!bdgateResult.success) {
                return res.status(400).json({ success: false, message: bdgateResult.message || 'BDGate পেমেন্ট গেটওয়ে কানেক্ট করতে ব্যর্থ হয়েছে।' });
            }

            return res.json({
                success: true,
                order_id: baseOrderId,
                payment_url: bdgateResult.payment_url
            });
        }

        // -----------------------------------------------------------------
        // CASH ON DELIVERY (COD) HANDLER
        // -----------------------------------------------------------------
        for (let i = 0; i < cartItems.length; i++) {
            const item = cartItems[i];
            const itemPrice = item.sale_price > 0 ? parseFloat(item.sale_price) : parseFloat(item.regular_price);
            const itemSubtotal = itemPrice * item.quantity;
            const uniqueItemId = cartItems.length > 1 ? `${baseOrderId}-${i + 1}` : baseOrderId;

            await db.query(`
                INSERT INTO orders (
                    order_id, user_id, product_id, seller_id, quantity, 
                    subtotal_price, delivery_charge, total_amount, payment_method, 
                    selected_gateway, payment_status, order_status, customer_name, customer_email, 
                    customer_phone, shipping_address, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pending', 'Pending', ?, ?, ?, ?, NOW())
            `, [
                uniqueItemId, userId, item.product_id, item.admin_id || 0, item.quantity,
                itemSubtotal, totalDeliveryCharge, grandTotal, payment_method,
                'cod', name, email, phone, fullAddress
            ]);

            const newStock = Math.max(0, item.stock_quantity - item.quantity);
            const newSold = (parseInt(item.sold_qty) || 0) + item.quantity;
            const stockStatus = newStock === 0 ? 'out_of_stock' : 'in_stock';
            await db.query(`UPDATE products SET stock_quantity = ?, sold_qty = ?, stock_status = ? WHERE id = ?`, [newStock, newSold, stockStatus, item.product_id]);
        }

        await db.query('DELETE FROM cart WHERE user_id = ?', [userId]);

        return res.json({ success: true, order_id: baseOrderId, message: 'অর্ডার সফলভাবে সম্পন্ন হয়েছে!' });

    } catch (error) {
        console.error("Cart Place Order Error:", error);
        res.status(500).json({ success: false, message: "Server error during checkout" });
    }
});

// ==================== BDGate Callback Route ====================
router.all('/bdgate-callback', async (req, res) => {
    try {
        const status = req.body.status || req.query.status;

        if (status === 'success' || status === 'COMPLETED' || status === 'PAID') {
            const pendingOrder = req.session ? req.session.pendingOrder : null;

            if (pendingOrder) {
                const { baseOrderId, userId, cartItems, totalDeliveryCharge, grandTotal, payment_method, name, email, phone, fullAddress } = pendingOrder;

                for (let i = 0; i < cartItems.length; i++) {
                    const item = cartItems[i];
                    const itemPrice = item.sale_price > 0 ? parseFloat(item.sale_price) : parseFloat(item.regular_price);
                    const itemSubtotal = itemPrice * item.quantity;
                    const uniqueItemId = cartItems.length > 1 ? `${baseOrderId}-${i + 1}` : baseOrderId;

                    await db.query(`
                        INSERT INTO orders (
                            order_id, user_id, product_id, seller_id, quantity, 
                            subtotal_price, delivery_charge, total_amount, payment_method, 
                            selected_gateway, payment_status, order_status, customer_name, customer_email, 
                            customer_phone, shipping_address, created_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Paid', 'Processing', ?, ?, ?, ?, NOW())
                    `, [
                        uniqueItemId, userId, item.product_id, item.admin_id || 0, item.quantity,
                        itemSubtotal, totalDeliveryCharge, grandTotal, payment_method,
                        'bdgate', name, email, phone, fullAddress
                    ]);

                    const newStock = Math.max(0, item.stock_quantity - item.quantity);
                    const newSold = (parseInt(item.sold_qty) || 0) + item.quantity;
                    const stockStatus = newStock === 0 ? 'out_of_stock' : 'in_stock';
                    await db.query(`UPDATE products SET stock_quantity = ?, sold_qty = ?, stock_status = ? WHERE id = ?`, [newStock, newSold, stockStatus, item.product_id]);
                }

                await db.query('DELETE FROM cart WHERE user_id = ?', [userId]);
                delete req.session.pendingOrder;
            }

            return res.redirect('/user/dashboard?payment=success');
        } else {
            if (req.session) delete req.session.pendingOrder;
            return res.redirect('/user/dashboard?payment=failed');
        }
    } catch (error) {
        console.error("BDGate Callback Error:", error);
        return res.status(500).send("Internal Server Error");
    }
});

module.exports = router;