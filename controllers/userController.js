const { createPaySuitePayment } = require('../services/paysuiteService');

exports.placeOrder = async (req, res) => {
    try {
        const orderData = {
            order_id: `ORD-${Date.now()}`,
            name: req.body.name || (req.user ? req.user.name : 'Guest'),
            email: req.body.email || (req.user ? req.user.email : 'customer@example.com'),
            phone: req.body.phone
        };
        const totalAmount = req.body.total_amount;

        const paymentResult = await createPaySuitePayment(orderData, totalAmount);

        if (paymentResult.success) {
            return res.status(200).json({
                success: true,
                payment_url: paymentResult.payment_url
            });
        } else {
            return res.status(400).json({
                success: false,
                message: paymentResult.message
            });
        }
    } catch (error) {
        console.error("Place Order Error:", error.message);
        return res.status(500).json({
            success: false,
            message: "Failed to communicate with PaySuite payment gateway."
        });
    }
};