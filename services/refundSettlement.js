'use strict';
// Dependencies are injected so accounting can be tested without a live database.
module.exports = function createRefundSettlement({ db, sendEmail }) {
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fail = (status, message) => Object.assign(new Error(message), { status });
  async function emailReceipt(id) {
    const [[row]] = await db.query(`SELECT r.*, a.name AS seller_name, a.email AS seller_email
      FROM order_returns r JOIN admins a ON a.id=r.seller_id WHERE r.id=?`, [id]);
    if (!row || row.sattle_ment !== 'success') throw fail(409, 'Successful settlement not found');
    if (row.settlement_email_sent_at) return;
    await sendEmail(row.seller_email, `NexKartBD | Return settlement #${row.id}`,
      `<div style="font-family:Arial;max-width:600px;margin:auto;border:1px solid #e2e8f0;border-radius:16px;padding:24px">
       <img src="https://res.cloudinary.com/yhctkgwj/image/upload/v1791893714/nexkart.png" alt="NexKartBD" width="150">
       <h2>Refund &amp; Return settlement successful</h2><p>Hello ${escape(row.seller_name)},</p>
       <p>Super Admin has completed the balance settlement for your approved return request.</p>
       <p>Return request: <b>#${row.id}</b><br>Order: <b>${escape(row.order_id)}</b><br>
       Amount deducted from your seller balance: <b>BDT ${Number(row.settlement_amount).toFixed(2)}</b></p>
       <p>Reason: ${escape(row.return_reason)}</p><p>Check your Withdraw Portal for your updated balance.</p>
       <p>NexKartBD</p></div>`);
    await db.query('UPDATE order_returns SET settlement_email_sent_at=NOW() WHERE id=? AND sattle_ment=\'success\'', [id]);
  }
  async function settle(id, decision, actorId) {
    if (!Number.isSafeInteger(id) || id <= 0 || !['success','reject'].includes(decision)) throw fail(400, 'Invalid return ID or settlement decision');
    const conn = await db.getConnection();
    let receipt;
    try {
      await conn.beginTransaction();
      const [[r]] = await conn.query('SELECT * FROM order_returns WHERE id=? FOR UPDATE', [id]);
      if (!r) throw fail(404, 'Return request not found');
      if (String(r.status).trim().toLowerCase() !== 'approved') throw fail(409, 'Seller must approve this return first');
      if (r.sattle_ment !== 'pending') throw fail(409, 'This return has already been settled or rejected');
      let amount = 0;
      if (decision === 'success') {
        // Lock the original order to serialize even duplicate return request rows.
        const [orders] = await conn.query(`SELECT id,total_amount FROM orders
          WHERE BINARY order_id=BINARY ? AND seller_id=? AND product_id=? AND user_id=? FOR UPDATE`,
          [r.order_id,r.seller_id,r.product_id,r.user_id]);
        if (orders.length !== 1) throw fail(409, 'Matching original order is missing or ambiguous');
        const [duplicates] = await conn.query(`SELECT id FROM order_returns WHERE BINARY order_id=BINARY ?
          AND seller_id=? AND product_id=? AND id<>? AND sattle_ment='success'`, [r.order_id,r.seller_id,r.product_id,id]);
        if (duplicates.length) throw fail(409, 'This order/product was already refunded');
        // Use the historical charged amount, including quantity/discounts/delivery.
        amount = Math.round(Number(orders[0].total_amount) * 100) / 100;
        if (!Number.isFinite(amount) || amount <= 0) throw fail(409, 'Invalid original order amount');
        const [[seller]] = await conn.query('SELECT id,total_sales,total_withdraw FROM admins WHERE id=? FOR UPDATE', [r.seller_id]);
        if (!seller) throw fail(404, 'Seller not found');
        const [debit] = await conn.query(`UPDATE admins SET total_sales=COALESCE(total_sales,0)-?
          WHERE id=? AND COALESCE(total_sales,0)-COALESCE(total_withdraw,0)>=?`, [amount,r.seller_id,amount]);
        if (debit.affectedRows !== 1) throw fail(409, 'Insufficient seller available balance; no money deducted');
        // An online return settled before the sales cron must never be credited later.
        // The order row is already locked, so this also serializes with that worker.
        await conn.query(`UPDATE orders SET vat_cm=1 WHERE id=? AND LOWER(TRIM(payment_method))<>'cod'`, [orders[0].id]);
      }
      const [updated] = await conn.query(`UPDATE order_returns SET sattle_ment=?,settlement_amount=?,settled_at=NOW(),settled_by=?
        WHERE id=? AND sattle_ment='pending'`, [decision,amount,actorId,id]);
      if (updated.affectedRows !== 1) throw fail(409, 'Settlement changed; refresh and try again');
      await conn.commit();
      receipt = { success:true, sattle_ment:decision, deducted:amount };
    } catch (error) {
      try { await conn.rollback(); } catch (_) {}
      throw error;
    } finally { conn.release(); }
    // Email failure must never roll back or repeat a committed balance deduction.
    if (decision === 'success') {
      try { await emailReceipt(id); receipt.email_sent=true; }
      catch (error) { console.error('Return settlement email failed:', error.message); receipt.email_sent=false; }
    }
    return receipt;
  }
  return { settle, emailReceipt };
};
