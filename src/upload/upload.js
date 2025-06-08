const express = require('express');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

cloudinary.config({
  cloud_name: 'dtfezdbvd',
  api_key: '764773181277688',
  api_secret: 'KJ0VgMN11RBMa5XHwWEIrVO5DY8',
});

router.post('/api/upload', upload.single('file'), async (req, res) => {
  try {
    const fileBuffer = req.file.buffer;
    const result = await cloudinary.uploader.upload_stream(
      { resource_type: 'image' },
      (error, result) => {
        if (error) return res.status(500).json({ success: false, error });
        return res.json({ success: true, url: result.secure_url });
      }
    );
    result.end(fileBuffer);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;