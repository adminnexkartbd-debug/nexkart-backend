const express = require('express');
const router = express.Router();
const path = require('path');
const db = require('../../db'); 

// ==========================================
// ১. কুপন ক্রিয়েট পেজ রাউট
// ==========================================
router.get('/create-coupon.html', ensureActiveAdmin, (req, res) => {
    res.sendFile(path.join(__dirname, '../../public/admin/create-coupon.html'));
});

// ==========================================
// ২. মোট প্রোডাক্ট কাউন্ট করার রাউট
// ==========================================
router.get('/api/stats/total_products', ensureActiveAdmin, async (req, res) => {
  try {
    const adminId = req.user ? req.user.id : null;
    if (!adminId) {
      return res.status(401).json({ success: false, message: "Unauthorized!" });
    }

    const query = `SELECT COUNT(*) AS total FROM products WHERE admin_id = ?`;
    const [results] = await db.query(query, [adminId]);
    
    return res.status(200).json({ success: true, total: results[0].total || 0 });
  } catch (err) {
    console.error('Total Products Count Error:', err);
    return res.status(500).json({ success: false, message: "সার্ভার এরর!" });
  }
});

// ==========================================
// ৩. অ্যাক্টিভ প্রোডাক্ট কাউন্ট করার রাউট
// ==========================================
router.get('/api/stats/active_products', ensureActiveAdmin, async (req, res) => {
  try {
    const adminId = req.user ? req.user.id : null;
    if (!adminId) {
      return res.status(401).json({ success: false, message: "Unauthorized!" });
    }

    const query = `SELECT COUNT(*) AS total_active FROM products WHERE admin_id = ? AND LOWER(stock_status) = 'in_stock'`;
    const [results] = await db.query(query, [adminId]);
    
    const activeCount = results[0].total_active || 0;
    return res.status(200).json({ success: true, total: activeCount });

  } catch (err) {
    console.error('Active Products Count Error:', err);
    return res.status(500).json({ success: false, message: "সার্ভার এরর!" });
  }
});

// ==========================================
// ৪. মিডলওয়্যার: Active Admin Check
// ==========================================
async function ensureActiveAdmin(req, res, next) {
    if (req.isAuthenticated()) {
        try {
            const adminId = req.user.id || req.user.admin_id;
            const [rows] = await db.query('SELECT status, action FROM admins WHERE id = ?', [adminId]);
            
            if (rows.length === 0) {
                return res.status(401).json({ success: false, message: "ইউজার পাওয়া যায়নি।" });
            }

            const userStatus = rows[0].status ? rows[0].status.toLowerCase() : '';
            const userAction = rows[0].action ? rows[0].action.toLowerCase() : '';

            if (userStatus === 'approved') {
                if (userAction === 'active' || userAction === 'warning') {
                    return next();
                } else if (userAction === 'suspend' || userAction === 'suspended') {
                    req.logout(() => {});
                    return res.status(403).json({ success: false, message: "আপনার অ্যাকাউন্টটি সাসপেন্ড করা হয়েছে!" });
                } else {
                    return res.status(403).json({ success: false, message: "আপনার অ্যাকাউন্টটি সক্রিয় নয়!" });
                }
            } else {
                return res.status(403).json({ success: false, message: "আপনার অ্যাকাউন্টটি এখনো অ্যাপ্রুভ হয়নি!" });
            }
        } catch (err) {
            console.error("Auth Middleware Error:", err);
            return res.status(500).json({ success: false, message: "সার্ভার এরর!" });
        }
    }
    res.status(401).json({ success: false, message: "দয়া করে প্রথমে লগইন করুন।" });
}

// ==========================================
// pending-count/:seller_id রাউট
// ==========================================
router.get('/pending-count/:seller_id', async (req, res) => {
    try {
        const { seller_id } = req.params;
        const query = `
            SELECT COUNT(*) as total_pending 
            FROM seller_messages 
            WHERE seller_id = ? AND sender_type = 'customer' AND status = 'Pending'
        `;
        const [result] = await db.query(query, [seller_id]);
        res.status(200).json({ success: true, pendingCount: result[0].total_pending || 0 });
    } catch (error) {
        console.error("Pending Count Error:", error);
        res.status(500).json({ success: false, message: 'Server Error' });
    }
});

// ==========================================
// ৫. সেশন চেক রাউট
// ==========================================
router.get('/check-session', (req, res) => {
    if (req.isAuthenticated()) {
        const userStatus = req.user.status ? req.user.status.toLowerCase() : '';
        const userAction = req.user.action ? req.user.action.toLowerCase() : '';

        if (userStatus === 'approved' && (userAction === 'active' || userAction === 'warning')) {
            return res.json({ loggedIn: true, user: req.user });
        }
    }
    res.json({ loggedIn: false });
});

