const axios = require('axios');

async function createBdgatePayment(orderData, totalAmount) {
    try {
        const payload = {
            api_key: process.env.BDGATE_API_KEY,
            store_id: process.env.BDGATE_STORE_ID || '', // যদি স্টোর আইডি প্রয়োজন হয়
            tran_id: orderData.order_id,
            total_amount: totalAmount,
            currency: 'BDT',
            success_url: process.env.BDGATE_CALLBACK_URL,
            fail_url: process.env.BDGATE_CALLBACK_URL,
            cancel_url: process.env.BDGATE_CALLBACK_URL,
            cus_name: orderData.name,
            cus_email: orderData.email || 'customer@nexkart.com',
            cus_phone: orderData.phone,
            shipping_method: 'NO',
            product_name: 'NexKart Order',
            product_category: 'General',
            product_profile: 'general'
        };

        const response = await axios.post(`${process.env.BDGATE_API_URL}/v1/process-payment`, payload, {
            headers: { 'Content-Type': 'application/json' }
        });

        if (response.data && (response.data.payment_url || response.data.gateway_url || response.data.url)) {
            return {
                success: true,
                payment_url: response.data.payment_url || response.data.gateway_url || response.data.url
            };
        } else {
            return {
                success: false,
                message: response.data.message || 'BDGate payment initialization failed.'
            };
        }
    } catch (error) {
        console.error("BDGate Service Error:", error.response?.data || error.message);
        return {
            success: false,
            message: error.response?.data?.message || 'Internal connection error with BDGate API.'
        };
    }
}

module.exports = {
    createBdgatePayment
};