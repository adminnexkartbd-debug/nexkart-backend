const express = require('express');
const router = express.Router();
const path = require('path');

// 💡 ডাটাবেজ ফাইল ইমপোর্ট
const db = require('../../db');
const tracking17 = require('../users/tracking17');
const statusMail = require('../../services/orderStatusMail');
const steadfast = require('../../services/steadfastService'); 

// ==========================================
// ১. AUTHENTICATION MIDDLEWARE
// ==========================================
function ensureActiveSeller(req, res, next) {
    if (req.isAuthenticated && req.isAuthenticated()) {
        return next();
    }
    if (req.session && (req.session.admin || req.session.user)) {
        req.user = req.session.admin || req.session.user;
        return next();
    }
    return res.status(401).json({ success: false, message: "দয়া করে প্রথমে সেলার লগইন করুন।" });
}

// ==========================================
// ৫. API Route: Update Tracking Number
// ==========================================
router.post('/api/update-tracking', ensureActiveSeller, async (req, res) => {
    try {
        const { order_id } = req.body;
        const provider = req.body.provider || '17track';
        if (!['17track','steadfast','manual'].includes(provider)) return res.status(400).json({success:false,message:'Invalid courier provider'});
        const tracking_number = String(req.body.tracking_number || '').trim();
        if (!/^[A-Za-z0-9-]{5,50}$/.test(tracking_number)) return res.status(400).json({success:false,message:'Tracking number must contain 5–50 letters, numbers or hyphens.'});
        const currentSellerId = req.user ? (req.user.id || req.user.admin_id) : null;

        const updateQuery = `UPDATE orders SET tracking_number = ? WHERE order_id = ? AND seller_id = ?`;
        const [result] = await db.query(updateQuery, [tracking_number, order_id, Number(currentSellerId)]);

        if (result.affectedRows > 0) {
            await db.query(`INSERT INTO order_tracking17 (order_id,tracking_number,provider) VALUES (?,?,?)
                ON DUPLICATE KEY UPDATE auto_sync=IF(tracking_number=VALUES(tracking_number) AND provider=VALUES(provider),auto_sync,1),
                event_time=IF(tracking_number=VALUES(tracking_number) AND provider=VALUES(provider),event_time,NULL),
                courier_status=IF(tracking_number=VALUES(tracking_number) AND provider=VALUES(provider),courier_status,NULL),
                courier_detail=IF(tracking_number=VALUES(tracking_number) AND provider=VALUES(provider),courier_detail,NULL),
                registered=0,consignment_id=NULL,last_checked=NULL,sync_error=NULL,
                tracking_number=VALUES(tracking_number),provider=VALUES(provider)`, [order_id,tracking_number,provider]);
            if(provider==='manual') await db.query('UPDATE order_tracking17 SET auto_sync=0 WHERE order_id=?',[order_id]);
            let message='Tracking number saved.';
            try {
                if(provider==='17track') {await tracking17.register(order_id,tracking_number);message+=' Registered with 17TRACK.';}
                if(provider==='steadfast') {await steadfast.sync(order_id);message+=' Steadfast status checked.';}
            } catch(e) {
                await db.query('UPDATE order_tracking17 SET sync_error=? WHERE order_id=? AND tracking_number=?',[e.message.slice(0,500),order_id,tracking_number]);
                message+=' Auto tracking could not start: '+e.message;
            }
            return res.json({success:true,message});
        } else {
            return res.status(403).json({ success: false, message: 'অনুমতি নেই অথবা অর্ডারটি পাওয়া যায়নি।' });
        }
    } catch (error) {
        console.error('Error updating tracking number:', error);
        return res.status(500).json({ success: false, message: 'ট্র্যাকিং নম্বর আপডেট করতে সমস্যা হয়েছে।' });
    }
});
// ==========================================
// ২. HTML Page Render Route
// ==========================================
router.get('/', ensureActiveSeller, (req, res) => {
    res.sendFile(path.join(__dirname, '../../public/admin/order-lists.html'));
});

// ==========================================
// ৩. API Route: Fetch Orders with Product & Seller Info
// ==========================================
router.get('/api/get-orders', ensureActiveSeller, async (req, res) => {
    try {
        const currentSellerId = req.user ? (req.user.id || req.user.admin_id) : null;

        console.log("👉 Current Logged-in Seller ID:", currentSellerId);

        if (!currentSellerId) {
            return res.status(400).json({ 
                success: false, 
                message: "সেলার আইডি পাওয়া যায়নি। অনুগ্রহ করে আবার লগইন করুন।" 
            });
        }

        // 🔥 SQL QUERY: orders.seller_id == admins.id
        // products এবং admins উভয় টেবিলের ডাটা সঠিকভাবে আনার জন্য JOIN করা হয়েছে
        const sqlQuery = `
            SELECT 
                orders.*,
                products.title AS product_name,
                admins.shop_name AS seller_shop_name,
                admins.phone AS seller_phone,
                admins.address AS seller_address
            FROM orders 
            LEFT JOIN products ON orders.product_id = products.id 
            LEFT JOIN admins ON orders.seller_id = admins.id
            WHERE orders.seller_id = ? 
            ORDER BY orders.created_at DESC
        `;
        
        const [orders] = await db.query(sqlQuery, [Number(currentSellerId)]);

        // Tracking enrichment must never prevent the original order list from loading.
        let trackingWarning = null;
        if (orders.length) {
            try {
                const trackingByOrder = new Map();
                for (let start=0; start<orders.length; start+=200) {
                    const ids=orders.slice(start,start+200).map(o=>String(o.order_id));
                    const [trackingRows]=await db.query(
                        `SELECT * FROM order_tracking17 WHERE order_id IN (${ids.map(()=>'?').join(',')})`,ids);
                    for(const row of trackingRows) trackingByOrder.set(String(row.order_id),row);
                }
                for(const order of orders) {
                    const t=trackingByOrder.get(String(order.order_id));
                    if(t) Object.assign(order,{
                        tracking_provider:t.provider || '17track',auto_sync:t.auto_sync,
                        courier_status:t.courier_status,courier_detail:t.courier_detail,
                        sync_error:t.sync_error
                    });
                }
            } catch(trackingError) {
                trackingWarning='Tracking information is temporarily unavailable. Orders are still available.';
                console.warn('Optional tracking enrichment failed:',trackingError.code || trackingError.message);
            }
        }
        console.log(`✅ Seller (${currentSellerId}) - Total Orders Found:`, orders.length);

        return res.status(200).json({
            success: true,
            sellerId: currentSellerId,
            totalOrders: orders.length,
            trackingWarning,
            data: orders
        });

    } catch (error) {
        console.error('❌ Database Query Error:', error);
        return res.status(500).json({ 
            success: false, 
            message: 'ডাটাবেজ থেকে অর্ডার ডাটা ফেচ করতে সমস্যা হয়েছে।' 
        });
    }
});

