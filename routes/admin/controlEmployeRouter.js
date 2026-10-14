const express = require('express');
const router = express.Router();
const db = require('../../db');
const { google } = require('googleapis');

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

// Permanent Suspension & Product Deletion with Google API Email Notification
router.post('/suspend-and-delete-admin', async (req, res) => {
    try {
        const { id } = req.body;
        if (!id) {
            return res.status(400).json({ success: false, message: 'Admin ID is required.' });
        }

        // 1. Fetch current admin details
        const [adminRows] = await db.query(`SELECT * FROM admins WHERE id = ?`, [id]);
        if (!adminRows || adminRows.length === 0) {
            return res.status(404).json({ success: false, message: 'Admin record not found.' });
        }

        const seller = adminRows[0];
        const sellerEmail = seller.email;

        // 2. Delete products where admin_id matches
        await db.query(`DELETE FROM products WHERE admin_id = ?`, [id]);

        // 3. Clear fields in admins table
        const resetQuery = `
            UPDATE admins 
            SET 
                name = NULL, email = NULL, password = NULL, picture = NULL,
                role = NULL, parent_admin_id = NULL, shop_name = NULL, phone = NULL,
                address = NULL, facebook_link = NULL, slogan = NULL, shop_about = NULL,
                payment_type = 'none', mobile_number = NULL, bank_acc_name = NULL,
                bank_acc_number = NULL, bank_name = NULL, bank_branch = NULL,
                routing_number = NULL, status = 'rejected', is_verified = 0,
                super_admin = 'pending', verification_code = NULL, temp_data = NULL,
                verification_doc = NULL, total_sales = 0.00, total_withdraw = 0.00,
                delete_requested_at = NULL, is_deletion_pending = 0,
                deletion_requested_at = NULL, action = 'suspended'
            WHERE id = ?
        `;
        await db.query(resetQuery, [id]);

        // 4. Send Email via Google REST API
        if (sellerEmail) {
            try {
                const rawEmail = createRawEmail({
                    to: sellerEmail,
                    from: process.env.GMAIL_USER || 'admin.nexkartbd@gmail.com',
                    subject: 'Account Permanently Suspended - Policy Violation',
                    message: `Dear User,\n\nYour account has been permanently suspended due to policy violations.`,
                    html: `
                        <div style="font-family: Arial, sans-serif; padding: 20px; color: #333;">
                            <h2 style="color: #dc2626;">Account Permanent Suspension Notice</h2>
                            <p>Dear User,</p>
                            <p>Your seller account has been <strong>permanently suspended and cleared</strong> due to policy/violence violations.</p>
                            <p>All products linked to your account have been deleted from our system.</p>
                            <br/>
                            <p>Regards,<br/><strong>NexKart Support Team</strong></p>
                        </div>
                    `
                });

                const response = await gmail.users.messages.send({
                    userId: 'me',
                    requestBody: {
                        raw: rawEmail
                    }
                });

                console.log('Google API Email sent successfully:', response.data.id);
            } catch (mailErr) {
                console.error('Error sending Google API mail:', mailErr.message);
            }
        }

        return res.status(200).json({ 
            success: true, 
            message: 'Seller account suspended, fields cleared, products deleted, and email notification sent via Google API.' 
        });

    } catch (error) {
        console.error('Error in suspend-and-delete-admin:', error);
        res.status(500).json({ success: false, message: error.message });
    }
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
 const raw=[`To: ${seller.email}`,`Subject: =?UTF-8?B?${Buffer.from(subject).toString('base64')}?=`,`MIME-Version: 1.0`,`Content-Type: text/html; charset=UTF-8`,`Content-Transfer-Encoding: base64`,'',Buffer.from(html).toString('base64')].join('\r\n');
 try{const response=await gmail.users.messages.send({userId:'me',requestBody:{raw:Buffer.from(raw).toString('base64url')}});return {sent:true,message_id:response.data.id};}catch(e){console.error('Management report Gmail notification failed:',e);return {sent:false,error:e.message};}
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

module.exports = router;