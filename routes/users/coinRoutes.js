// routes/users/coinRoutes.js
const express = require('express');
const router = express.Router();
const cron = require('node-cron');
const db = require('../../db');
const { checkAndAddSignupCoins } = require('../../services/coinService');

// ক্রন জব (প্রতিদিন রান হবে)
cron.schedule('* * * * *', async () => {
  console.log('[Coin Cron] Running automatic coin & expiration check...');
  try {
    await checkAndAddSignupCoins();
  } catch (error) {
    console.error('[Coin Cron Error]:', error);
  }
});

// ম্যানুয়ালি টেস্ট করার রাউট
router.get('/check-coins', async (res) => {
  try {
    await checkAndAddSignupCoins();
    res.status(200).json({ success: true, message: 'Coin expiration and signup bonus processed successfully!' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// বর্তমান লগইন করা ইউজারের আইডি পাওয়ার API
router.get('/current-user', (req, res) => {
  // আপনার প্রজেক্টের সেশন স্ট্রাকচার অনুযায়ী (যেমন: req.session.userId)
  const loggedInUserId = req.session && req.session.userId ? req.session.userId : null;
  
  if (!loggedInUserId) {
    // ভুল ছিল: return.status(...) 
    // সঠিক হলো: return res.status(...)
    return res.status(401).json({ success: false, message: 'Unauthorized user' });
  }

  res.status(200).json({ success: true, userId: loggedInUserId });
});

// নির্দিষ্ট ইউজারের কয়েন ব্যালেন্স ও হিস্ট্রি ফেচ করার API (1 Coin = ৳0.30)
router.get('/balance/:user_id', async (req, res) => {
  try {
    const userId = req.params.user_id;

    // ইউজারের সব কয়েন ট্রানজেকশন ফেচ করা (প্লাস এবং মাইনাস উভয়ই ফিল্টার হয়ে আসবে)
    const [rows] = await db.execute(
      'SELECT * FROM my_coins WHERE user_id = ? ORDER BY id DESC',
      [userId]
    );

    // সব কয়েন যোগ করে মোট ব্যালেন্স বের করা (যেহেতু এক্সপায়ার্ড কয়েন -10 আকারে আছে, তাই অটো মাইনাস হয়ে যাবে)
    let totalCoins = rows.reduce((sum, row) => sum + row.coin_balance, 0);
    if (totalCoins < 0) totalCoins = 0;

    // ১ কয়েন = ০.৩০ টাকা হিসেবে টাকার পরিমাণ হিসাব
    const equivalentTk = (totalCoins * 0.30).toFixed(2);

    res.status(200).json({
      success: true,
      totalCoins,
      equivalentTk,
      transactions: rows
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;