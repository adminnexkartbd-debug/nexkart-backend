require('dotenv').config(); // এটি একদম উপরে থাকবে
const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
    service: 'gmail', // সার্ভিস হিসেবে 'gmail'
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});