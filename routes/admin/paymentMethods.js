
const express = require('express');
const router = express.Router();
const db = require('../../config/db'); // আপনার প্রজেক্টের ডাটাবেজ কানেকশন ফাইলের সঠিক পাথ দিন

// ১. সকল পেমেন্ট মেথড নিয়ে আসা (Get All Payment Methods for Admin)
router.get('/', async (req, res) => {
    try {
        const query = `SELECT * FROM paymentMethods ORDER BY id DESC`;
        const [methods] = await db.query(query);

        return res.status(200).json({
            success: true,
            methods: methods
        });
    } catch (error) {
        console.error("Fetch Payment Methods Error:", error);
        return res.status(500).json({ success: false, message: "Server error fetching payment methods" });
    }
});

// ২. নতুন পেমেন্ট মেথড যুক্ত করা (Add New Payment Method)
router.post('/', async (req, res) => {
    try {
        const { method_key, name, type, number, instruction, logo_url } = req.body;

        if (!method_key || !name || !type || !number) {
            return res.status(400).json({ success: false, message: "Required fields are missing!" });
        }

        const query = `
            INSERT INTO paymentMethods (method_key, name, type, number, instruction, logo_url, status)
            VALUES (?, ?, ?, ?, ?, ?, 'active')
        `;

        const [result] = await db.query(query, [method_key, name, type, number, instruction || null, logo_url || null]);

        return res.status(201).json({
            success: true,
            message: "Payment method added successfully!",
            id: result.insertId
        });

    } catch (error) {
        console.error("Add Payment Method Error:", error);
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(400).json({ success: false, message: "Method key must be unique!" });
        }
        return res.status(500).json({ success: false, message: "Server error adding payment method" });
    }
});

// ৩. পেমেন্ট মেথডের স্ট্যাটাস চেঞ্জ করা (Active / Inactive)
router.patch('/:id/status', async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;

        if (!['active', 'inactive'].includes(status)) {
            return res.status(400).json({ success: false, message: "Invalid status value!" });
        }

        const query = `UPDATE paymentMethods SET status = ? WHERE id = ?`;
        await db.query(query, [status, id]);

        return res.status(200).json({
            success: true,
            message: `Status updated to ${status}`
        });

    } catch (error) {
        console.error("Update Status Error:", error);
        return res.status(500).json({ success: false, message: "Server error updating status" });
    }
});

// ৪. পেমেন্ট মেথড ডিলিট করা (Delete Payment Method)
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const query = `DELETE FROM paymentMethods WHERE id = ?`;
        await db.query(query, [id]);

        return res.status(200).json({
            success: true,
            message: "Payment method deleted successfully!"
        });

    } catch (error) {
        console.error("Delete Payment Method Error:", error);
        return res.status(500).json({ success: false, message: "Server error deleting payment method" });
    }
});

module.exports = router;