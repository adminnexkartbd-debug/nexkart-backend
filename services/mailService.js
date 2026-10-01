const cron = require('node-cron');
const https = require('https');
const db = require('../db');

/**
 * NexKartBD Professional Mail Service
 *
 * Gmail SMTP password/SMTP App Password is NOT used here.
 * Sending is authenticated with Google OAuth2 using the refresh token.
 *
 * Required environment variables:
 *   EMAIL_USER
 *   GOOGLE_CLIENT_ID
 *   GOOGLE_CLIENT_SECRET
 *   GOOGLE_REFRESH_TOKEN
 *
 * Optional:
 *   GOOGLE_USER_CLIENT_ID
 *   GOOGLE_USER_CLIENT_SECRET
 *   GOOGLE_USER_REFRESH_TOKEN
 *   MAIL_FROM_NAME
 *   MAIL_SUPPORT_EMAIL
 *   APP_URL
 *
 * EMAIL_USER should normally be the Gmail/Google Workspace mailbox that
 * owns the OAuth refresh token (for example: admin.nexkartbd@gmail.com).
 */

const MAIL_USER = process.env.EMAIL_USER || 'admin.nexkartbd@gmail.com';
const GOOGLE_CLIENT_ID =
    process.env.GOOGLE_USER_CLIENT_ID ||
    process.env.GOOGLE_CLIENT_ID;

const GOOGLE_CLIENT_SECRET =
    process.env.GOOGLE_USER_CLIENT_SECRET ||
    process.env.GOOGLE_CLIENT_SECRET;

const GOOGLE_REFRESH_TOKEN =
    process.env.GOOGLE_USER_REFRESH_TOKEN ||
    process.env.GOOGLE_REFRESH_TOKEN;

const MAIL_FROM_NAME = process.env.MAIL_FROM_NAME || 'NexKartBD';
const SUPPORT_EMAIL = process.env.MAIL_SUPPORT_EMAIL || MAIL_USER;
const APP_URL = process.env.APP_URL || 'https://www.nexkartbd.com';

if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REFRESH_TOKEN) {
    console.warn(
        '[Mail Service] Google OAuth2 environment variables are missing. ' +
        'Emails will not be sent until GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_REFRESH_TOKEN are configured.'
    );
}

/**
 * Gmail API sender (OAuth2 over HTTPS).
 *
 * This intentionally does NOT use SMTP/Nodemailer. That avoids Gmail SMTP
 * connection timeouts on hosting platforms such as Render. The app obtains
 * an OAuth access token from the refresh token and sends through the Gmail
 * REST API over HTTPS/443.
 */
function httpsJsonRequest({ hostname, path, method = 'POST', headers = {}, body = '', timeout = 20000 }) {
    return new Promise((resolve, reject) => {
        const req = https.request({
            hostname,
            path,
            method,
            headers: {
                ...headers,
                'Content-Length': Buffer.byteLength(body)
            },
            family: 4,
            timeout
        }, res => {
            let data = '';
            res.setEncoding('utf8');
            res.on('data', chunk => { data += chunk; });
            res.on('end', () => {
                let parsed = null;
                try { parsed = data ? JSON.parse(data) : {}; } catch (_) {}

                if (res.statusCode >= 200 && res.statusCode < 300) {
                    resolve(parsed || {});
                    return;
                }

                const detail = parsed?.error?.message || parsed?.error_description || data || `HTTP ${res.statusCode}`;
                const error = new Error(`Google API ${res.statusCode}: ${detail}`);
                error.statusCode = res.statusCode;
                error.response = parsed;
                reject(error);
            });
        });

        req.on('timeout', () => {
            req.destroy(new Error('Google API connection timeout'));
        });
        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

let cachedAccessToken = null;
let cachedAccessTokenExpiresAt = 0;

async function getGoogleAccessToken() {
    if (cachedAccessToken && Date.now() < cachedAccessTokenExpiresAt - 60000) {
        return cachedAccessToken;
    }

    if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REFRESH_TOKEN) {
        throw new Error('Google OAuth credentials are missing in environment variables.');
    }

    const body = new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        refresh_token: GOOGLE_REFRESH_TOKEN,
        grant_type: 'refresh_token'
    }).toString();

    const token = await httpsJsonRequest({
        hostname: 'oauth2.googleapis.com',
        path: '/token',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Accept: 'application/json'
        },
        body,
        timeout: 20000
    });

    if (!token.access_token) {
        throw new Error('Google OAuth token response did not contain access_token.');
    }

    cachedAccessToken = token.access_token;
    cachedAccessTokenExpiresAt = Date.now() + Number(token.expires_in || 3600) * 1000;
    return cachedAccessToken;
}

