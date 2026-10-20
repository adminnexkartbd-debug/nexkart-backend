'use strict';
const cron = require('node-cron');
const db = require('../db');

// Commission is created by checkout ONLY. This worker NEVER inserts commission.
// vat_cm=1 marks accounting routed: online credited to total_sales, COD recorded in separate ledger.
let running = null;
async function processOrderCommissionUpdates() {
  try {
    // Transaction + row lock prevents multiple workers from crediting twice.
    const [candidates] = await db.query(
      `SELECT id FROM orders WHERE (vat_cm = 0 OR vat_cm IS NULL)
         AND (LOWER(TRIM(payment_method)) = 'cod' OR
              (LOWER(TRIM(order_status)) = 'delivered' AND LOWER(TRIM(payment_status)) = 'paid'))
         ORDER BY id ASC LIMIT 100`
    );
    for (const { id } of candidates) {
      const conn = await db.getConnection();
      try {
        await conn.beginTransaction();
        const [orders] = await conn.query(
          `SELECT id, order_id, seller_id, total_amount, subtotal_price, delivery_charge, coupon_discount, coin_discount, payment_method, payment_status, order_status, vat_cm
             FROM orders WHERE id = ? FOR UPDATE`, [id]
        );
        const order = orders[0];
        if (!order || Number(order.vat_cm) === 1) {
          await conn.commit();
          continue;
        }
        const [commissions] = await conn.query(
          `SELECT commission_amount FROM commission_table
             WHERE order_number = ? AND seller_id = ? ORDER BY id ASC LIMIT 2`,
          [order.order_id, order.seller_id]
        );
        // Do not credit a missing or duplicate commission; require manual review.
        if (commissions.length !== 1) {
          await conn.rollback();
          continue;
        }
        const commission = Number(commissions[0].commission_amount);
        if (String(order.payment_method || '').trim().toLowerCase() === 'cod') {
          const productAmount = Math.max(0,
            Number(order.subtotal_price || 0) - Number(order.coupon_discount || 0) - Number(order.coin_discount || 0));
          const deliveryCharge = Number(order.delivery_charge || 0);
          if (!Number.isFinite(productAmount) || !Number.isFinite(deliveryCharge) ||
              !Number.isFinite(commission) || commission < 0 || commission > productAmount ||
              deliveryCharge < 0 || !order.seller_id) {
            await conn.rollback();
            continue;
          }
          const sellerAmount = Math.round((productAmount - commission + Number.EPSILON) * 100) / 100;
          await conn.query(`INSERT INTO seller_cod_ledger
              (order_id, seller_id, product_amount, delivery_charge, commission_amount, seller_amount, collection_status)
              VALUES (?, ?, ?, ?, ?, ?, 'pending_collection')
              ON DUPLICATE KEY UPDATE id = id`,
              [order.order_id, order.seller_id, productAmount, deliveryCharge, commission, sellerAmount]);
          // vat_cm now means accounting routed once; COD is never credited to total_sales.
          await conn.query('UPDATE orders SET vat_cm = 1 WHERE id = ?', [order.id]);
          await conn.commit();
          console.log(`[Commission Cron] COD ledger recorded (not credited): ${order.order_id}`);
          continue;
        }
        // Online money is withdrawable only after verified payment AND delivery.
        if (String(order.payment_status || '').trim().toLowerCase() !== 'paid' ||
            String(order.order_status || '').trim().toLowerCase() !== 'delivered') {
          await conn.commit();
          continue;
        }
        const total = Number(order.total_amount);
        if (!Number.isFinite(total) || !Number.isFinite(commission) || total < 0 || commission < 0) {
          await conn.rollback();
          continue;
        }
        // Preserve existing seller total_sales convention: order total minus commission.
        const sellerCredit = Math.round((total - commission + Number.EPSILON) * 100) / 100;
        if (sellerCredit < 0 || !order.seller_id) {
          await conn.rollback();
          continue;
        }
        const [result] = await conn.query(
          `UPDATE admins SET total_sales = COALESCE(total_sales, 0) + ? WHERE id = ?`,
          [sellerCredit, order.seller_id]
        );
        if (result.affectedRows !== 1) throw new Error(`Seller missing for order ${order.order_id}`);
        await conn.query(`UPDATE orders SET vat_cm = 1 WHERE id = ?`, [order.id]);
        await conn.commit();
        console.log(`[Commission Cron] Seller sales credited once: ${order.order_id}`);
      } catch (error) {
        try { await conn.rollback(); } catch (_) {}
        console.error('[Commission Cron Error]', error);
      } finally {
        conn.release();
      }
    }
  } catch (error) {
    console.error('[Commission Cron Error]', error);
  }
}
function syncDeliveredSales() {
  if (!running) running = processOrderCommissionUpdates().finally(() => { running = null; });
  return running;
}
function startCommissionCron() {
  cron.schedule('*/30 * * * * *', () => { void syncDeliveredSales(); });
  console.log('Seller sales update cron started (no commission inserts)');
}
module.exports = startCommissionCron;

module.exports.syncDeliveredSales = syncDeliveredSales;
