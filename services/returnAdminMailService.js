// services/returnAdminMailService.js
const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

/**
 * রিটার্ন এবং রিফান্ড স্ট্যাটাস আপডেট মেইল পাঠানোর সার্ভিস
 * @param {string} to - ইউজারের ইমেইল
 * @param {string} subject - ইমেইলের বিষয়
 * @param {string} html - ইমেইল বডি (HTML)
 */
const sendReturnStatusEmail = async (to, subject, html) => {
    try {
        await transporter.sendMail({
            from: process.env.EMAIL_USER,
            to,
            subject,
            html
        });
        return { success: true };
    } catch (error) {
        console.error('Return Mail Sending Error:', error);
        throw error;
    }
};

module.exports = { sendReturnStatusEmail };