// ==========================================
// ৪. API Route: Update Order Status
// ==========================================
router.post('/api/update-status', ensureActiveSeller, async (req, res) => {
    try {
        const { order_id, order_status } = req.body;
        if (!['pending','processing','shipped','delivered','cancelled'].includes(order_status)) return res.status(400).json({success:false,message:'Invalid order status'});
        const currentSellerId = req.user ? (req.user.id || req.user.admin_id) : null;

        const [before] = await db.query('SELECT order_status FROM orders WHERE order_id=? AND seller_id=?',[order_id,Number(currentSellerId)]);
        const updateQuery = `UPDATE orders o LEFT JOIN order_tracking17 t ON BINARY t.order_id=BINARY o.order_id SET o.order_status = ?, t.auto_sync=0 WHERE o.order_id = ? AND o.seller_id = ?`;
        const [result] = await db.query(updateQuery, [order_status, order_id, Number(currentSellerId)]);

        if (result.affectedRows > 0) {
            if (before.length && before[0].order_status !== order_status) await statusMail.enqueue(order_id,order_status);
            return res.json({ success: true, message: 'অর্ডার স্ট্যাটাস আপডেট হয়েছে।' });
        } else {
            return res.status(403).json({ success: false, message: 'অনুমতি নেই অথবা অর্ডারটি পাওয়া যায়নি।' });
        }
    } catch (error) {
        console.error('Error updating status:', error);
        return res.status(500).json({ success: false, message: 'স্ট্যাটাস আপডেট করতে সমস্যা হয়েছে।' });
    }
});

router.post('/api/tracking-auto', ensureActiveSeller, async(req,res)=>{
    try {
        const seller=Number(req.user.id || req.user.admin_id);
        const [rows]=await db.query('SELECT o.order_id,o.tracking_number,t.provider FROM orders o JOIN order_tracking17 t ON BINARY t.order_id=BINARY o.order_id WHERE o.order_id=? AND o.seller_id=?',[req.body.order_id,seller]);
        if (!rows.length) return res.sendStatus(404);
        if(rows[0].provider==='17track') await tracking17.register(rows[0].order_id, rows[0].tracking_number);
        if(rows[0].provider==='manual') throw new Error('Select an automatic provider first');
        await db.query('UPDATE order_tracking17 SET auto_sync=1 WHERE order_id=?',[rows[0].order_id]);
        res.json({success:true,message:'Auto Sync enabled. The next courier update will update the order.'});
    } catch(e) {res.status(400).json({success:false,message:e.message});}
});
router.post('/api/steadfast-create',ensureActiveSeller,async(req,res)=>{
    try {
        const [rows]=await db.query('SELECT * FROM orders WHERE order_id=? AND seller_id=?',[req.body.order_id,Number(req.user.id || req.user.admin_id)]);
        if(!rows.length)return res.sendStatus(404);
        const order=rows[0];
        if(order.tracking_number)throw new Error('This order already has a tracking number.');
        if(req.body.cod_amount===undefined || req.body.cod_amount==='')throw new Error('Confirm the COD amount first.');
        const parcel=await steadfast.create(order,Number(req.body.cod_amount));
        res.json({success:true,message:'Steadfast parcel created. Tracking: '+parcel.tracking_code});
    }catch(e){res.status(400).json({success:false,message:e.message});}
});
router.post('/api/tracking-check',ensureActiveSeller,async(req,res)=>{
    try {
        const [rows]=await db.query("SELECT t.* FROM order_tracking17 t JOIN orders o ON o.order_id=t.order_id WHERE t.order_id=? AND o.seller_id=?",[req.body.order_id,Number(req.user.id || req.user.admin_id)]);
        if(!rows.length)return res.sendStatus(404);
        if(rows[0].provider==='steadfast')await steadfast.sync(rows[0].order_id);
        else if(rows[0].provider==='17track')await tracking17.register(rows[0].order_id,rows[0].tracking_number);
        res.json({success:true,message:rows[0].provider==='17track'?'Registration checked. Updates arrive via webhook.':'Tracking checked.'});
    }catch(e){res.status(400).json({success:false,message:e.message});}
});
module.exports = router;