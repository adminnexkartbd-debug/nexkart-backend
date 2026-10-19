'use strict';
const { google } = require('googleapis');
const crypto = require('crypto');
const db = require('../db');
const esc = v => String(v || '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function message(order,status) {
    const email=String(order.customer_email || '').trim();
    if (!/^[^\s<>@,;\r\n]+@[^\s<>@,;\r\n]+\.[^\s<>@,;\r\n]+$/.test(email)) throw new Error('Customer email is missing or invalid');
    const delivered=status==='delivered';
    const title=delivered?'Your order has been delivered':'Your order has been shipped';
    const html=`<div style="background:#f1f5f9;padding:32px;font-family:Arial,sans-serif;color:#172033"><div style="max-width:560px;margin:auto;background:white;padding:30px;border-radius:16px"><img src="https://res.cloudinary.com/yhctkgwj/image/upload/v1791893714/nexkart.png" alt="NexkartBD" width="145"><h2>${title}</h2><p>Hello ${esc(order.customer_name || 'Customer')},</p><p>${delivered?'Your order has been delivered successfully. Thank you for shopping with NexkartBD!':'Your order is on its way. Thank you for shopping with NexkartBD!'}</p><p><b>Order ID:</b> ${esc(order.order_id)}</p>${order.tracking_number?`<p><b>Tracking number:</b> ${esc(order.tracking_number)}</p>`:''}<p><b>Status:</b> ${delivered?'Delivered':'Shipped'}</p><p>If you need help${delivered?' or have not received your parcel':''}, please contact NexkartBD support.</p><a href="https://www.nexkartbd.com" style="display:inline-block;padding:12px 22px;background:#0f766e;color:white;text-decoration:none;border-radius:8px">Visit NexkartBD</a></div></div>`;
    const subject= '=?UTF-8?B?'+Buffer.from('NexkartBD — '+title+' | '+order.order_id).toString('base64')+'?=';
    return Buffer.from([`To: ${email}`,`Subject: ${subject}`,'MIME-Version: 1.0','Content-Type: text/html; charset=UTF-8','Content-Transfer-Encoding: base64','',Buffer.from(html).toString('base64').match(/.{1,76}/g).join('\r\n')].join('\r\n')).toString('base64url');
}
async function enqueue(orderId,status) {
    if (!['shipped','delivered'].includes(status)) return;
    await db.query(`INSERT IGNORE INTO order_status_mail (order_id,status) VALUES (?,?)`,[orderId,status]);
}
let running=false;
async function drain() {
    if(running) return; running=true;
    try {
        const {GOOGLE_USER_CLIENT_ID:id,GOOGLE_USER_CLIENT_SECRET:secret,GOOGLE_REFRESH_TOKEN:token}=process.env;
        if(!id || !secret || !token) return;
        const auth=new google.auth.OAuth2(id,secret);auth.setCredentials({refresh_token:token});
        const gmail=google.gmail({version:'v1',auth});
        const [jobs]=await db.query(`SELECT id FROM order_status_mail WHERE (state='pending' AND next_attempt<=UTC_TIMESTAMP()) OR (state='sending' AND claimed_at<DATE_SUB(UTC_TIMESTAMP(),INTERVAL 10 MINUTE)) ORDER BY id LIMIT 10`);
        for(const job of jobs) {
            const claim=crypto.randomUUID();
            const [claimed]=await db.query(`UPDATE order_status_mail SET state='sending',claim_token=?,claimed_at=UTC_TIMESTAMP(),attempts=attempts+1 WHERE id=? AND ((state='pending' AND next_attempt<=UTC_TIMESTAMP()) OR (state='sending' AND claimed_at<DATE_SUB(UTC_TIMESTAMP(),INTERVAL 10 MINUTE)))`,[claim,job.id]);
            if(!claimed.affectedRows) continue;
            try {
                const [rows]=await db.query(`SELECT m.status AS mail_status,o.* FROM order_status_mail m JOIN orders o ON o.order_id=m.order_id WHERE m.id=? AND m.claim_token=?`,[job.id,claim]);
                const order=rows[0];
                if(!order || order.order_status!==order.mail_status) {
                    await db.query("UPDATE order_status_mail SET state='skipped' WHERE id=? AND claim_token=?",[job.id,claim]);continue;
                }
                const sent=await gmail.users.messages.send({userId:'me',requestBody:{raw:message(order,order.mail_status)}},{timeout:30000,retry:false});
                await db.query("UPDATE order_status_mail SET state='sent',sent_at=UTC_TIMESTAMP(),gmail_id=?,last_error=NULL WHERE id=? AND claim_token=?",[sent.data.id || null,job.id,claim]);
            } catch(e) {
                // Do not log OAuth response bodies or customer information.
                await db.query("UPDATE order_status_mail SET state=IF(attempts>=8,'failed','pending'),next_attempt=DATE_ADD(UTC_TIMESTAMP(),INTERVAL 5 MINUTE),last_error=? WHERE id=? AND claim_token=?",[String(e.message).slice(0,500),job.id,claim]);
            }
        }
    } catch(e) { console.error('Order status mail worker:',e.code || e.name); }
    finally {running=false;}
}
function start() { const timer=setInterval(drain,60000);timer.unref();drain(); }
module.exports={enqueue,drain,start,message};
