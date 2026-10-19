'use strict';
const express = require('express');
const crypto = require('crypto');
const https = require('https');
const db = require('../../db');
const key = () => process.env.TRACK17_SECURITY_KEY;
function api(method, items) {
    return new Promise((resolve, reject) => {
        if (!key()) return reject(new Error('TRACK17_SECURITY_KEY is not configured'));
        const body = JSON.stringify(items);
        const req = https.request('https://api.17track.net/track/v2.4/' + method, {
            method: 'POST', headers: { '17token': key(), 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
        }, res => {
            let data = ''; res.on('data', c => data += c);
            res.on('end', () => { try {
                const json = JSON.parse(data);
                if (res.statusCode !== 200 || json.code !== 0) throw new Error('17TRACK request failed: ' + (json.code || res.statusCode));
                resolve(json.data || {});
            } catch (e) { reject(e); } });
        });
        req.setTimeout(15000, () => req.destroy(new Error('17TRACK timeout')));
        req.on('error', reject); req.end(body);
    });
}
async function register(orderId, number) {
    const data = await api('register', [{number}]);
    const rejected = data.rejected || [];
    if (!(data.accepted || []).length && !rejected.some(x => Number(x.error && x.error.code) === -18019901)) {
        throw new Error((rejected[0] && rejected[0].error && rejected[0].error.message) || 'Tracking registration rejected');
    }
    await db.query('UPDATE order_tracking17 SET registered=1, sync_error=NULL WHERE order_id=? AND tracking_number=?', [orderId, number]);
}
function verify(raw, sign, secret) {
    if (!secret || !Buffer.isBuffer(raw) || !/^[a-f0-9]{64}$/i.test(sign || '')) return false;
    const expected = crypto.createHash('sha256').update(raw).update('/' + secret).digest();
    return crypto.timingSafeEqual(expected, Buffer.from(sign, 'hex'));
}
function mappedStatus(status) {
    return {InfoReceived:'processing', InTransit:'shipped', AvailableForPickup:'shipped', OutForDelivery:'shipped', Delivered:'delivered'}[status] || null;
}
async function receive(req, res) {
    if (!key()) return res.sendStatus(503);
    if (!verify(req.body, req.get('sign'), key())) return res.sendStatus(401);
    try {
        const payload = JSON.parse(req.body.toString('utf8'));
        if (payload.event !== 'TRACKING_UPDATED') return res.status(200).json({code:200});
        const d = payload.data || {}, info = d.track_info || {}, latest = info.latest_status || {};
        const event = info.latest_event || {};
        const date = new Date(event.time_utc || event.time_iso || '');
        // No result or no trustworthy event timestamp: leave the order untouched.
        if (!d.number || !latest.status || latest.status === 'NotFound' || !Number.isFinite(date.getTime())) return res.status(200).json({code:200});
        const time = date.toISOString().slice(0,19).replace('T',' ');
        const mapped = mappedStatus(latest.status);
        // Single atomic statement serializes manual overrides and duplicate/out-of-order pushes.
        await db.query(`UPDATE orders o JOIN order_tracking17 t ON t.order_id=o.order_id
            SET o.order_status=CASE WHEN t.auto_sync=1 AND ? IS NOT NULL
                AND o.order_status NOT IN ('delivered','cancelled')
                AND NOT (o.order_status='shipped' AND ?='processing') THEN ? ELSE o.order_status END,
            t.courier_status=?, t.courier_detail=?, t.event_time=?, t.updated_at=UTC_TIMESTAMP()
            WHERE t.provider='17track' AND t.tracking_number=? AND o.tracking_number=t.tracking_number
            AND (t.event_time IS NULL OR t.event_time < ?)`,
            [mapped,mapped,mapped,latest.status,String(event.description || latest.sub_status || '').slice(0,1000),time,d.number,time]);
        if (['shipped','delivered'].includes(mapped)) {
            // Unique (order,status) prevents duplicate webhook emails. Preserve event identity.
            await db.query(`INSERT IGNORE INTO order_status_mail (order_id,status)
                SELECT o.order_id,o.order_status FROM orders o JOIN order_tracking17 t ON t.order_id=o.order_id
                WHERE t.provider='17track' AND t.tracking_number=? AND o.tracking_number=t.tracking_number AND t.auto_sync=1
                AND t.event_time=? AND o.order_status=?`,[d.number,time,mapped]);
        }
        return res.status(200).json({code:200});
    } catch (e) { console.error('17TRACK webhook processing failed:', e.message); return res.sendStatus(500); }
}
const router = express.Router();
router.post('/', express.raw({type:'application/json',limit:'1mb'}), receive);
module.exports = {router, register, verify, mappedStatus};
