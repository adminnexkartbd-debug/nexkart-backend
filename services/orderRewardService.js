'use strict';
const db = require('../db');
const cron = require('node-cron');
const { sendViaGoogleOAuth } = require('./ReturnPolicyMail');
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]));

// Work in integer paisa so decimal subtotals do not round up at a boundary.
function rewardCoins(subtotal) {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(String(subtotal));
  if (!match) throw new Error('Invalid order subtotal');
  const paisa = BigInt(match[1]) * 100n + BigInt((match[2] || '').padEnd(2, '0'));
  return Number(paisa / 10000n);
}
function rewardEmail(row) {
  return `<!doctype html><html><body style="margin:0;background:#f6f2f5;font-family:Arial,sans-serif;color:#29202a">
  <div style="max-width:580px;margin:30px auto;background:#fff;border-radius:18px;overflow:hidden">
  <div style="background:#ae245b;padding:30px;color:#fff;text-align:center"><h1>NexKartBD</h1><p>Thank you for shopping with us!</p></div>
  <div style="padding:30px"><h2>Your reward coins have arrived!</h2><p>Hello ${escapeHtml(row.customer_name || 'Customer')},</p>
  <p>Your order has been delivered and its payment is confirmed. We have added your shopping reward to your NexKartBD account.</p>
  <div style="background:#fff4dc;border-radius:12px;text-align:center;padding:24px"><b style="font-size:38px;color:#a66a00">+${Number(row.coins)} Coins</b></div>
  <p><b>Order:</b> ${escapeHtml(row.order_id)}<br><b>Product subtotal:</b> BDT ${escapeHtml(row.subtotal_price)}<br><b>Reward rate:</b> 1 coin for every full BDT 100</p>
  <p>Only the product subtotal is used for this reward. Delivery charges are excluded.</p>
  <p><a href="https://www.nexkartbd.com/user/dashboard" style="display:inline-block;background:#ae245b;color:#fff;text-decoration:none;padding:14px 22px;border-radius:8px">Visit your account</a></p>
  <p>Enjoy your next shopping experience!<br><b>The NexKartBD Team</b></p></div></div></body></html>`;
}
let running = false;
let task;
async function processOrderRewards() {
  if (running) return;
  running = true;
  let conn;
  let locked = false;
  try {
    conn = await db.getConnection();
    const [[lock]] = await conn.query("SELECT GET_LOCK('nexkart_order_rewards_v1', 0) AS acquired");
    locked = Number(lock.acquired) === 1;
    if (!locked) return;
    // Fail before modifying orders if the migration has not been installed.
    await conn.query('SELECT order_row_id FROM order_reward_mail LIMIT 0');
    const [candidates] = await conn.query(`SELECT id FROM orders
      WHERE RewardGiveWay = 0 AND LOWER(TRIM(order_status)) = 'delivered'
        AND LOWER(TRIM(payment_status)) = 'paid' ORDER BY id LIMIT 100`);
    for (const candidate of candidates) {
      try {
        await conn.beginTransaction();
        const [[order]] = await conn.query(`SELECT * FROM orders WHERE id = ?
          AND RewardGiveWay = 0 AND LOWER(TRIM(order_status)) = 'delivered'
          AND LOWER(TRIM(payment_status)) = 'paid' FOR UPDATE`, [candidate.id]);
        if (!order) { await conn.rollback(); continue; }
        const [[user]] = await conn.query('SELECT id, email FROM users WHERE id = ?', [order.user_id]);
        if (!user) throw new Error(`Order ${order.id}: user does not exist`);
        const coins = rewardCoins(order.subtotal_price);
        if (coins > 0) {
          const source = `Order Reward - ${order.order_id} | BDT ${order.subtotal_price} subtotal | 1 coin per BDT 100`;
          await conn.query(`INSERT INTO my_coins
            (user_id, coin_balance, coin_expire, coin_create_date, coin_source)
            VALUES (?, ?, NULL, NOW(), ?)`, [order.user_id, coins, source]);
          await conn.query(`INSERT INTO order_reward_mail
            (order_row_id, order_id, user_id, coins, subtotal_price, customer_name, recipient)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [order.id, order.order_id, order.user_id, coins, order.subtotal_price,
            order.customer_name || '', String(user.email || order.customer_email || '').trim()]);
        }
        await conn.query('UPDATE orders SET RewardGiveWay = 1 WHERE id = ?', [order.id]);
        await conn.commit();
        console.log(`[Order Reward] ${order.order_id}: ${coins} coins processed`);
      } catch (error) {
        await conn.rollback();
        console.error('[Order Reward] Order failed:', candidate.id, error.message);
      }
    }
    // The persisted queue retries mail without awarding coins again, even after a restart.
    const [mails] = await conn.query(`SELECT * FROM order_reward_mail
      WHERE sent_at IS NULL AND next_attempt_at <= NOW() ORDER BY order_row_id LIMIT 30`);
    for (const mail of mails) {
      try {
        if (!/^[^\s@<>\r\n]+@[^\s@<>\r\n]+\.[^\s@<>\r\n]+$/.test(mail.recipient)) {
          throw new Error('Reward email recipient is missing or invalid');
        }
        await sendViaGoogleOAuth(mail.recipient, `You earned ${mail.coins} coins! | NexKartBD Order ${mail.order_id}`, rewardEmail(mail));
        await conn.query('UPDATE order_reward_mail SET sent_at = NOW(), last_error = NULL WHERE order_row_id = ?', [mail.order_row_id]);
      } catch (error) {
        await conn.query(`UPDATE order_reward_mail SET attempts = attempts + 1,
          last_error = ?, next_attempt_at = DATE_ADD(NOW(), INTERVAL 5 MINUTE)
          WHERE order_row_id = ?`, [String(error.message).slice(0, 500), mail.order_row_id]);
        console.error('[Order Reward] Email queued for retry:', mail.order_id, error.message);
      }
    }
  } catch (error) {
    console.error('[Order Reward Cron]', error.message);
  } finally {
    if (conn) {
      if (locked) {
        try { await conn.query("SELECT RELEASE_LOCK('nexkart_order_rewards_v1')"); }
        catch { conn.destroy(); conn = null; }
      }
      if (conn) conn.release();
    }
    running = false;
  }
}
function start() {
  if (task) return task;
  task = cron.schedule('* * * * *', processOrderRewards);
  console.log('[Order Reward Cron] Started: every minute');
  return task;
}
module.exports = { start, processOrderRewards, rewardCoins, rewardEmail };
