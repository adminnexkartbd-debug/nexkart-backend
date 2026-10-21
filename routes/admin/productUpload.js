// Keep multipart/storage failures inside the JSON API contract.
module.exports = function productUpload(middleware) {
  return function (req, res, next) {
    const adminId = req.user && req.user.id || req.session &&
      (req.session.passport && req.session.passport.user || req.session.userId);
    if (!adminId) return res.status(401).json({ success: false, message: 'অনুগ্রহ করে আবার লগইন করুন।' });
    middleware(req, res, function (error) {
      if (!error) return next();
      const code = error.code || 'PRODUCT_UPLOAD_FAILED';
      // Do not log credentials or signed upload requests.
      console.error('[Product upload]', { code, status: error.http_code, message: error.message });
      let status = 502;
      let message = 'ছবি/ভিডিও আপলোড করা যায়নি। Render log-এ Product upload error দেখুন।';
      if (code === 'LIMIT_UNEXPECTED_FILE') {
        status = 400;
        message = 'Upload field বা ফাইলের সংখ্যা সঠিক নয়। সর্বোচ্চ ১০টি ছবি এবং ১টি ভিডিও দিন।';
      } else if (code === 'LIMIT_FILE_SIZE') {
        status = 413; message = 'ছবির ফাইলের আকার অনুমোদিত সীমার বেশি। ছোট ছবি দিন।';
      } else if (error.http_code === 401 || error.http_code === 403 || /api.key|api.secret|signature|cloud.name/i.test(error.message || '')) {
        message = 'Cloudinary configuration যাচাই করুন: CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET।';
      } else if (error.http_code === 400) {
        status = 400; message = 'ছবিটি গ্রহণ করা যায়নি। ছবির জন্য JPG/PNG/WEBP/GIF এবং ভিডিওর জন্য MP4/WebM দিন।';
      } else if (/timeout|timed.out/i.test(error.message || '')) {
        status = 504; message = 'ছবি/ভিডিও আপলোডের সময় শেষ হয়েছে। ছোট ছবি দিয়ে আবার চেষ্টা করুন।';
      }
      return res.status(status).json({ success: false, code, message });
    });
  };
};
