const express = require('express');
const router = express.Router();
const db = require('../../db'); // databse connection path
const multer = require('multer');
const { v2: cloudinary } = require('cloudinary');
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const { google } = require('googleapis');
require('dotenv').config();

// Cloudinary configuration
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: async (req, file) => {
    const isPdf = file.mimetype === 'application/pdf';
    return {
      folder: 'verification_documents',
      resource_type: isPdf ? 'raw' : 'image', 
      allowed_formats: ['jpg', 'jpeg', 'png', 'webp', 'pdf'],
      public_id: Date.now() + '-' + file.originalname.split('.')[0],
    };
  },
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowedMimeTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'application/pdf'];
        if (allowedMimeTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Shudhumatro chobi ba PDF file upload kora jabe!'));
        }
    }
});

// Upload route with Super Admin email notification (Fixed brackets here)
router.post('/api/profile/upload-documents', ensureActiveAdmin, upload.fields([
    { name: 'identity_file', maxCount: 1 },
    { name: 'trade_license_file', maxCount: 1 }
]), async (req, res) => {
    try {
        const userId = req.user.id;
        const { identity_type, identity_number, trade_license_number } = req.body;
        const insertedDocs = [];

        if (req.files && req.files['identity_file']) {
            const identityFile = req.files['identity_file'][0];
            const identityUrl = identityFile.path; 
            const docType = identity_type === 'passport' ? 'passport' : 'nid';

            await db.query(
                'INSERT INTO verification_doc (user_id, document_type, document_number, file_url) VALUES (?, ?, ?, ?)',
                [userId, docType, identity_number || '', identityUrl]
            );
            insertedDocs.push(docType);
        }

        if (req.files && req.files['trade_license_file']) {
            const tradeFile = req.files['trade_license_file'][0];
            const tradeUrl = tradeFile.path;

            await db.query(
                'INSERT INTO verification_doc (user_id, document_type, document_number, file_url) VALUES (?, ?, ?, ?)',
                [userId, 'trade_license', trade_license_number || '', tradeUrl]
            );
            insertedDocs.push('trade_license');
        }

        if (insertedDocs.length === 0) {
            return res.status(400).json({ success: false, message: "Kono file select kora hoyni!" });
        }

        // User-er details ber kora jara document upload korlo
        const [users] = await db.query('SELECT name, email, shop_name FROM admins WHERE id = ?', [userId]);
        const uploader = users[0] || {};

        // Super Admin khuje ber kora jar super_admin column 'approved' ache
        const [superAdmins] = await db.query("SELECT email, name FROM admins WHERE super_admin = 'approved'");

        if (superAdmins && superAdmins.length > 0) {
            const oauth2Client = new google.auth.OAuth2(
                process.env.GOOGLE_USER_CLIENT_ID,
                process.env.GOOGLE_USER_CLIENT_SECRET,
                process.env.GOOGLE_OAUTH_REDIRECT_URI
            );

            oauth2Client.setCredentials({
                refresh_token: process.env.GOOGLE_REFRESH_TOKEN
            });

            const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

            for (const sAdmin of superAdmins) {
                if (sAdmin.email) {
                    const subject = `New Document Verification Submission from ${uploader.shop_name || 'Seller'} 📄`;
                    const htmlContent = `
                        <div style="font-family: Arial, sans-serif; padding: 20px; background-color: #f8fafc; border-radius: 8px;">
                            <h2 style="color: #0f172a;">New Verification Request</h2>
                            <p>Hello <b>${sAdmin.name || 'Super Admin'}</b>,</p>
                            <p>A seller has submitted new verification documents for review.</p>
                            <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 15px 0;" />
                            <p><b>Seller Name:</b> ${uploader.name || 'N/A'}</p>
                            <p><b>Shop Name:</b> ${uploader.shop_name || 'N/A'}</p>
                            <p><b>Email:</b> ${uploader.email || 'N/A'}</p>
                            <p><b>Submitted Documents:</b> ${insertedDocs.join(', ').toUpperCase()}</p>
                            <p style="margin-top: 20px;">Please login to the Super Admin panel to review and approve/reject these documents.</p>
                            <p style="color: #64748b; font-size: 12px; margin-top: 30px;">NexKart Automated Notification System</p>
                        </div>
                    `;

                    const utf8Subject = `=?utf-8?B?${Buffer.from(subject).toString('base64')}?=`;
                    const messageParts = [
                        `To: ${sAdmin.email}`,
                        `Subject: ${utf8Subject}`,
                        'MIME-Version: 1.0',
                        'Content-Type: text/html; charset=utf-8',
                        '',
                        htmlContent,
                    ];
                    const message = messageParts.join('\n');
                    const encodedMessage = Buffer.from(message)
                        .toString('base64')
                        .replace(/\+/g, '-')
                        .replace(/\//g, '_')
                        .replace(/=+$/, '');

                    await gmail.users.messages.send({
                        userId: 'me',
                        requestBody: { raw: encodedMessage },
                    });
                }
            }
        }

        res.status(200).json({
            success: true,
            message: "Documents successfully uploaded and notification sent to approved super admin(s)!"
        });

    } catch (err) {
        console.error('Document Upload & Mail Error:', err);
        res.status(500).json({ success: false, message: err.message || "Server error!" });
    }
});

router.get('/api/profile/documents', ensureActiveAdmin, async (req, res) => {
    try {
        const userId = req.user.id;
        const [documents] = await db.query(
            'SELECT id, document_type, document_number, file_url, status, created_at FROM verification_doc WHERE user_id = ? ORDER BY id DESC',
            [userId]
        );
        res.status(200).json({ success: true, data: documents });
    } catch (err) {
        console.error('Fetch Documents Error:', err);
        res.status(500).json({ success: false, message: "Server error!" });
    }
});

function ensureActiveAdmin(req, res, next) {
    if (req.isAuthenticated && req.isAuthenticated() && req.user.status === 'approved') {
        return next();
    }
    res.status(401).json({ success: false, message: "Unauthorized." });
}

module.exports = router;