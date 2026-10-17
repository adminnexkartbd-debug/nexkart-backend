'use strict';
// Return only commerce data belonging to the signed-in buyer. No customer PII.
const money = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
function createPurchaseHandler(db) {
  return async function purchaseData(req, res) {
    res.set('Cache-Control', 'no-store');
    const userId = req.user?.id || req.session?.user?.id || req.session?.userId;
    if (!userId) return res.status(401).json({success:false});
    try {
      const invoice = String(req.query.invoice || '');
      const orderId = String(req.query.order_id || '');
      let transactionId, lines, total, shipping;
      if (invoice) {
        if (!/^NXK[0-9a-f]{15,40}$/i.test(invoice)) return res.status(400).json({success:false});
        const [rows] = await db.query('SELECT snapshot_json,amount_bdt,finalized_at,state FROM paystation_attempts WHERE invoice=? AND user_id=? LIMIT 1', [invoice,userId]);
        const a=rows[0];
        if (!a || !a.finalized_at || a.state!=='paid') return res.status(409).json({success:false});
        const s=typeof a.snapshot_json==='string'?JSON.parse(a.snapshot_json):a.snapshot_json;
        if (!s || !Array.isArray(s.items) || !s.items.length) throw new Error('Invalid snapshot');
        transactionId=invoice; total=money(a.amount_bdt); shipping=money(s.delivery || 0);
        lines=s.items.map(x=>({id:x.public_product_id || x.product_id, name:'Product '+(x.public_product_id || x.product_id), variant:x.variant, qty:Number(x.quantity), gross:Number(x.subtotal)}));
      } else {
        if (!/^NXK-\d{11}$/.test(orderId)) return res.status(400).json({success:false});
        const [rows]=await db.query(`SELECT o.*,p.title AS tracking_title,p.product_id AS tracking_product_id FROM orders o LEFT JOIN products p ON p.id=o.product_id WHERE o.user_id=? AND (o.order_id=? OR o.order_id LIKE ?) ORDER BY o.order_id`, [userId,orderId,orderId+'-%']);
        if (!rows.length || rows.some(x=>String(x.payment_method).toLowerCase()!=='cod' || /fail|cancel|refund/i.test(String(x.payment_status)+' '+String(x.order_status)))) return res.status(409).json({success:false});
        // In this cart implementation total_amount and delivery_charge are batch totals repeated per row.
        transactionId=orderId; total=money(rows[0].total_amount); shipping=money(rows[0].delivery_charge || 0);
        lines=rows.map(x=>({id:x.tracking_product_id || x.product_id,name:x.tracking_title || 'Product '+x.product_id,variant:x.variant,qty:Number(x.quantity),gross:Number(x.subtotal_price)}));
      }
      const value=money(total-shipping), gross=lines.reduce((sum,x)=>sum+x.gross,0);
      if (![total,shipping,value,gross].every(Number.isFinite) || total<0 || shipping<0 || value<0 || gross<=0 || lines.some(x=>!Number.isInteger(x.qty)||x.qty<=0||!Number.isFinite(x.gross)||x.gross<0)) throw new Error('Invalid amounts');
      // Allocate discounts across items; GA4 value excludes shipping.
      const items=lines.map(x=>({item_id:String(x.id),item_name:String(x.name),item_variant:x.variant || undefined,quantity:x.qty,price:(value*x.gross/gross)/x.qty}));
      return res.json({success:true,event_id:'purchase_'+transactionId,ecommerce:{transaction_id:transactionId,currency:'BDT',value,shipping,tax:0,items}});
    } catch(err) {
      console.error('Purchase tracking data:',err.message);
      return res.status(500).json({success:false});
    }
  };
}
module.exports={createPurchaseHandler};
