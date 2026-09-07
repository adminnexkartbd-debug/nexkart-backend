const express = require('express');
const multer = require('multer');
const { v2: cloudinary } = require('cloudinary');
const { CloudinaryStorage } = require('multer-storage-cloudinary');
require('dotenv').config();

// Cloudinary Configuration (.env থেকে কি গ্রহণ করছে)
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Multer Cloudinary Storage Setup
const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'uploads', // Cloudinary-র যে ফোল্ডারে ইমেজ সেভ হবে
    allowed_formats: ['jpg', 'jpeg', 'png', 'webp', 'gif'],
    public_id: (req, file) => Date.now() + '-' + file.originalname.split('.')[0],
  },
});

const upload = multer({ storage: storage });