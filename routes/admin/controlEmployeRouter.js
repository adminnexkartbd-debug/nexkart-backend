const express = require('express');
const router = express.Router();
const db = require('../../db');
const { google } = require('googleapis');

// Download the official logo and embed it as an inline Gmail MIME image.
const NEXKART_LOGO_URL = 'https://res.cloudinary.com/yhctkgwj/image/upload/v1791893714/nexkart.png';
async function getNexkartInlineLogo() {
    const https = require('https');
    return new Promise((resolve, reject) => {
        const req = https.get(NEXKART_LOGO_URL, {timeout: 7000}, res => {
            if (res.statusCode !== 200) { res.resume(); return reject(new Error('Logo HTTP '+res.statusCode)); }
            const parts = []; let size = 0;
            res.on('data', part => { size += part.length; if (size > 1024*1024) { req.destroy(new Error('Logo too large')); return; } parts.push(part); });
            res.on('end', () => resolve(Buffer.concat(parts)));
            res.on('error', reject);
        });
        req.on('timeout', () => req.destroy(new Error('Logo request timeout')));
        req.on('error', reject);
    });
}
function makeNexkartGmailMime(to, subject, plain, html, logo) {
    const boundary = 'nexkart-related-' + require('crypto').randomBytes(12).toString('hex');
    const alt = 'nexkart-alt-' + require('crypto').randomBytes(12).toString('hex');
    const cid = 'nexkart-logo@nexkartbd.com';
    const content = logo ? html.replaceAll(NEXKART_LOGO_URL, 'cid:' + cid) : html;
    const mime = [
        `To: ${String(to).replace(/[\r\n]/g, '')}`,
        `Subject: =?UTF-8?B?${Buffer.from(subject, 'utf8').toString('base64')}?=`,
        'MIME-Version: 1.0',
        `Content-Type: multipart/related; boundary="${boundary}"`, '',
        `--${boundary}`, `Content-Type: multipart/alternative; boundary="${alt}"`, '',
        `--${alt}`, 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', Buffer.from(plain, 'utf8').toString('base64'),
        `--${alt}`, 'Content-Type: text/html; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', Buffer.from(content, 'utf8').toString('base64'),
        `--${alt}--`
    ];
    if (logo) mime.push(`--${boundary}`, 'Content-Type: image/png; name="nexkart.png"', 'Content-Transfer-Encoding: base64', `Content-ID: <${cid}>`, 'Content-Disposition: inline; filename="nexkart.png"', '', logo.toString('base64'));
    mime.push(`--${boundary}--`);
    return Buffer.from(mime.join('\r\n'), 'utf8').toString('base64url');
}


// Google OAuth2 Client Setup
const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID || '',
    process.env.GOOGLE_CLIENT_SECRET || '',
    process.env.GOOGLE_REDIRECT_URI || 'https://developers.google.com/oauthplayground'
);

// Set Refresh Token from Environment Variable
oauth2Client.setCredentials({
    refresh_token: process.env.GOOGLE_REFRESH_TOKEN || ''
});

const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

// Helper Function: MIME Email Create & Encode (HTTP API Format)
function createRawEmail({ to, from, subject, message, html }) {
    const str = [
        `From: ${from}`,
        `To: ${to}`,
        `Subject: ${subject}`,
        `MIME-Version: 1.0`,
        `Content-Type: multipart/alternative; boundary="boundary123"`,
        ``,
        `--boundary123`,
        `Content-Type: text/plain; charset=utf-8`,
        ``,
        message,
        ``,
        `--boundary123`,
        `Content-Type: text/html; charset=utf-8`,
        ``,
        html,
        ``,
        `--boundary123--`
    ].join('\r\n');

    return Buffer.from(str)
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
}

