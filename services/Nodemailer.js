require('dotenv').config(); // এটি একদম উপরে থাকবে
const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
    service: 'gmail', // সার্ভিস হিসেবে 'gmail' দিতে হবে
    auth: {
       user: "admin.nexkartbd@gmail.com",
        pass: "vhqlvnekcwocfxrx"
    }
});