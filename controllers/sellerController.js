const sellerService = require('../services/sellerService');
const sellerMailService = require('../services/sellerMailService');

// Send Warning Mail
exports.sendWarning = async (req, res) => {
  const { email, shopName, reason } = req.body;
  try {
    await sellerMailService.sendSellerWarningEmail(email, shopName, reason);
    res.json({ success: true, message: 'Warning email sent successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to send email' });
  }
};

// Toggle Ban/Unban
exports.toggleBan = async (req, res) => {
  const { sellerId, action, reason, email } = req.body;

  try {
    if (action === 'ban') {
      await sellerService.banSeller(sellerId, reason);
      await sellerMailService.sendSellerBanEmail(email, reason);
    } else if (action === 'unban') {
      await sellerService.unbanSeller(sellerId);
      await sellerMailService.sendSellerUnbanEmail(email);
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};