// Verify PIN
router.post('/verify-pin', async (req, res) => {
    try {
        const { pin } = req.body;
        if (pin === undefined || pin === null || pin === '') {
            return res.status(400).json({ success: false, message: 'Pin number is required.' });
        }
        const query = `SELECT secreat_code_admin FROM secreat LIMIT 1`;
        const [results] = await db.query(query);

        if (!results || results.length === 0) {
            return res.status(404).json({ success: false, message: 'Secret code configuration not found in database.' });
        }

        const dbPin = Number(results[0].secreat_code_admin);
        const userPin = Number(pin);

        if (dbPin === userPin) {
            if (req.session) {
                req.session.pinVerified = true;
            }
            return res.status(200).json({ success: true, message: 'Pin verified successfully.' });
        } else {
            return res.status(401).json({ success: false, message: 'Incorrect pin number. Please try again.' });
        }
    } catch (error) {
        console.error('Server error in /verify-pin:', error);
        res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
});

// Get Commission Rate
router.get('/get-commission', async (req, res) => {
    try {
        const [results] = await db.query(`SELECT commission_rate FROM commission WHERE id = 1 LIMIT 1`);
        if (!results || results.length === 0) {
            return res.status(404).json({ success: false, message: 'Commission rate not found.' });
        }
        res.status(200).json({ success: true, rate: Number(results[0].commission_rate) });
    } catch (error) {
        console.error('Error fetching commission:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Update Commission Rate
router.post('/update-commission', async (req, res) => {
    try {
        const { rate } = req.body;
        if (rate === undefined || rate === null || rate === '') {
            return res.status(400).json({ success: false, message: 'Commission rate is required.' });
        }
        const numericRate = Number(rate);
        if (!['string', 'number'].includes(typeof rate) || String(rate).trim() === '' || !Number.isFinite(numericRate) || numericRate < 0 || numericRate > 100) {
            return res.status(400).json({ success: false, message: 'Commission rate must be a number between 0 and 100.' });
        }
        const [existing] = await db.query('SELECT id FROM commission WHERE id = 1 LIMIT 1');
        if (!existing.length) {
            return res.status(404).json({ success: false, message: 'Commission configuration row (id 1) not found.' });
        }
        await db.query(`UPDATE commission SET commission_rate = ? WHERE id = 1`, [numericRate]);
        const [saved] = await db.query('SELECT commission_rate FROM commission WHERE id = 1 LIMIT 1');
        if (!saved.length) return res.status(404).json({ success: false, message: 'Commission configuration row no longer exists.' });
        res.status(200).json({ success: true, rate: Number(saved[0].commission_rate), message: 'Commission rate updated successfully.' });
    } catch (error) {
        console.error('Error updating commission:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Get Registered Users
router.get('/get-users', async (req, res) => {
    try {
        const [results] = await db.query(`SELECT id, name, created_at, email, phone_number, password FROM users`);
        res.status(200).json({ success: true, users: results });
    } catch (error) {
        console.error('Error fetching users:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Get All Sellers
router.get('/get-sellers', async (req, res) => {
    try {
        const query = `
            SELECT 
                id, name, email, shop_name, phone AS phone_number, password, is_verified, super_admin,
                COALESCE(total_sales, 0) AS total_sale,
                COALESCE(total_withdraw, 0) AS total_withdraw
            FROM admins 
            WHERE role = 'seller'
        `;
        const [results] = await db.query(query);
        res.status(200).json({ success: true, sellers: results });
    } catch (error) {
        console.error('Error fetching sellers:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Update Seller Status
router.post('/update-seller-status', async (req, res) => {
    try {
        const { id, super_admin } = req.body;
        if (!id || !super_admin) {
            return res.status(400).json({ success: false, message: 'Seller ID and status are required.' });
        }
        await db.query(`UPDATE admins SET super_admin = ? WHERE id = ?`, [super_admin, id]);
        res.status(200).json({ success: true, message: 'Seller super admin status updated successfully.' });
    } catch (error) {
        console.error('Error updating seller status:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Get Pending Seller Requests
router.get('/get-pending-requests', async (req, res) => {
    try {
        const query = `SELECT * FROM admins WHERE status = 'pending'`;
        const [results] = await db.query(query);
        res.status(200).json({ success: true, requests: results });
    } catch (error) {
        console.error('Error fetching pending requests:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Delete Seller Request
router.post('/delete-request', async (req, res) => {
    try {
        const { id } = req.body;
        if (!id) {
            return res.status(400).json({ success: false, message: 'Seller ID is required.' });
        }
        await db.query(`DELETE FROM admins WHERE id = ?`, [id]);
        res.status(200).json({ success: true, message: 'Seller request deleted successfully.' });
    } catch (error) {
        console.error('Error deleting seller request:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Get All Admins Data
router.get('/get-all-admins', async (req, res) => {
    try {
        const [results] = await db.query(`SELECT * FROM admins`);
        res.status(200).json({ success: true, admins: results });
    } catch (error) {
        console.error('Error fetching all admins:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Seller account deletion: PIN-gated, transactional DB cleanup, optional Cloudinary cleanup.
const deleteSellerId = value => Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : null;
const quoteDeleteCol = name => '`' + name.replace(/`/g, '``') + '`';
async function deleteTableColumns(conn, table) {
    const [rows] = await conn.query('SHOW COLUMNS FROM ' + quoteDeleteCol(table));
    return rows.map(row => row.Field);
}
function cloudinaryPublicId(url) {
    try {
        const parsed = new URL(url);
        if (parsed.hostname !== 'res.cloudinary.com') return null;
        const match = parsed.pathname.match(/^\/([^/]+)\/(image|video|raw)\/upload\/(?:v\d+\/)?(.+)$/);
        if (!match || match[1] !== process.env.CLOUDINARY_CLOUD_NAME) return null;
        return {resource_type:match[2], public_id:decodeURIComponent(match[3]).replace(/\.[^/.]+$/, '')};
    } catch (_) { return null; }
}
router.post('/suspend-and-delete-admin', async (req, res) => {
    if (!req.session || req.session.pinVerified !== true) return res.status(403).json({success:false,message:'Verify admin PIN first.'});
    const id = deleteSellerId(req.body && req.body.id);
    if (!id || req.body.confirm !== 'DELETE SELLER') return res.status(400).json({success:false,message:'Seller ID and deletion confirmation required.'});
    let conn;
    let seller;
    let deletedCount = 0;
    let imageRowsDeleted = 0;
    const imageUrls = new Set();
    try {
        conn = await db.getConnection();
        await conn.beginTransaction();
        const [admins] = await conn.query('SELECT * FROM admins WHERE id=? FOR UPDATE',[id]);
        if (!admins.length) { await conn.rollback(); return res.status(404).json({success:false,message:'Seller not found.'}); }
        seller = admins[0];
        if (seller.role !== 'seller' || seller.action === 'suspended') { await conn.rollback(); return res.status(400).json({success:false,message:'Only active seller accounts may be deleted.'}); }
        const [products] = await conn.query('SELECT * FROM products WHERE admin_id=? FOR UPDATE',[id]);
        deletedCount = products.length;
        const ids = products.map(product => product.id);
        const candidateUrl = (key,value) => {
            if (typeof value !== 'string' || !/(image|photo|thumbnail|gallery|picture|url)/i.test(key)) return;
            const urls = value.match(/https?:\/\/[^\s"'<>\\]+/g) || [];
            urls.forEach(url => imageUrls.add(url.replace(/[),\]]+$/, '')));
        };
        products.forEach(product => Object.entries(product).forEach(([key,value]) => candidateUrl(key,value)));
        if (ids.length) {
            // Delete only product media and variants; never erase orders, financial records or reviews to force deletion.
            for (const table of ['product_images','product_variants']) {
                const cols = await deleteTableColumns(conn,table);
                const fk = cols.includes('product_id') ? 'product_id' : null;
                if (!fk) throw new Error(table+' has no product_id column; deletion aborted safely.');
                const [media] = await conn.query('SELECT * FROM '+quoteDeleteCol(table)+' WHERE '+quoteDeleteCol(fk)+' IN (?)',[ids]);
                media.forEach(record => Object.entries(record).forEach(([key,value]) => candidateUrl(key,value)));
                const [removed] = await conn.query('DELETE FROM '+quoteDeleteCol(table)+' WHERE '+quoteDeleteCol(fk)+' IN (?)',[ids]);
                if (table === 'product_images') imageRowsDeleted = removed.affectedRows;
            }
            // A foreign key from orders/reports/reviews can block this DELETE. In that case roll back everything.
            await conn.query('DELETE FROM products WHERE admin_id=?',[id]);
        }
        // Respect the actual admins schema: do not assign NULL to NOT NULL fields.
        // Keep the row and Google ID for audit; never wipe required fields blindly.
        const [adminColumns] = await conn.query('SHOW COLUMNS FROM `admins`');
        const nullable = new Map(adminColumns.map(c => [c.Field, c.Null === 'YES']));
        const clearFields = ['email','password','picture','role','parent_admin_id',
            'shop_name','phone','address','facebook_link','slogan','shop_about',
            'mobile_number','bank_acc_name','bank_acc_number','bank_name','bank_branch',
            'routing_number','verification_code','temp_data','verification_doc',
            'delete_requested_at','deletion_requested_at'];
        const assignments = ['`name`=?'];
        const values = ['Deleted Seller'];
        for (const field of clearFields) {
            if (nullable.get(field) === true) {
                assignments.push('`' + field + '`=NULL');
            }
            // Required columns are preserved rather than causing ER_BAD_NULL_ERROR.
        }
        const fixed = {
            payment_type: 'none', status: 'rejected', is_verified: 0,
            super_admin: 'pending', total_sales: 0, total_withdraw: 0,
            is_deletion_pending: 0, action: 'suspended'
        };
        for (const [field, value] of Object.entries(fixed)) {
            if (nullable.has(field)) {
                assignments.push('`' + field + '`=?');
                values.push(value);
            }
        }
        values.push(id);
        const [result] = await conn.query(
            'UPDATE `admins` SET ' + assignments.join(', ') + ' WHERE `id`=?', values
        );
        if (result.affectedRows !== 1) throw new Error('Seller account update failed');
        await conn.commit();
    } catch (err) {
        if (conn) try { await conn.rollback(); } catch (_) {}
        console.error('Seller deletion failed:',err);
        const related = err.code === 'ER_ROW_IS_REFERENCED_2' || err.code === 'ER_ROW_IS_REFERENCED';
        return res.status(related?409:500).json({success:false,message:related?'Orders, reviews or other linked records prevent deleting products. No database changes were made.':err.message});
    } finally { if (conn) conn.release(); }
    // External image deletion happens only AFTER DB commit; external services cannot join MySQL transactions.
    const cloudinary = {deleted:0,failed:[],skipped:0};
    if (imageUrls.size) {
        if (process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET) {
            try {
                const {v2:cloud} = require('cloudinary');
                cloud.config({cloud_name:process.env.CLOUDINARY_CLOUD_NAME,api_key:process.env.CLOUDINARY_API_KEY,api_secret:process.env.CLOUDINARY_API_SECRET});
                for (const url of imageUrls) {
                    const info = cloudinaryPublicId(url);
                    if (!info) {cloudinary.skipped++;continue;}
                    try {
                        const result = await cloud.uploader.destroy(info.public_id,{resource_type:info.resource_type,invalidate:true});
                        if (result.result === 'ok' || result.result === 'not found') cloudinary.deleted++;
                        else cloudinary.failed.push({url,error:result.result});
                    } catch(e) {cloudinary.failed.push({url,error:e.message});}
                }
            } catch(e) {cloudinary.failed.push({error:e.message});}
        } else cloudinary.skipped = imageUrls.size;
    }
    // Notify the original seller address captured before account data was cleared.
    // Use only the existing Google Gmail OAuth2 API client.
    let emailSent = false;
    let emailError = null;
    if (seller.email) {
        try {
            const escapeHtml = value => String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
            const supportEmail = process.env.GMAIL_USER || 'admin.nexkartbd@gmail.com';
            const sellerName = escapeHtml(seller.name || seller.shop_name || 'Seller');
            const shopName = escapeHtml(seller.shop_name || 'Your Store');
            const safeSupportEmail = escapeHtml(supportEmail);
            const subject = 'NexkartBD | Seller Account Closure Confirmation';
            const plain = `Hello ${seller.name || 'Seller'},\n\nYour NexkartBD seller account has been closed following an administrative action.\nStore: ${seller.shop_name || 'Your Store'}\nProducts removed: ${deletedCount}\n\nIf you need assistance or believe this action requires review, contact ${supportEmail}.\n\nNexkartBD Support Team`;
            const html = `<!DOCTYPE html><html><body style="margin:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;color:#0f172a"><div style="padding:35px 12px"><div style="max-width:580px;margin:auto;background:#fff;border-radius:18px;overflow:hidden;border:1px solid #e2e8f0"><div style="background:#0f172a;padding:28px;text-align:center"><img src="https://res.cloudinary.com/yhctkgwj/image/upload/v1791893714/nexkart.png" alt="NexkartBD" style="max-width:185px;max-height:65px"><div style="color:#cbd5e1;font-size:12px;margin-top:12px;letter-spacing:1px">ACCOUNT NOTIFICATION</div></div><div style="padding:32px 28px"><div style="display:inline-block;background:#fef2f2;color:#b91c1c;padding:7px 12px;border-radius:20px;font-size:12px;font-weight:bold">ACCOUNT CLOSED</div><h1 style="font-size:25px;line-height:1.3;margin:18px 0 14px">Seller account closure confirmation</h1><p style="color:#475569;line-height:1.8">Hello <strong>${sellerName}</strong>,</p><p style="color:#475569;line-height:1.8">We are writing to confirm that your NexkartBD seller account has been closed following an administrative action. The products associated with this account have been removed from our catalog.</p><div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:20px;margin:24px 0"><div style="color:#64748b;font-size:12px">STORE</div><div style="font-weight:bold;margin:5px 0 16px">${shopName}</div><div style="color:#64748b;font-size:12px">PRODUCTS REMOVED</div><div style="font-size:26px;font-weight:bold;margin-top:5px">${deletedCount}</div></div><h2 style="font-size:17px">Need help or a review?</h2><p style="color:#475569;line-height:1.7">If you have questions or believe this decision needs review, please contact our support team. Include your registered seller email so we can locate your account.</p><div style="text-align:center;margin:24px 0"><a href="mailto:${safeSupportEmail}?subject=NexkartBD%20Seller%20Account%20Support" style="background:#4f46e5;color:#fff;text-decoration:none;padding:14px 24px;border-radius:10px;display:inline-block;font-weight:bold">Contact Support</a></div><p style="font-size:13px;color:#64748b">Or email us at <a href="mailto:${safeSupportEmail}" style="color:#4f46e5">${safeSupportEmail}</a>.</p><p style="margin-top:28px;color:#475569">Regards,<br><strong>NexkartBD Support Team</strong></p></div><div style="background:#f8fafc;padding:16px 28px;text-align:center;font-size:12px;color:#64748b">NexkartBD • Seller Account Notification</div></div></div></body></html>`;
            let logo = null;
            try { logo = await getNexkartInlineLogo(); }
            catch (e) { console.warn('Inline logo unavailable; using remote image URL:', e.message); }
            const raw = makeNexkartGmailMime(seller.email, subject, plain, html, logo);
            const result = await gmail.users.messages.send({userId:'me',requestBody:{raw}});
            emailSent = !!(result.data && result.data.id);
            if (!emailSent) emailError = 'Gmail API returned no message ID';
        } catch (err) {
            emailError = err.message;
            console.error('Seller closure Gmail failed:', err);
        }
    } else emailError = 'Seller email address unavailable';
    res.json({success:true,message:'Seller suspended and products deleted from database.',products_deleted:deletedCount,image_records_deleted:imageRowsDeleted,cloudinary,email_sent:emailSent,email_error:emailError});
});

// Management Report: transactional product snapshot dump/release.
// The archive table must be installed from management_report.sql first.
const mrAuth=(req,res,next)=>{if(!req.session||req.session.pinVerified!==true)return res.status(403).json({success:false,message:'Admin PIN verification required.'});next();};
const mrId=x=>Number.isSafeInteger(Number(x))&&Number(x)>0?Number(x):null;
router.get('/management-report',mrAuth,async(req,res)=>{
 try{const mode=req.query.mode==='dump'?'dump':'live';const q=String(req.query.q||'').trim().slice(0,150);const like='%'+q+'%';
 let rows;
 if(mode==='live'){
 const [data]=await db.query(`SELECT p.*, a.name AS seller_name,a.shop_name,a.email,a.phone FROM products p LEFT JOIN admins a ON a.id=p.admin_id WHERE (?='' OR CAST(p.id AS CHAR)=? OR CAST(p.admin_id AS CHAR)=? OR a.email LIKE ? OR a.name LIKE ? OR a.shop_name LIKE ?) ORDER BY p.id DESC LIMIT 200`,[q,q,q,like,like,like]);
 rows=data.map(p=>({product_id:p.id,seller_id:p.admin_id,title:p.name||p.title||p.product_name||('Product #'+p.id),seller_name:p.seller_name,shop_name:p.shop_name,email:p.email,phone:p.phone}));
 }else{
 const [data]=await db.query(`SELECT d.id AS product_id,d.admin_id AS seller_id,d.dumped_at,d.title AS archived_title,a.name AS seller_name,a.shop_name,a.email,a.phone FROM management_product_dump_full d LEFT JOIN admins a ON a.id=d.admin_id WHERE (?='' OR CAST(d.id AS CHAR)=? OR CAST(d.admin_id AS CHAR)=? OR a.email LIKE ? OR a.name LIKE ? OR a.shop_name LIKE ?) ORDER BY d.dumped_at DESC LIMIT 200`,[q,q,q,like,like,like]);
 rows=data.map(p=>{return {product_id:p.product_id,seller_id:p.seller_id,title:p.archived_title||('Product #'+p.product_id),seller_name:p.seller_name,shop_name:p.shop_name,email:p.email,phone:p.phone,dumped_at:p.dumped_at};});
 }
 res.json({success:true,rows});}catch(e){console.error('management-report:',e);res.status(500).json({success:false,message:e.message});}
});
// Product Reports: only the admin PIN-verified session can review reports.
router.get('/product-reports-management',mrAuth,async(req,res)=>{
 try{const q=String(req.query.q||'').trim().slice(0,120),like='%'+q+'%';
 const [rows]=await db.query(`SELECT r.id,r.product_id,r.seller_id,r.user_id,r.reason,r.details,r.status,r.created_at,r.updated_at,p.title AS product_title,a.name AS seller_name,a.shop_name,a.email AS seller_email,a.phone AS seller_phone FROM product_reports r LEFT JOIN products p ON p.id=r.product_id LEFT JOIN admins a ON a.id=r.seller_id WHERE (?='' OR CAST(r.id AS CHAR)=? OR CAST(r.product_id AS CHAR)=? OR CAST(r.seller_id AS CHAR)=? OR a.email LIKE ? OR a.name LIKE ? OR r.reason LIKE ?) ORDER BY r.created_at DESC LIMIT 200`,[q,q,q,q,like,like,like]);
 res.json({success:true,rows});}catch(e){console.error('product reports:',e);res.status(500).json({success:false,message:e.message});}
});
router.post('/product-reports-management/status',mrAuth,async(req,res)=>{
 try{const id=mrId(req.body&&req.body.id),status=String(req.body&&req.body.status||'');
 if(!id||!['pending','rejected','resolved'].includes(status))return res.status(400).json({success:false,message:'Invalid report or status'});
 const [result]=await db.query('UPDATE product_reports SET status=?,updated_at=NOW() WHERE id=?',[status,id]);
 if(!result.affectedRows)return res.status(404).json({success:false,message:'Report not found'});
 res.json({success:true,status});}catch(e){console.error('report status:',e);res.status(500).json({success:false,message:e.message});}
});
function mrMailEsc(x){return String(x==null?'':x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
async function mrNotifySeller(seller,action,count){
 if(!seller||!seller.email)return {sent:false,error:'Seller email unavailable'};
 const released=action.startsWith('release'),subject=released?'Your NexkartBD products have been restored':'Important update about your NexkartBD products';
 const heading=released?'Your products are live again':'Your products have been temporarily removed';
 const body=released?`We have restored ${count} product(s) to your store. They are now available again, subject to their existing publication status.`:`We have temporarily removed ${count} product(s) from the live catalog. Your product information has been safely archived and can be restored by our management team.`;
 const html=`<div style="background:#f1f5f9;padding:32px 12px;font-family:Arial,sans-serif;color:#0f172a"><div style="max-width:560px;margin:auto;background:white;border-radius:18px;overflow:hidden;box-shadow:0 8px 30px #0001"><div style="background:#0f172a;text-align:center;padding:26px"><img src="https://res.cloudinary.com/yhctkgwj/image/upload/v1791893714/nexkart.png" alt="NexkartBD" style="max-height:64px;max-width:190px"><div style="color:#cbd5e1;font-size:13px;margin-top:8px">Seller Management Notification</div></div><div style="padding:30px"><div style="font-size:13px;font-weight:bold;color:${released?'#059669':'#d97706'}">${released?'PRODUCTS RESTORED':'PRODUCT MANAGEMENT UPDATE'}</div><h2 style="font-size:23px;margin:12px 0">${heading}</h2><p>Hello ${mrMailEsc(seller.name||seller.shop_name||'Seller')},</p><p style="line-height:1.8;color:#475569">${body}</p><div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:18px;margin:20px 0"><strong>Products affected: ${count}</strong><br><span style="color:#64748b">Store: ${mrMailEsc(seller.shop_name||'NexkartBD Seller')}</span></div><p style="color:#64748b;font-size:13px">For questions, please contact NexkartBD support.</p><p>Regards,<br><strong>NexkartBD Team</strong></p></div></div></div>`;
 let logo = null; try { logo = await getNexkartInlineLogo(); } catch(e) { console.warn('Inline logo unavailable:',e.message); }
 const raw=makeNexkartGmailMime(seller.email,subject,body,html,logo);
 try{const response=await gmail.users.messages.send({userId:'me',requestBody:{raw}});return {sent:true,message_id:response.data.id};}catch(e){console.error('Management report Gmail notification failed:',e);return {sent:false,error:e.message};}
}
router.post('/management-report/action',mrAuth,async(req,res)=>{
 const {action}=req.body||{};const id=mrId(req.body&&req.body.id);if(!id||!['dump-product','dump-seller','release-product','release-seller'].includes(action))return res.status(400).json({success:false,message:'Invalid action or ID'});
 let conn;try{
 conn=await db.getConnection();await conn.beginTransaction();
 const isSeller=action.endsWith('seller'),isDump=action.startsWith('dump');
 if(isDump){
 const [products]=await conn.query(`SELECT * FROM products WHERE ${isSeller?'admin_id':'id'}=? FOR UPDATE`,[id]);
 if(!products.length){await conn.rollback();return res.status(404).json({success:false,message:'No live products found'});}
 // Archive all 36 columns using the same SQL types as products, no JSON conversion.
 const [schema]=await conn.query('SHOW COLUMNS FROM products');
 const cols=schema.map(c=>c.Field);
 const names=cols.map(c=>'`'+c.replace(/`/g,'``')+'`').join(',');
 const marks=cols.map(()=>'?').join(',');
 for(const p of products){await conn.query(`INSERT INTO management_product_dump_full (${names}) VALUES (${marks})`,cols.map(c=>p[c]));}
 const ids=products.map(p=>p.id);await conn.query('DELETE FROM products WHERE id IN (?)',[ids]);
 await conn.commit();const sellerIds=[...new Set(products.map(p=>p.admin_id))];const emails=[];for(const sid of sellerIds){try{const [sr]=await db.query('SELECT name,shop_name,email FROM admins WHERE id=? LIMIT 1',[sid]);emails.push({seller_id:sid,...await mrNotifySeller(sr[0],action,products.filter(p=>p.admin_id===sid).length)});}catch(e){emails.push({seller_id:sid,sent:false,error:e.message});}}return res.json({success:true,count:ids.length,emails});
 }
 const [dumped]=await conn.query(`SELECT * FROM management_product_dump_full WHERE ${isSeller?'admin_id':'id'}=? FOR UPDATE`,[id]);
 if(!dumped.length){await conn.rollback();return res.status(404).json({success:false,message:'No dumped products found'});}
 const [columns]=await conn.query('SHOW COLUMNS FROM products');const allowed=new Set(columns.map(c=>c.Field));
 for(const p of dumped){const keys=columns.map(c=>c.Field);if(!keys.includes('id'))throw Error('Product ID missing from archive');await conn.query(`INSERT INTO products (${keys.map(k=>'`'+k+'`').join(',')}) VALUES (${keys.map(()=>'?').join(',')})`,keys.map(k=>p[k]));}
 await conn.query(`DELETE FROM management_product_dump_full WHERE ${isSeller?'admin_id':'id'}=?`,[id]);await conn.commit();const sellerIds=[...new Set(dumped.map(p=>p.admin_id))];const emails=[];for(const sid of sellerIds){try{const [sr]=await db.query('SELECT name,shop_name,email FROM admins WHERE id=? LIMIT 1',[sid]);emails.push({seller_id:sid,...await mrNotifySeller(sr[0],action,dumped.filter(p=>p.admin_id===sid).length)});}catch(e){emails.push({seller_id:sid,sent:false,error:e.message});}}res.json({success:true,count:dumped.length,emails});
 }catch(e){if(conn)try{await conn.rollback();}catch(_){}console.error('management-report action:',e);res.status(500).json({success:false,message:e.code==='ER_ROW_IS_REFERENCED_2'?'Related product records prevent physical dump. Nothing was changed.':e.message});}finally{if(conn)conn.release();}
});

// Offer banner management shares the existing Control Employee PIN session.
router.use('/offer-banners', require('./offerBannersRouter'));

module.exports = router;