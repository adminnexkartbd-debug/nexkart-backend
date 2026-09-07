const axios = require('axios');

async function getPaySuiteGateways() {
    return { 
        success: true, 
        gateways: [
            { id: 'bkash', name: 'bKash', icon: 'fa-wallet', color: 'text-pink-600' },
            { id: 'nagad', name: 'Nagad', icon: 'fa-mobile-screen-button', color: 'text-orange-600' },
            { id: 'rocket', name: 'Rocket', icon: 'fa-building-columns', color: 'text-purple-600' },
            { id: 'upay', name: 'Upay', icon: 'fa-credit-card', color: 'text-blue-600' }
        ] 
    };
}

async function createPaySuitePayment(orderData, totalAmount) {
    try {
        // ১. অথেন্টিকেশন কল (Merchant Key এবং Secret দিয়ে Token নেওয়া)
        const authResponse = await axios.post(`${process.env.PAYSUITE_API_URL}/authenticate`, {
            merchant_key: process.env.PAYSUITE_API_KEY,
            merchant_secret: process.env.PAYSUITE_SECRET_KEY
        }, {
            headers: {
                'Content-Type': 'application/json',
                'X-PS-CLIENT-NAME': 'NexKart',
                'X-PS-CLIENT-TYPE': 'merchant'
            }
        });

        const accessToken = authResponse.data.access_token || authResponse.data.token;

        // ২. পেমেন্ট লিংক জেনারেট করার পে লোড
        const paymentPayload = {
            invoice_number: orderData.order_id,
            transaction_number: `TXN-${Date.now()}`,
            amount: totalAmount,
            currency: 'BDT',
            redirect_url: process.env.PAYSUITE_CALLBACK_URL,
            purpose: `Payment for Order ${orderData.order_id}`,
            customer_info: {
                name: orderData.name,
                email: orderData.email || 'customer@example.com',
                mobile: orderData.phone,
                address_line: 'Dhaka',
                city: 'Dhaka',
                post_code: 1212,
                country: 'Bangladesh'
            }
        };

        const response = await axios.post(`${process.env.PAYSUITE_API_URL}/payment-links/generate`, paymentPayload, {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${accessToken}`,
                'X-PS-CLIENT-NAME': 'NexKart',
                'X-PS-CLIENT-TYPE': 'merchant'
            }
        });
        
        if (response.data && (response.data.link || response.data.payment_url)) {
            return {
                success: true,
                payment_url: response.data.link || response.data.payment_url 
            };
        } else {
            return {
                success: false,
                message: response.data.message || 'PaySuite payment link generation failed.'
            };
        }
    } catch (error) {
        console.error("PaySuite API Error:", error.response?.data || error.message);
        return {
            success: false,
            message: 'Failed to communicate with PaySuite payment gateway.'
        };
    }
}

module.exports = { getPaySuiteGateways, createPaySuitePayment };