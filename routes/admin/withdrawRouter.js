const express = require('express');
const router = express.Router();
const db = require('../../db');
const { sendWithdrawEmail } = require('../../services/withdrawmail'); 

function ensureActiveAdmin(req, res, next) {
    if (req.isAuthenticated() && req.user.status === 'approved') {
        return next();
    }
    res.status(401).json({ success: false, message: "Unauthorized or Account not approved!" });
}

// উইথড্র ইনফো এবং ইউজারের নাম ও প্রফাইল ফেচ করার API
router.get('/api/withdraw/info', ensureActiveAdmin, async (req, res) => {
  try {
    const adminId = req.user.id || req.user.admin_id;

    const [rows] = await db.query(
      `SELECT id, name, email, picture, total_sales, total_withdraw, payment_type, mobile_number, 
              bank_acc_name, bank_acc_number, bank_name, bank_branch, routing_number 
       FROM admins WHERE id = ?`, 
      [adminId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: "User not found!" });
    }

    const admin = rows[0];
    const totalSales = Number(admin.total_sales || 0);
    const totalWithdrawn = Number(admin.total_withdraw || 0);
    const availableBalance = totalSales - totalWithdrawn;

    return res.status(200).json({
      success: true,
      balanceInfo: {
        availableBalance: availableBalance > 0 ? availableBalance : 0,
        totalWithdrawn: totalWithdrawn,
        totalSales: totalSales
      },
      paymentDetails: {
        name: admin.name || 'Admin',
        picture: admin.picture || '',
        payment_type: admin.payment_type || '',
        mobile_number: admin.mobile_number || '',
        bank_acc_name: admin.bank_acc_name || '',
        bank_acc_number: admin.bank_acc_number || '',
        bank_name: admin.bank_name || '',
        bank_branch: admin.bank_branch || '',
        routing_number: admin.routing_number || ''
      }
    });

  } catch (err) {
    console.error('Withdraw Info Fetch Error:', err);
    return res.status(500).json({ success: false, message: "Server error!" });
  }
});

// উইথড্র রিকোয়েস্ট সাবমিট এবং withdraw_request টেবিলে ডেটা সেভ করার API
router.post('/api/withdraw/submit', ensureActiveAdmin, async (req, res) => {
  try {
    const adminId = req.user.id || req.user.admin_id;
    const { amount, payment_type, mobile_number, bank_acc_name, bank_acc_number, bank_name, bank_branch, routing_number } = req.body;

    // ১. সর্বনিম্ন ১০০০ টাকা চেক
    if (!amount || amount < 1000) {
      return res.status(400).json({ success: false, message: "সর্বনিম্ন ১০০০ টাকা উত্তোলন করতে হবে!" });
    }

    // ২. admins টেবিল থেকে ইউজারের বর্তমান ব্যালেন্স, নাম, ইমেইল ও প্রোফাইল ছবি আনা
    const [rows] = await db.query(`SELECT name, email, picture, total_sales, total_withdraw FROM admins WHERE id = ?`, [adminId]);
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: "User not found!" });
    }

    const user = rows[0];
    const availableBalance = Number(user.total_sales || 0) - Number(user.total_withdraw || 0);

    if (amount > availableBalance) {
      return res.status(400).json({ success: false, message: "আপনার অ্যাকাউন্টে পর্যাপ্ত এভেলেবল ব্যালেন্স নেই!" });
    }

    // ৩. ইউনিক ট্রানজেকশন আইডি জেনারেট করা
    const transactionId = 'TRX-' + Date.now() + '-' + Math.floor(Math.random() * 1000);

    // ৪. admins টেবিলে ইউজারের পেমেন্ট মেথড ও ইনফো আপডেট করে রাখা
    if (payment_type === 'bank') {
      await db.query(
        `UPDATE admins SET payment_type = ?, bank_acc_name = ?, bank_acc_number = ?, bank_name = ?, bank_branch = ?, routing_number = ? WHERE id = ?`,
        [payment_type, bank_acc_name || null, bank_acc_number || null, bank_name || null, bank_branch || null, routing_number || null, adminId]
      );
    } else {
      await db.query(
        `UPDATE admins SET payment_type = ?, mobile_number = ? WHERE id = ?`,
        [payment_type, mobile_number || null, adminId]
      );
    }

    // ৫. withdraw_request টেবিলে সমস্ত ডেটা সঠিকভাবে ইনসার্ট করা
    await db.query(
      `INSERT INTO withdraw_request 
      (admin_id, user_name, user_profile, amount, payment_type, mobile_number, bank_acc_name, bank_acc_number, bank_name, bank_branch, routing_number, transaction_id, status) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
      [
        adminId, 
        user.name || 'N/A', 
        user.picture || '', 
        amount, 
        payment_type, 
        mobile_number || null, 
        bank_acc_name || null, 
        bank_acc_number || null, 
        bank_name || null, 
        bank_branch || null, 
        routing_number || null, 
        transactionId
      ]
    );

    // ৬. admins টেবিলে total_withdraw আপডেট করা
    await db.query(`UPDATE admins SET total_withdraw = total_withdraw + ? WHERE id = ?`, [amount, adminId]);

    // ৭. উইথড্র সফলভাবে সম্পন্ন হওয়ার পর ট্রানজেকশন আইডি সহ এডমিনের ইমেইলে নোটিফিকেশন পাঠানো[cite: 1, 3]
    if (user.email) {
      await sendWithdrawEmail(user.email, {
        userName: user.name || 'Admin',
        amount: amount,
        paymentType: payment_type,
        transactionId: transactionId
      });
    }

    return res.status(200).json({
      success: true,
      message: "উত্তোলনের অনুরোধ সফলভাবে জমা হয়েছে এবং ইমেইল পাঠানো হয়েছে!",
      transactionId: transactionId
    });

  } catch (err) {
    console.error('Withdraw Submit Error:', err);
    return res.status(500).json({ success: false, message: "Server error!" });
  }
});

// লগইন করা ইউজারের নিজস্ব উইথড্র রিকোয়েস্ট লিস্ট দেখার API
router.get('/api/withdraw/history', ensureActiveAdmin, async (req, res) => {
    try {
        const adminId = req.user.id || req.user.admin_id;

        // শুধু ওই এডমিনের ডাটা ফিল্টার করে আনা হচ্ছে
        const [rows] = await db.query(
            `SELECT * FROM withdraw_request WHERE admin_id = ? ORDER BY created_at DESC`, 
            [adminId]
        );

        return res.status(200).json({ success: true, data: rows });
    } catch (err) {
        console.error('Fetch History Error:', err);
        return res.status(500).json({ success: false, message: "Server error!" });
    }
});

module.exports = router;