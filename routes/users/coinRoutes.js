const express = require('express');
const router = express.Router();
const db = require('../../db'); // আপনার MySQL Connection Pool

// ১. ইউজারের মোট কয়েন ব্যালেন্স এবং হিস্ট্রি পাওয়া (GET /api/coins/balance)
router.get('/balance', async (req, res) => {
  const userId = req.user.id; // Authentication Middleware থেকে প্রাপ্ত ID

  try {
    // অ্যাক্টিভ ও মেয়াদের ভেতর থাকা কয়েন যোগ করা
    const [balanceResult] = await db.query(
      `SELECT SUM(earning_coin) AS total_coins 
       FROM users_coins 
       WHERE user_id = ? 
         AND refer_status = 'completed' 
         AND (expire_date IS NULL OR expire_date > NOW())`,
      [userId]
    );

    // লেনদেনের হিস্ট্রি রিট্রিভ
    const [history] = await db.query(
      `SELECT id, refer_number, refer_status, earning_coin, coin_date, expire_date 
       FROM users_coins 
       WHERE user_id = ? 
       ORDER BY coin_date DESC LIMIT 10`,
      [userId]
    );

    const totalCoins = balanceResult[0].total_coins || 0;

    res.status(200).json({
      success: true,
      total_coins: totalCoins,
      equivalent_bdt: (totalCoins * 0.1).toFixed(2), // ১ কয়েন = ৳০.১০
      history: history
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ২. রেফারেল কোড রিডিম করা (POST /api/coins/redeem)
router.post('/redeem', async (req, res) => {
  const userId = req.user.id;
  const { refer_number } = req.body;

  if (!refer_number) {
    return res.status(400).json({ success: false, message: 'রেফারেল কোডটি প্রদান করুন।' });
  }

  try {
    // ইউজার কি নিজের কোড বসাচ্ছে কিনা তা চেক
    const [ownCodeCheck] = await db.query(
      `SELECT id FROM users_coins WHERE user_id = ? AND refer_number = ?`,
      [userId, refer_number]
    );

    if (ownCodeCheck.length > 0) {
      return res.status(400).json({ success: false, message: 'নিজের রেফারেল কোড ব্যবহার করা সম্ভব নয়।' });
    }

    // কোডটি ইতিমধ্যে রিডিম করা হয়েছে কিনা চেক
    const [alreadyUsed] = await db.query(
      `SELECT id FROM users_coins WHERE user_id = ? AND refer_number = ? AND refer_status = 'completed'`,
      [userId, refer_number]
    );

    if (alreadyUsed.length > 0) {
      return res.status(400).json({ success: false, message: 'আপনি এই রেফারেল কোডটি আগেই ব্যবহার করেছেন।' });
    }

    // ১ বছর মেয়াদের কয়েন যোগ করা
    const expireDate = new Date();
    expireDate.setFullYear(expireDate.getFullYear() + 1);

    await db.query(
      `INSERT INTO users_coins (user_id, refer_number, refer_status, earning_coin, expire_date) 
       VALUES (?, ?, 'completed', 50, ?)`,
      [userId, refer_number, expireDate]
    );

    res.status(200).json({
      success: true,
      message: 'রেফারেল কোড সফলভাবে রিডিম করা হয়েছে! +৫০ কয়েন যোগ হয়েছে।'
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ৩. কেনাকাটায় কয়েন রিডিম/ব্যবহার করা (POST /api/coins/use)
router.post('/use', async (req, res) => {
  const userId = req.user.id;
  const { coins_to_use } = req.body;

  try {
    const [balanceResult] = await db.query(
      `SELECT SUM(earning_coin) AS total_coins 
       FROM users_coins 
       WHERE user_id = ? 
         AND refer_status = 'completed' 
         AND (expire_date IS NULL OR expire_date > NOW())`,
      [userId]
    );

    const totalCoins = balanceResult[0].total_coins || 0;

    if (coins_to_use > totalCoins) {
      return res.status(400).json({ success: false, message: 'পর্যাপ্ত কয়েন ব্যালেন্স নেই।' });
    }

    // কয়েন কাটার জন্য মাইনাস (-) ভ্যালু এন্ট্রি করা
    await db.query(
      `INSERT INTO users_coins (user_id, refer_status, earning_coin) 
       VALUES (?, 'completed', ?)`,
      [userId, -Math.abs(coins_to_use)]
    );

    res.status(200).json({
      success: true,
      message: `${coins_to_use} কয়েন সফলভাবে ব্যবহার করা হয়েছে।`,
      discount_bdt: (coins_to_use * 0.1).toFixed(2)
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;