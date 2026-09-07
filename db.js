// db.js
const mysql = require('mysql2/promise');
require('dotenv').config();

const db = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    port: Number(process.env.DB_PORT),
    charset: 'utf8mb4',
    ssl: {
        rejectUnauthorized: false
    },
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    // --- নিচের অপশনগুলো যোগ করুন ---
    enableKeepAlive: true,         // TCP Keep-Alive সক্রিয় করবে
    keepAliveInitialDelay: 10000,  // ১০ সেকেন্ড পর পর সার্ভারে Ping পাঠাবে যেন কানেকশন জীবিত থাকে
    maxIdle: 10,                   // সর্বোচ্চ কতটি কানেকশন Idle অবস্থায় থাকতে পারবে
    idleTimeout: 60000             // ১ মিনিট অব্যবহৃত থাকলে পুরনো কানেকশন রিলিজ করে নতুন কানেকশন নেবে
});

module.exports = db;