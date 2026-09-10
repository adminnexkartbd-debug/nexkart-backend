// services/coinService.js
const db = require('../db'); // ডেটাবেজ কানেকশন

async function checkAndAddSignupCoins() {
  try {
    // ১. নতুন ইউজারদের জন্য সাইন-আপ বোনাস (১০ কয়েন) যোগ করা
    const signupQuery = `
      INSERT INTO my_coins (user_id, coin_balance, coin_source, coin_expire, coin_create_date)
      SELECT 
          u.id, 
          10, 
          'New Sign In Bonus', 
          DATE_ADD(NOW(), INTERVAL 6 MONTH), 
          NOW() 
      FROM users u
      WHERE NOT EXISTS (
          SELECT 1 
          FROM my_coins c 
          WHERE c.user_id = u.id AND c.coin_source = 'New Sign In Bonus'
      );
    `;
    await db.execute(signupQuery);

    // ২. এক্সপায়ার্ড কয়েন চেক করে -10 ব্যালেন্স যুক্ত করা
    const expireQuery = `
      INSERT INTO my_coins (user_id, coin_balance, coin_source, coin_expire, coin_create_date)
      SELECT 
          c.user_id, 
          -10, 
          'Coin Expire', 
          NULL, 
          NOW()
      FROM my_coins c
      WHERE c.coin_source = 'New Sign In Bonus'
        AND c.coin_expire <= NOW()
        AND NOT EXISTS (
            SELECT 1 
            FROM my_coins e 
            WHERE e.user_id = c.user_id 
              AND e.coin_source = 'Coin Expire'
        );
    `;
    const [expireResult] = await db.execute(expireQuery);
    
    console.log(`[Coin Service] Success. Signup checked. Expired rows processed: ${expireResult.affectedRows}`);
    return true;
  } catch (error) {
    console.error('[Coin Service Error]:', error);
    throw error;
  }
}

module.exports = {
  checkAndAddSignupCoins
};