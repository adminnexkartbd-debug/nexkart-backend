'use strict';
const crypto = require('crypto');
const { initiate, verify } = require('../services/payment/paystationService');
// Adapter interface must be implemented using your EXISTING checkout price, coupon, coin,
// stock and commission logic. Never accept payable amount from the browser.
function createController({ db, buildCheckoutSnapshot, finalizePaidCheckout }) {
  if (!db || !buildCheckoutSnapshot || !finalizePaidCheckout) throw new Error('Missing required adapters');
  async function start(req, res) {
    try {
      const userId = req.user?.id || req.session?.user?.id || req.session?.userId;
      if (!userId) return res.status(401).json({ success: false, message: 'Login required' });
      if (!['cart','buy_now'].includes(req.body.checkout_type)) return res.status(400).json({ success:false, message:'Invalid checkout type' });
      const checkout = await buildCheckoutSnapshot({ userId, type: req.body.checkout_type, input: req.body });
      // buildCheckoutSnapshot must independently validate product price, coupon, coins, stock,
      // shipping address, delivery fee and return an integer payable amount in BDT.
      if (!Number.isFinite(checkout.amount_bdt) || checkout.amount_bdt <= 0) throw new Error('Invalid server calculated total');
      const invoice = 'NXK' + Date.now() + crypto.randomBytes(5).toString('hex');
      await db.query('INSERT INTO paystation_attempts (invoice,user_id,checkout_type,amount_bdt,snapshot_json) VALUES (?,?,?,?,?)',
        [invoice,userId,req.body.checkout_type,checkout.amount_bdt,JSON.stringify(checkout)]);
      const payment_url = await initiate({invoice,amount:checkout.amount_bdt,name:checkout.name,phone:checkout.phone,email:checkout.email,address:checkout.address});
      return res.json({success:true,invoice,payment_url});
    } catch (err) { console.error('PayStation start:',err);return res.status(400).json({success:false,message:'Payment could not be started'}); }
  }
  async function reconcile(invoice) {
    if (typeof invoice !== 'string' || !/^NXK[0-9a-f]{15,40}$/i.test(invoice)) throw new Error('Invalid invoice');
    const [rows] = await db.query('SELECT * FROM paystation_attempts WHERE invoice=?',[invoice]);
    if (!rows.length) throw new Error('Invoice not found');
    const attempt=rows[0];
    if (attempt.finalized_at) return 'paid';
    const result=await verify(invoice);
    const amount=Number(result.payment_amount);
    if (String(result.invoice_number)!==invoice || !Number.isFinite(amount) || Math.abs(amount-Number(attempt.amount_bdt))>0.001) throw new Error('Invoice/amount mismatch');
    const status=String(result.trx_status||'').toLowerCase();
    if (status!=='success') return status;
    if (!result.trx_id) throw new Error('Missing transaction ID');
    // finalizePaidCheckout MUST use one InnoDB transaction, SELECT ... FOR UPDATE,
    // recheck finalized_at, ensure unique trx_id, and atomically insert orders,
    // deduct stock, apply coins/coupons, commission and set finalized_at.
    await finalizePaidCheckout({ invoice, trxId:result.trx_id, attempt });
    return 'paid';
  }
  async function callback(req,res) {
    try {
      const invoice=String(req.query.invoice_number || req.body?.invoice_number || '');
      const state=await reconcile(invoice);
      return res.redirect('/user/dashboard?payment='+encodeURIComponent(state==='paid'?'success':'pending'));
    } catch(e){console.error('PayStation callback:',e.message);return res.redirect('/user/dashboard?payment=unverified');}
  }
  async function ipn(req,res) {
    try {
      const invoice=String(req.body?.invoice_number||'');
      const state=await reconcile(invoice);
      return res.status(state==='paid'?200:409).json({status:state});
    } catch(e){console.error('PayStation IPN:',e.message);return res.status(503).json({status:'retry'});}
  }
  return {start,callback,ipn,reconcile};
}
module.exports={createController};
