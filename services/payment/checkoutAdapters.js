'use strict';
const db = require('../../db');
const money = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const positive = n => Number.isInteger(Number(n)) && Number(n) > 0;
const address = p => [p.block_house,p.union_area,p.upazilla,p.district,p.division,p.post_code ? `Post Code: ${p.post_code}` : ''].filter(Boolean).join(', ');
const getDelivery = (p, qty) => {
  if (Number(p.free_shipping) === 1) return 0;
  const charge = Number(p.delivery_charge) || 60;
  return money(charge * Math.ceil(qty / (Number(p.delivery_limit) || 1)));
};
async function buildCheckoutSnapshot({userId,type,input}) {
  const [profiles] = await db.query('SELECT * FROM users WHERE id=? LIMIT 1',[userId]);
  if (!profiles.length) throw new Error('User not found');
  const p=profiles[0];
  const name=String(input.name || p.name || '').trim(), phone=String(input.phone || p.phone_number || '').trim();
  if (!name || !phone || !p.district || !p.block_house) throw new Error('Complete shipping profile required');
  let items=[];
  if (type === 'buy_now') {
    if (!positive(input.quantity)) throw new Error('Invalid quantity');
    const [rows]=await db.query('SELECT * FROM products WHERE id=? OR product_id=? LIMIT 1',[input.product_id,input.product_id]);
    if (!rows.length) throw new Error('Product not found');
    items=[{...rows[0],quantity:Number(input.quantity),variant:input.variant || null}];
  } else if(type==='cart') {
    const [rows]=await db.query('SELECT p.*,c.quantity,c.id AS cart_id FROM cart c JOIN products p ON p.id=c.product_id WHERE c.user_id=? ORDER BY c.id',[userId]);
    items=rows;
  } else throw new Error('Invalid checkout type');
  if (!items.length) throw new Error('Cart empty');
  const orderItems=[];
  for (const item of items) {
    const qty=Number(item.quantity);
    if (!positive(qty) || qty>Number(item.stock_quantity)) throw new Error('Insufficient stock');
    if (!item.admin_id) throw new Error('Seller missing');
    const price=type==='cart' ? Number(item.sale_price)>0?Number(item.sale_price):Number(item.regular_price) : Number(item.sale_price);
    if (!Number.isFinite(price)||price<=0) throw new Error('Invalid product price');
    orderItems.push({product_id:item.id,seller_id:item.admin_id,quantity:qty,variant:item.variant||null,price:money(price),subtotal:money(price*qty),delivery: getDelivery(item,qty),cart_id:item.cart_id||null});
  }
  const subtotal=money(orderItems.reduce((s,x)=>s+x.subtotal,0));
  const delivery=money(orderItems.reduce((s,x)=>s+x.delivery,0));
  let couponDiscount=0, couponCode='';
  if (type==='buy_now' && input.coupon_code) {
    const [rows]=await db.query('SELECT * FROM coupons WHERE coupon_name=? LIMIT 1',[String(input.coupon_code).trim()]);
    if (!rows.length) throw new Error('Invalid coupon');
    const c=rows[0], product=orderItems[0];
    if (c.expiry_date && new Date(c.expiry_date)<new Date()) throw new Error('Coupon expired');
    if (c.product_id && String(c.product_id)!=='0' && String(c.product_id)!==String(product.product_id)) throw new Error('Coupon not applicable');
    couponDiscount=money(Math.min(subtotal,Math.max(0,Number(c.discount_amount)||0)));couponCode=c.coupon_name;
  }
  if (type==='cart' && input.coupon_code) {
    const [rows]=await db.query('SELECT * FROM coupons WHERE coupon_name=? LIMIT 1',[String(input.coupon_code).trim()]);
    if(!rows.length) throw new Error('Invalid coupon');
    const c=rows[0];
    if(c.expiry_date && new Date(c.expiry_date)<new Date()) throw new Error('Coupon expired');
    if(c.product_id && String(c.product_id)!=='0' && !orderItems.some(i=>String(i.product_id)===String(c.product_id))) throw new Error('Coupon not applicable');
    couponDiscount=money(Math.min(subtotal,Math.max(0,Number(c.discount_amount)||0)));couponCode=c.coupon_name;
  }
  if(type==='cart' && !input.coupon_code && Number(input.discount_amount)>0) throw new Error('Coupon code required for discount');
  let coinDiscount=0, coinsUsed=0;
  if(type==='buy_now' && (input.use_coins===true || input.use_coins==='true')) {
    const [productRows]=await db.query('SELECT coin_offer,coin_percentage_value FROM products WHERE id=?',[orderItems[0].product_id]);
    const prod=productRows[0];
    if(String(prod.coin_offer).toLowerCase()==='yes') {
      const [coinRows]=await db.query(`SELECT COALESCE(SUM(CASE WHEN coin_balance>0 AND (coin_expire IS NULL OR coin_expire>=CURDATE()) THEN coin_balance WHEN coin_balance<0 THEN coin_balance ELSE 0 END),0) AS balance FROM my_coins WHERE user_id=?`,[userId]);
      const balance=Math.max(0,Math.floor(Number(coinRows[0].balance)||0));
      const max=Math.floor(subtotal*Math.max(0,Number(prod.coin_percentage_value)||0)/100/0.30);
      coinsUsed=Math.min(balance,max);coinDiscount=money(coinsUsed*0.30);
    }
  }
  const amount=money(Math.max(0,subtotal-couponDiscount-coinDiscount)+delivery);
  if (!Number.isFinite(amount) || amount<=0) throw new Error('PayStation currently requires an integer BDT total');
  return {amount_bdt:amount,name,phone,email:p.email||'',address:address(p),user_id:userId,type,items:orderItems,coupon_discount:couponDiscount,coupon_code:couponCode,coin_discount:coinDiscount,coins_used:coinsUsed,subtotal,delivery};
}
async function finalizePaidCheckout({invoice,trxId,attempt}) {
  const conn=await db.getConnection();
  try {
    await conn.beginTransaction();
    const [locked]=await conn.query('SELECT * FROM paystation_attempts WHERE invoice=? FOR UPDATE',[invoice]);
    if (!locked.length) throw new Error('Attempt missing');
    if (locked[0].finalized_at) { await conn.commit();return; }
    const snapshot=typeof locked[0].snapshot_json==='string'?JSON.parse(locked[0].snapshot_json):locked[0].snapshot_json;
    if(!snapshot || !Array.isArray(snapshot.items) || !snapshot.items.length || Number(locked[0].amount_bdt)!==Number(snapshot.amount_bdt)) throw new Error('Snapshot mismatch');
    // Lock user row to serialize concurrent coin spending by this checkout implementation.
    const [user]=await conn.query('SELECT id FROM users WHERE id=? FOR UPDATE',[locked[0].user_id]);
    if(!user.length) throw new Error('User missing');
    const [commissionRows]=await conn.query('SELECT commission_rate FROM commission ORDER BY id DESC LIMIT 1');
    if(!commissionRows.length || !Number.isFinite(Number(commissionRows[0].commission_rate))) throw new Error('Commission not configured');
    const commissionRate=Number(commissionRows[0].commission_rate);
    if(commissionRate<0) throw new Error('Invalid commission');
    if(snapshot.coins_used>0) {
      const [coins]=await conn.query(`SELECT COALESCE(SUM(CASE WHEN coin_balance>0 AND (coin_expire IS NULL OR coin_expire>=CURDATE()) THEN coin_balance WHEN coin_balance<0 THEN coin_balance ELSE 0 END),0) AS balance FROM my_coins WHERE user_id=?`,[locked[0].user_id]);
      if(Number(coins[0].balance)<snapshot.coins_used) throw new Error('Insufficient coins after payment; manual reconciliation required');
    }
    let remainingCoupon=Number(snapshot.coupon_discount||0);
    for(let i=0;i<snapshot.items.length;i++) {
      const item=snapshot.items[i];
      const [products]=await conn.query('SELECT id,stock_quantity,sold_qty,admin_id FROM products WHERE id=? FOR UPDATE',[item.product_id]);
      if(!products.length || Number(products[0].stock_quantity)<item.quantity) throw new Error('Insufficient stock after payment; manual reconciliation required');
      const newStock=Number(products[0].stock_quantity)-item.quantity;
      await conn.query('UPDATE products SET stock_quantity=?,sold_qty=?,stock_status=? WHERE id=?',[newStock,Number(products[0].sold_qty||0)+item.quantity,newStock===0?'out_of_stock':'in_stock',item.product_id]);
      const orderId=`PS-${locked[0].id}-${i+1}`;
      const itemCoupon=money(Math.min(item.subtotal,remainingCoupon));
      remainingCoupon=money(remainingCoupon-itemCoupon);
      const itemCoin=i===0?snapshot.coin_discount:0;
      const itemTotal=money(Math.max(0,item.subtotal-itemCoupon-itemCoin)+item.delivery);
      await conn.query(`INSERT INTO orders (order_id,user_id,product_id,seller_id,quantity,variant,subtotal_price,delivery_charge,discount_amount,coupon_discount,coin_discount,total_amount,payment_method,selected_gateway,payment_status,order_status,customer_name,customer_email,customer_phone,shipping_address,created_at,payment_completed_at,qtyCalculate,sendMail,vat_cm) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NOW(),NOW(),0,0,0)`,[orderId,locked[0].user_id,item.product_id,item.seller_id,item.quantity,item.variant,item.subtotal,item.delivery,itemCoupon+itemCoin,itemCoupon,itemCoin,itemTotal,'online','paystation','complete','Pending',snapshot.name,snapshot.email,snapshot.phone,snapshot.address]);
      const commissionAmount=money(item.subtotal*commissionRate/100);
      await conn.query(`INSERT INTO commission_table (order_number,commission_rate,commission_amount,seller_id,payment_type,date) VALUES (?,?,?,?,?,NOW())`,[orderId,commissionRate,commissionAmount,item.seller_id,'paid']);
    }
    if(snapshot.coins_used>0) await conn.query('INSERT INTO my_coins (user_id,coin_balance,coin_expire,coin_source) VALUES (?, ?,NULL,?)',[locked[0].user_id,-snapshot.coins_used,`PayStation ${invoice}`]);
    if(snapshot.type==='cart') {
      // Remove only cart rows that were actually purchased; don't delete newer cart additions.
      for(const item of snapshot.items) if(item.cart_id) await conn.query('DELETE FROM cart WHERE id=? AND user_id=? AND product_id=? AND quantity=?',[item.cart_id,locked[0].user_id,item.product_id,item.quantity]);
    }
    await conn.query(`UPDATE paystation_attempts SET state='paid',trx_id=?,paid_at=NOW(),finalized_at=NOW() WHERE invoice=? AND finalized_at IS NULL`,[trxId,invoice]);
    await conn.commit();
  } catch(err) {await conn.rollback();throw err;} finally {conn.release();}
}
module.exports={db,buildCheckoutSnapshot,finalizePaidCheckout};