function encodeMimeHeader(value) {
    return `=?UTF-8?B?${Buffer.from(String(value), 'utf8').toString('base64')}?=`;
}

function encodeBase64Url(value) {
    return Buffer.from(value)
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/g, '');
}

function htmlToPlainText(html) {
    return String(html || '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<br\s*\/?>(\r?\n)?/gi, '\n')
        .replace(/<\/(p|div|tr|h1|h2|h3|li)>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&#039;/g, "'")
        .replace(/&quot;/g, '"')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

async function sendGmailMessage({ to, subject, html, text }) {
    const accessToken = await getGoogleAccessToken();
    const plain = text || htmlToPlainText(html);
    const boundary = `NexKartBD_${Date.now()}_${Math.random().toString(36).slice(2)}`;

    const rawMessage = [
        `From: ${encodeMimeHeader(MAIL_FROM_NAME)} <${MAIL_USER}>`,
        `To: ${to}`,
        `Subject: ${encodeMimeHeader(subject)}`,
        'MIME-Version: 1.0',
        `Content-Type: multipart/alternative; boundary="${boundary}"`,
        '',
        `--${boundary}`,
        'Content-Type: text/plain; charset=UTF-8',
        'Content-Transfer-Encoding: 8bit',
        '',
        plain,
        '',
        `--${boundary}`,
        'Content-Type: text/html; charset=UTF-8',
        'Content-Transfer-Encoding: 8bit',
        '',
        html,
        '',
        `--${boundary}--`,
        ''
    ].join('\r\n');

    try {
        return await httpsJsonRequest({
            hostname: 'gmail.googleapis.com',
            path: '/gmail/v1/users/me/messages/send',
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
                Accept: 'application/json'
            },
            body: JSON.stringify({ raw: encodeBase64Url(rawMessage) }),
            timeout: 20000
        });
    } catch (error) {
        // If an access token expired/revoked between cache checks, refresh once.
        if (error.statusCode === 401) {
            cachedAccessToken = null;
            cachedAccessTokenExpiresAt = 0;
            const freshToken = await getGoogleAccessToken();
            return await httpsJsonRequest({
                hostname: 'gmail.googleapis.com',
                path: '/gmail/v1/users/me/messages/send',
                headers: {
                    Authorization: `Bearer ${freshToken}`,
                    'Content-Type': 'application/json',
                    Accept: 'application/json'
                },
                body: JSON.stringify({ raw: encodeBase64Url(rawMessage) }),
                timeout: 20000
            });
        }
        throw error;
    }
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function formatMoney(value) {
    const number = Number(value || 0);
    return number.toLocaleString('en-BD', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
}

function prettyPaymentMethod(value) {
    const method = String(value || 'Pending').toLowerCase();

    if (method === 'cod') return 'Cash on Delivery';
    if (method === 'bkash' || method === 'online') return 'bKash / Online Payment';

    return String(value || 'Pending')
        .replace(/[_-]+/g, ' ')
        .replace(/\b\w/g, char => char.toUpperCase());
}

function buildHeader(preheader) {
    return `
        <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">
            ${escapeHtml(preheader)}
        </div>

        <div style="background:#f4f7fb;padding:32px 12px;font-family:Arial,Helvetica,sans-serif;">
            <div style="max-width:680px;margin:0 auto;background:#ffffff;border:1px solid #e6ebf2;border-radius:16px;overflow:hidden;box-shadow:0 6px 24px rgba(15,23,42,.06);">
                <div style="padding:24px 28px;border-bottom:1px solid #edf1f5;">
                    <div style="font-size:24px;font-weight:800;color:#111827;letter-spacing:-.3px;">
                        NexKart<span style="color:#2563eb;">BD</span>
                    </div>
                    <div style="margin-top:5px;color:#64748b;font-size:13px;">
                        Your trusted online shopping destination
                    </div>
                </div>
    `;
}

function buildFooter() {
    return `
                <div style="padding:24px 28px;background:#f8fafc;border-top:1px solid #edf1f5;">
                    <p style="margin:0 0 8px;color:#334155;font-size:13px;">
                        Need help? Contact us at
                        <a href="mailto:${escapeHtml(SUPPORT_EMAIL)}" style="color:#2563eb;text-decoration:none;">
                            ${escapeHtml(SUPPORT_EMAIL)}
                        </a>
                    </p>
                    <p style="margin:0;color:#94a3b8;font-size:12px;line-height:1.6;">
                        This is an automated message from NexKartBD. Please do not reply if you do not recognize this order.
                    </p>
                    <p style="margin:10px 0 0;color:#94a3b8;font-size:12px;">
                        © ${new Date().getFullYear()} NexKartBD. All rights reserved.
                    </p>
                </div>
            </div>
        </div>
    `;
}

function buildOrderSummary(order, includeCustomerDetails = false) {
    const coupon = Number(order.coupon_discount || 0);
    const coin = Number(order.coin_discount || 0);
    const delivery = Number(order.delivery_charge || 0);
    const subtotal = Number(order.subtotal_price || 0);
    const total = Number(order.total_amount || 0);

    return `
        <div style="margin-top:22px;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;">
            <div style="padding:14px 16px;background:#f8fafc;border-bottom:1px solid #e5e7eb;">
                <div style="font-size:15px;font-weight:700;color:#111827;">Order Summary</div>
            </div>

            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
                <tr>
                    <td style="padding:11px 16px;color:#64748b;font-size:13px;">Order ID</td>
                    <td style="padding:11px 16px;text-align:right;color:#111827;font-weight:700;font-size:13px;">
                        ${escapeHtml(order.order_id)}
                    </td>
                </tr>
                <tr style="background:#fcfcfd;">
                    <td style="padding:11px 16px;color:#64748b;font-size:13px;">Quantity</td>
                    <td style="padding:11px 16px;text-align:right;color:#111827;font-size:13px;">
                        ${escapeHtml(order.quantity)}
                    </td>
                </tr>
                <tr>
                    <td style="padding:11px 16px;color:#64748b;font-size:13px;">Subtotal</td>
                    <td style="padding:11px 16px;text-align:right;color:#111827;font-size:13px;">
                        ৳${formatMoney(subtotal)}
                    </td>
                </tr>
                <tr style="background:#fcfcfd;">
                    <td style="padding:11px 16px;color:#64748b;font-size:13px;">Delivery Charge</td>
                    <td style="padding:11px 16px;text-align:right;color:#111827;font-size:13px;">
                        ৳${formatMoney(delivery)}
                    </td>
                </tr>
                ${coupon > 0 ? `
                <tr>
                    <td style="padding:11px 16px;color:#64748b;font-size:13px;">Coupon Discount</td>
                    <td style="padding:11px 16px;text-align:right;color:#15803d;font-size:13px;">
                        - ৳${formatMoney(coupon)}
                    </td>
                </tr>` : ''}
                ${coin > 0 ? `
                <tr style="background:#fcfcfd;">
                    <td style="padding:11px 16px;color:#64748b;font-size:13px;">Coin Discount</td>
                    <td style="padding:11px 16px;text-align:right;color:#15803d;font-size:13px;">
                        - ৳${formatMoney(coin)}
                    </td>
                </tr>` : ''}
                <tr>
                    <td style="padding:15px 16px;border-top:1px solid #e5e7eb;color:#111827;font-size:14px;font-weight:700;">
                        Total
                    </td>
                    <td style="padding:15px 16px;border-top:1px solid #e5e7eb;text-align:right;color:#2563eb;font-size:17px;font-weight:800;">
                        ৳${formatMoney(total)}
                    </td>
                </tr>
            </table>
        </div>

        ${includeCustomerDetails ? `
        <div style="margin-top:18px;border:1px solid #e5e7eb;border-radius:12px;padding:16px;">
            <div style="font-size:14px;font-weight:700;color:#111827;margin-bottom:10px;">Delivery Information</div>
            <div style="font-size:13px;line-height:1.8;color:#475569;">
                <strong style="color:#334155;">Name:</strong> ${escapeHtml(order.customer_name)}<br>
                <strong style="color:#334155;">Phone:</strong> ${escapeHtml(order.customer_phone)}<br>
                <strong style="color:#334155;">Address:</strong> ${escapeHtml(order.shipping_address)}
            </div>
        </div>` : ''}

        <div style="margin-top:18px;padding:14px 16px;background:#f8fafc;border-radius:10px;font-size:13px;color:#475569;">
            <strong style="color:#334155;">Payment:</strong>
            ${escapeHtml(prettyPaymentMethod(order.payment_method))}
        </div>
    `;
}

function buildSellerEmail(order) {
    return (
        buildHeader(`New order ${order.order_id} has been received.`) +
        `
                <div style="padding:28px;">
                    <div style="display:inline-block;padding:6px 10px;border-radius:999px;background:#eff6ff;color:#1d4ed8;font-size:12px;font-weight:700;">
                        NEW ORDER
                    </div>

                    <h1 style="margin:14px 0 8px;color:#111827;font-size:25px;line-height:1.25;">
                        New order received
                    </h1>

                    <p style="margin:0;color:#64748b;font-size:14px;line-height:1.7;">
                        Hello ${escapeHtml(order.seller_name || 'Seller')}, a customer has placed a new order through NexKartBD.
                        Please review the order and process it according to your normal fulfillment workflow.
                    </p>

                    ${buildOrderSummary(order, true)}

                    <div style="margin-top:22px;">
                        <a href="${escapeHtml(APP_URL)}"
                           style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;font-weight:700;font-size:13px;padding:12px 18px;border-radius:9px;">
                            Open NexKartBD
                        </a>
                    </div>
                </div>
        ` +
        buildFooter()
    );
}

function buildCustomerEmail(order) {
    return (
        buildHeader(`Your NexKartBD order ${order.order_id} has been received.`) +
        `
                <div style="padding:28px;">
                    <div style="display:inline-block;padding:6px 10px;border-radius:999px;background:#ecfdf5;color:#15803d;font-size:12px;font-weight:700;">
                        ORDER CONFIRMED
                    </div>

                    <h1 style="margin:14px 0 8px;color:#111827;font-size:25px;line-height:1.25;">
                        Thank you, ${escapeHtml(order.customer_name || 'Customer')}!
                    </h1>

                    <p style="margin:0;color:#64748b;font-size:14px;line-height:1.7;">
                        We have successfully received your order. Our team is now processing it.
                        Please keep your order ID for future reference.
                    </p>

                    ${buildOrderSummary(order, false)}

                    <div style="margin-top:22px;padding:16px;border-left:4px solid #2563eb;background:#eff6ff;border-radius:8px;">
                        <div style="font-size:13px;color:#1e3a8a;line-height:1.7;">
                            <strong>Order ID:</strong> ${escapeHtml(order.order_id)}<br>
                            <strong>Status:</strong> ${escapeHtml(order.order_status || 'Processing')}
                        </div>
                    </div>

                    <div style="margin-top:22px;">
                        <a href="${escapeHtml(APP_URL)}"
                           style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;font-weight:700;font-size:13px;padding:12px 18px;border-radius:9px;">
                            Visit NexKartBD
                        </a>
                    </div>
                </div>
        ` +
        buildFooter()
    );
}

async function sendOneMail({ to, subject, html }) {
    if (!to) return false;

    await sendGmailMessage({
        to,
        subject,
        html,
        text: subject + `\n\nPlease visit ${APP_URL} for more information.`
    });

    return true;
}

async function processOrderEmailNotifications() {
    try {
        const [pendingMailOrders] = await db.query(
            `SELECT
                o.*,
                a.email AS seller_email,
                a.name AS seller_name
             FROM orders o
             LEFT JOIN admins a ON o.seller_id = a.id
             WHERE o.sendMail = 0
             ORDER BY o.id ASC
             LIMIT 50`
        );

        if (!pendingMailOrders || pendingMailOrders.length === 0) {
            return;
        }

        console.log(
            `[Mail Cron] Processing ${pendingMailOrders.length} pending order email(s)...`
        );

        for (const order of pendingMailOrders) {
            let sellerSent = !order.seller_email;
            let customerSent = !order.customer_email;

            try {
                if (order.seller_email) {
                    await sendOneMail({
                        to: order.seller_email,
                        subject: `New Order Received • #${order.order_id} | NexKartBD`,
                        html: buildSellerEmail(order)
                    });

                    sellerSent = true;
                    console.log(
                        `[Mail Cron] Seller email sent: ${order.seller_email} | ${order.order_id}`
                    );
                }

                if (order.customer_email) {
                    await sendOneMail({
                        to: order.customer_email,
                        subject: `Order Confirmed • #${order.order_id} | NexKartBD`,
                        html: buildCustomerEmail(order)
                    });

                    customerSent = true;
                    console.log(
                        `[Mail Cron] Customer email sent: ${order.customer_email} | ${order.order_id}`
                    );
                }

                // Mark the order only when every required recipient has received
                // a successful sendMail response. If one fails, the next cron
                // cycle can retry it instead of silently losing the notification.
                if (sellerSent && customerSent) {
                    await db.query(
                        `UPDATE orders SET sendMail = 1 WHERE id = ?`,
                        [order.id]
                    );

                    console.log(
                        `[Mail Cron] Order ${order.order_id} marked sendMail = 1`
                    );
                } else {
                    console.warn(
                        `[Mail Cron] Order ${order.order_id} not marked complete. ` +
                        `sellerSent=${sellerSent}, customerSent=${customerSent}`
                    );
                }
            } catch (mailError) {
                console.error(
                    `[Mail Cron] Failed for order ${order.order_id}:`,
                    mailError && mailError.message ? mailError.message : mailError
                );
            }
        }
    } catch (error) {
        console.error(
            '[Mail Cron] Database/email processing error:',
            error && error.message ? error.message : error
        );
    }
}

const startMailCron = () => {
    cron.schedule('*/30 * * * * *', async () => {
        await processOrderEmailNotifications();
    });

    console.log(
        '[Mail Cron] Google Gmail API OAuth2 mail service is running every 30 seconds.'
    );
};

module.exports = startMailCron;
