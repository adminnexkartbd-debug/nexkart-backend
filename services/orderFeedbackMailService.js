const db = require('../db');
const { sendViaGoogleOAuth } = require('./ReturnPolicyMail');

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[char]));
const site = 'https://www.nexkartbd.com';
function attachment(url, label) {
    if (!url) return '';
    try {
        const parsed = new URL(url, site);
        if (!['https:', 'http:'].includes(parsed.protocol)) return '';
        return `<p><a href="${escapeHtml(parsed.href)}">${label}</a></p>`;
    } catch { return ''; }
}
function template(heading, data, details) {
    return `<!doctype html><html><body style="margin:0;background:#f8f4f6;font-family:Arial,sans-serif;color:#29202a">
    <div style="max-width:600px;margin:24px auto;background:white;border-radius:14px;padding:28px">
    <h2 style="color:#be3367">NexKartBD · ${heading}</h2>
    <p><b>Order ID:</b> ${escapeHtml(data.order_id)}</p>
    <p><b>Product ID:</b> ${escapeHtml(data.product_id)}</p>
    ${details}<p><a href="${site}/admin/home">Open Admin Panel</a></p>
    <p style="color:#777;font-size:12px">© ${new Date().getFullYear()} NexKartBD</p></div></body></html>`;
}
async function dispatch(data, includeSuperAdmins, subject, html) {
    const [recipients] = await db.query(
        includeSuperAdmins
            ? "SELECT email FROM admins WHERE id = ? OR super_admin = 'approved'"
            : 'SELECT email FROM admins WHERE id = ?',
        [data.seller_id]
    );
    const emails = [...new Set(recipients.map(row => String(row.email || '').trim().toLowerCase())
        .filter(email => /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)))];
    const results = await Promise.allSettled(emails.map(email => sendViaGoogleOAuth(email, subject, html)));
    results.forEach((result, index) => {
        if (result.status === 'rejected') console.error('Order feedback email failed:', emails[index], result.reason?.message);
    });
    return { recipients: emails.length, sent: results.filter(result => result.status === 'fulfilled').length };
}
function notifyReview(data) {
    const html = template('New Product Review', data,
        `<p><b>Rating:</b> ${escapeHtml(data.rating)} / 5</p>
         <p><b>Review:</b></p><p style="white-space:pre-wrap">${escapeHtml(data.review_text)}</p>
         ${attachment(data.review_imgUrl, 'View review image')}`);
    return dispatch(data, false, 'NexKartBD: New Product Review', html);
}
function notifyReturn(data) {
    const html = template('New Return & Refund Request', data,
        `<p><b>Reason:</b> ${escapeHtml(data.return_reason)}</p>
         <p><b>Details:</b></p><p style="white-space:pre-wrap">${escapeHtml(data.return_details)}</p>
         ${attachment(data.proof_file, 'View proof image / video')}
         <p><a href="${site}/admin/Return-RefundAdmin.html">View Return Requests</a></p>`);
    return dispatch(data, true, 'NexKartBD: New Return & Refund Request', html);
}
module.exports = { notifyReview, notifyReturn };
