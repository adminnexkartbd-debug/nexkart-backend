'use strict';
const https=require('https');
const crypto=require('crypto');
const express=require('express');
const db=require('../db');
const mail=require('./orderStatusMail');
function request(path,body) {
 return new Promise((resolve,reject)=>{
  if(!process.env.STEADFAST_API_KEY || !process.env.STEADFAST_SECRET_KEY) return reject(new Error('Steadfast API credentials are not configured'));
  const base=process.env.STEADFAST_BASE_URL || 'https://portal.steadfast.com.bd/api/v1';
  const url=new URL(base.replace(/\/$/,'')+path);
  if(url.protocol!=='https:' || !['portal.steadfast.com.bd','portal.packzy.com'].includes(url.hostname)) return reject(new Error('Invalid Steadfast API base URL'));
  const data=body?JSON.stringify(body):null;
  const req=https.request(url,{method:data?'POST':'GET',headers:{'Api-Key':process.env.STEADFAST_API_KEY,'Secret-Key':process.env.STEADFAST_SECRET_KEY,'Content-Type':'application/json',...(data?{'Content-Length':Buffer.byteLength(data)}:{})}},res=>{
   let text='';res.on('data',c=>text+=c);res.on('end',()=>{try {const json=JSON.parse(text);if(res.statusCode!==200 || (json.status && Number(json.status)!==200)) throw new Error('Steadfast request failed: '+(json.message || json.status || res.statusCode));resolve(json);}catch(e){reject(e);}});
  });req.setTimeout(20000,()=>req.destroy(new Error('Steadfast request timed out; check the merchant panel before retrying')));req.on('error',reject);req.end(data);
 });
}
function mappedStatus(status) {
 // pending means not delivered/cancelled, not proof of pickup.
 return {in_review:'processing',delivered:'delivered'}[status] || null;
}
async function sync(orderId) {
 const [rows]=await db.query("SELECT * FROM order_tracking17 WHERE order_id=? AND provider='steadfast'",[orderId]);
 const t=rows[0];if(!t || !t.tracking_number)return;
 const result=await request('/status_by_trackingcode/'+encodeURIComponent(t.tracking_number));
 const status=result.delivery_status;if(!status || status==='unknown') return;
 const mapped=mappedStatus(status);
 await db.query(`UPDATE orders o JOIN order_tracking17 t ON t.order_id=o.order_id
 SET o.order_status=CASE WHEN t.auto_sync=1 AND ? IS NOT NULL AND o.order_status NOT IN ('delivered','cancelled') AND NOT(o.order_status='shipped' AND ?='processing') THEN ? ELSE o.order_status END,
 t.courier_status=?,t.courier_detail=?,t.last_checked=UTC_TIMESTAMP(),t.sync_error=NULL,t.updated_at=UTC_TIMESTAMP()
 WHERE o.order_id=? AND t.provider='steadfast' AND t.tracking_number=? AND o.tracking_number=t.tracking_number`,[mapped,mapped,mapped,status,status,orderId,t.tracking_number]);
 if(mapped==='delivered')await db.query(`INSERT IGNORE INTO order_status_mail (order_id,status) SELECT o.order_id,'delivered' FROM orders o JOIN order_tracking17 t ON t.order_id=o.order_id WHERE o.order_id=? AND o.order_status='delivered' AND t.provider='steadfast' AND t.auto_sync=1 AND t.tracking_number=? AND o.tracking_number=t.tracking_number AND t.courier_status='delivered'`,[orderId,t.tracking_number]);
}
async function create(order,cod) {
 if(['delivered','cancelled'].includes(order.order_status))throw new Error('This order is already completed/cancelled');
 if(!/^[a-zA-Z0-9_-]+$/.test(order.order_id))throw new Error('Order ID must contain only letters, numbers, underscores or hyphens');
 const phone=String(order.customer_phone||'').replace(/[\s()-]/g,'').replace(/^\+?88/,'');
 if(!/^01\d{9}$/.test(phone))throw new Error('A valid 11-digit Bangladesh phone number is required');
 if(!order.customer_name || order.customer_name.length>100 || !order.shipping_address || order.shipping_address.length>250)throw new Error('Check recipient name (max 100) and shipping address (max 250 characters)');
 if(!Number.isFinite(cod)||cod<0||cod>Number(order.total_amount))throw new Error('COD amount must be between 0 and the order total');
 if(order.payment_status==='paid' && cod!==0)throw new Error('Paid orders must have COD amount 0');
 // Reserve once before the external POST. Never blindly recreate after a timeout.
 const [claim]=await db.query(`INSERT IGNORE INTO order_tracking17 (order_id,tracking_number,provider,create_state) VALUES (?,'','steadfast','creating')`,[order.order_id]);
 if(!claim.affectedRows)throw new Error('Tracking/reservation already exists. Check the merchant panel; save its tracking code instead of creating again.');
 try {
  const r=await request('/create_order',{invoice:order.order_id,recipient_name:order.customer_name,recipient_phone:phone,recipient_address:order.shipping_address,cod_amount:cod,note:'NexkartBD '+order.order_id});
  const c=r.consignment;
  if(!c || !c.tracking_code)throw new Error('No tracking code returned. Check the merchant panel.');
  await db.query("UPDATE order_tracking17 SET tracking_number=?,consignment_id=?,create_state='created',registered=1,courier_status='in_review' WHERE order_id=? AND provider='steadfast'",[c.tracking_code,String(c.consignment_id),order.order_id]);
  await db.query('UPDATE orders SET tracking_number=? WHERE order_id=?',[c.tracking_code,order.order_id]);
  return c;
 }catch(e){await db.query("UPDATE order_tracking17 SET create_state='check_required',sync_error=? WHERE order_id=?",[e.message.slice(0,500),order.order_id]);throw e;}
}
let busy=false;
async function poll(){if(busy)return;busy=true;try{
 if(!process.env.STEADFAST_API_KEY || !process.env.STEADFAST_SECRET_KEY)return;
 const [rows]=await db.query(`SELECT t.order_id FROM order_tracking17 t JOIN orders o ON o.order_id=t.order_id WHERE t.provider='steadfast' AND t.tracking_number<>'' AND t.auto_sync=1 AND o.order_status NOT IN ('delivered','cancelled') AND (t.last_checked IS NULL OR t.last_checked<DATE_SUB(UTC_TIMESTAMP(),INTERVAL 15 MINUTE)) ORDER BY COALESCE(t.last_checked,'2000-01-01') LIMIT 20`);
 for(const row of rows){try{await sync(row.order_id);}catch(e){await db.query('UPDATE order_tracking17 SET last_checked=UTC_TIMESTAMP(),sync_error=? WHERE order_id=?',[e.message.slice(0,500),row.order_id]);}}
 }catch(e){console.error('Steadfast sync worker:',e.code||e.name);}finally{busy=false;}}
function start(){const timer=setInterval(poll,60000);timer.unref();poll();}
const router=express.Router();
router.post('/',express.json({limit:'100kb'}),async(req,res)=>{
 const token=process.env.STEADFAST_BEARER_TOKEN;const received=req.get('authorization')||'';const expected='Bearer '+token;
 if(!token || Buffer.byteLength(received)!==Buffer.byteLength(expected) || !crypto.timingSafeEqual(Buffer.from(received),Buffer.from(expected)))return res.sendStatus(401);
 try {
  const id=req.body.consignment_id;
  if(!id && !req.body.invoice)return res.sendStatus(400);
  const [rows]=await db.query("SELECT order_id FROM order_tracking17 WHERE provider='steadfast' AND (consignment_id=? OR order_id=?)",[String(id||''),String(req.body.invoice||'')]);
  // Reconcile with the authenticated status API, not unverified payload status/order.
  for(const row of rows)await sync(row.order_id);
  res.json({status:'success'});
 }catch(e){res.sendStatus(503);}
});
module.exports={request,mappedStatus,sync,create,start,router};