// ==========================================
// ৬. কারেন্ট ইউজার ডাটা (DB থেকে আসল super_admin ও status সহ)
// ==========================================
router.get('/current_user', async (req, res) => {
    if (req.isAuthenticated()) {
        try {
            const adminId = req.user.id || req.user.admin_id;
            const [rows] = await db.query('SELECT * FROM admins WHERE id = ?', [adminId]);
            if (rows.length > 0) {
                return res.json(rows[0]);
            }
            res.json(req.user);
        } catch (error) {
            res.json(req.user);
        }
    } else {
        res.status(401).json({ success: false, message: "Unauthorized" });
    }
});

// ==========================================
// ৭. মোট ইউজার কাউন্ট করার API
// ==========================================
router.get('/api/stats/total_users', ensureActiveAdmin, async (req, res) => {
  try {
    const [rows] = await db.query('SELECT COUNT(id) AS total FROM users');
    return res.status(200).json({ success: true, total: rows[0].total || 0 });
  } catch (error) {
    console.error('Total Users Count Error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
});

// ==========================================
// ৮. অর্ডার পরিসংখ্যান API
// ==========================================
router.get('/api/stats/order_stats', ensureActiveAdmin, async (req, res) => {
  try {
    const adminId = req.user ? (req.user.id || req.user.admin_id) : null;
    if (!adminId) {
      return res.status(401).json({ success: false, message: "Unauthorized!" });
    }

    const [totalRes] = await db.query(
      `SELECT COUNT(*) AS total FROM orders WHERE seller_id = ?`, 
      [Number(adminId)]
    );

    const [pendingRes] = await db.query(
      `SELECT COUNT(*) AS pending FROM orders WHERE seller_id = ? AND LOWER(order_status) IN ('pending', 'processing')`, 
      [Number(adminId)]
    );

    const [completeRes] = await db.query(
      `SELECT COUNT(*) AS completed FROM orders WHERE seller_id = ? AND LOWER(order_status) = 'delivered'`, 
      [Number(adminId)]
    );

    return res.status(200).json({
      success: true,
      totalOrders: totalRes[0].total || 0,
      pendingOrders: pendingRes[0].pending || 0,
      completedOrders: completeRes[0].completed || 0
    });

  } catch (err) {
    console.error('Order Stats Fetch Error:', err);
    return res.status(500).json({ success: false, message: "সার্ভার এরর!" });
  }
});

// ==========================================
// ৯. সেলারের নিজস্ব প্রোডাক্ট ফেচ করার API
// ==========================================
router.get('/api/seller-products', ensureActiveAdmin, async (req, res) => {
  try {
    const adminId = req.user ? (req.user.id || req.user.admin_id) : null; 

    if (!adminId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const [products] = await db.query(
      'SELECT id, title, sale_price, regular_price, sold_qty FROM products WHERE admin_id = ? ORDER BY sold_qty DESC',
      [Number(adminId)]
    );

    res.status(200).json({
      success: true,
      products: products
    });
  } catch (error) {
    console.error('API Error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ==========================================
// ১০. মিডলওয়্যার: Super Admin Check
// ==========================================
function ensureSuperAdmin(req, res, next) {
    if (req.isAuthenticated()) {
        if (req.user.super_admin === 'approved') {
            return next();
        } else {
            return res.status(403).send("<h1>You can't see this</h1>");
        }
    }
    res.redirect('/login');
}

// ==========================================
// ১১. পেন্ডিং রিটার্ন/রিফান্ড রিকোয়েস্ট কাউন্ট API
// ==========================================
router.get('/api/stats/pending_return_requests', ensureActiveAdmin, async (req, res) => {
  try {
    const adminId = req.user ? (req.user.id || req.user.admin_id) : null;
    if (!adminId) {
      return res.status(401).json({ success: false, message: "Unauthorized!" });
    }

    const query = `
      SELECT COUNT(*) AS pending_count 
      FROM order_returns 
      WHERE seller_id = ? AND LOWER(status) = 'pending'
    `;
    const [results] = await db.query(query, [adminId]);

    return res.status(200).json({
      success: true,
      pendingCount: results[0].pending_count || 0
    });
  } catch (error) {
    console.error('Pending Return Count Error:', error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

// ==========================================
// ১২. স্টক আউট প্রোডাক্টের তালিকা ও কাউন্ট API
// ==========================================
router.get('/api/stats/out_of_stock_products', ensureActiveAdmin, async (req, res) => {
  try {
    const adminId = req.user ? (req.user.id || req.user.admin_id) : null;
    if (!adminId) {
      return res.status(401).json({ success: false, message: "Unauthorized!" });
    }

    const query = `
      SELECT id, product_id, title, stock_quantity, products_variant 
      FROM products 
      WHERE admin_id = ? AND (stock_quantity IS NULL OR stock_quantity <= 0)
    `;
    const [products] = await db.query(query, [adminId]);

    return res.status(200).json({
      success: true,
      count: products.length,
      products: products
    });
  } catch (err) {
    console.error('Stock Alert Products Error:', err);
    return res.status(500).json({ success: false, message: "সার্ভার এরর!" });
  }
});

// ==========================================
// ১৩. পেন্ডিং রিভিউ সংখ্যা ফেচ করা API
// ==========================================
router.get('/api/admin/reviews/pending-count', ensureActiveAdmin, async (req, res) => {
    try {
        const adminId = req.user ? (req.user.id || req.user.admin_id) : null;

        if (!adminId) {
            return res.status(401).json({ success: false, message: 'Unauthorized! Admin ID পাওয়া যায়নি।' });
        }

        const query = `
            SELECT COUNT(*) AS pending_count
            FROM product_reviews pr
            INNER JOIN products p ON pr.product_id = p.id
            WHERE p.admin_id = ? AND (pr.review_reply IS NULL OR pr.review_reply = '' OR pr.review_reply = 'NULL')
        `;

        const [results] = await db.query(query, [adminId]);

        return res.status(200).json({
            success: true,
            pendingCount: results[0].pending_count || 0
        });
    } catch (error) {
        console.error('Error fetching pending review count:', error);
        return res.status(500).json({ success: false, message: 'Server error' });
    }
});

// ==========================================
// ১৩.খ. SITE VISITORS API (FIXED WITH SUPER_ADMIN APPROVAL CHECK)
// ==========================================
router.get('/api/admin-inbox/site-visitors', async (req, res) => {
    try {
        if (!req.isAuthenticated() || req.user.super_admin !== 'approved') {
            return res.status(403).json({ 
                success: false, 
                message: "Can't see site visitors. Super admin approval required." 
            });
        }

        const { filter } = req.query;
        let query = 'SELECT * FROM site_visits ORDER BY last_visited_at DESC';
        
        if (filter === 'today') {
            query = 'SELECT * FROM site_visits WHERE DATE(last_visited_at) = CURDATE() ORDER BY last_visited_at DESC';
        }

        const [visitors] = await db.query(query);

        return res.status(200).json({ 
            success: true, 
            visitorCount: visitors.length,
            visitors: visitors
        });
    } catch (error) {
        console.error("Site visitor fetch error:", error);
        return res.status(500).json({ 
            success: false, 
            message: "Database Error",
            error: error.message 
        });
    }
});

// ==========================================
// ১৪. সকল অ্যাডমিন HTML ফাইল পেজ রাউটস
// ==========================================
router.get('/home.html', ensureActiveAdmin, (req, res) => {
    res.sendFile(path.join(__dirname, '../../public/admin/home.html'));
});

router.get('/admin-inbox.html', ensureActiveAdmin, (req, res) => {
    res.sendFile(path.join(__dirname, '../../public/admin/admin-inbox.html'));
});

router.get('/admin-inquiry.html', ensureActiveAdmin, (req, res) => {
    res.sendFile(path.join(__dirname, '../../public/admin/admin-inquiry.html'));
});

router.get('/order-lists.html', ensureActiveAdmin, (req, res) => {
    res.sendFile(path.join(__dirname, '../../public/admin/order-lists.html'));
});

router.get('/admin-review.html', ensureActiveAdmin, (req, res) => {
    res.sendFile(path.join(__dirname, '../../public/admin/admin-review.html'));
});

router.get('/verify-documents.html', ensureActiveAdmin, (req, res) => {
    res.sendFile(path.join(__dirname, '../../public/admin/verify-documents.html'));
});

// ==========================================
// ১৫. সুপার অ্যাডমিন HTML ফাইল পেজ রাউটস
// ==========================================
router.get('/superAdmin.html', ensureSuperAdmin, (req, res) => {
    res.sendFile(path.join(__dirname, '../../public/admin/superAdmin.html'));
});

router.get('/withdraw.html', ensureSuperAdmin, (req, res) => {
    res.sendFile(path.join(__dirname, '../../public/admin/withdraw.html'));
});

router.get('/Return-RefundAdmin.html', ensureSuperAdmin, (req, res) => {
    res.sendFile(path.join(__dirname, '../../public/admin/Return-RefundAdmin.html'));
});

router.get('/adminAbout.html', ensureSuperAdmin, (req, res) => {
    res.sendFile(path.join(__dirname, '../../public/admin/adminAbout.html'));
});

module.exports = router;