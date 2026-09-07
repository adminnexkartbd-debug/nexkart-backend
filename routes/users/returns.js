const express = require('express');
const router = express.Router();
const path = require('path');
const db = require('../../db');

// ১. HTML ফাইল সার্ভ করা (URL: /user/returns)
router.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../../views/users/Return-Refund-Requests.html'));
});

// ২. ডাটাবেজ থেকে ডাটা পাওয়ার API (URL: /user/returns/api/data)
router.get('/api/data', async (req, res) => {
    try {
        const userId = req.session?.user?.id || req.user?.id;

        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized access' });
        }

        const query = `
            SELECT 
                r.id AS return_id,
                r.order_id,
                r.return_reason,
                r.return_details,
                r.proof_file,
                r.status,
                r.created_at,
                p.id AS product_table_id,
                p.product_id AS product_code,
                p.title AS product_name,
                a.id AS seller_table_id,
                a.shop_name
            FROM order_returns r
            LEFT JOIN products p ON r.product_id = p.id
            LEFT JOIN admins a ON r.seller_id = a.id
            WHERE r.user_id = ?
            ORDER BY r.created_at DESC
        `;

        const [returnsData] = await db.execute(query, [userId]);
        res.json(returnsData);

    } catch (error) {
        console.error('Error fetching order returns:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// ৩. রিকোয়েস্ট ডিলিট করার API (URL: /user/returns/api/delete/:id)
router.delete('/api/delete/:id', async (req, res) => {
    try {
        const userId = req.session?.user?.id || req.user?.id;
        const returnId = req.params.id;

        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized access' });
        }

        const deleteQuery = `DELETE FROM order_returns WHERE id = ? AND user_id = ?`;
        const [result] = await db.execute(deleteQuery, [returnId, userId]);

        if (result.affectedRows > 0) {
            res.json({ message: 'Request deleted successfully' });
        } else {
            res.status(404).json({ error: 'Request not found or unauthorized' });
        }

    } catch (error) {
        console.error('Error deleting return request:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

module.exports = router;