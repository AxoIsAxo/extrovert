'use strict';

const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { addSticker, getMyStickers } = require('../db');

const router = express.Router();

const STICKER_DIR = path.join(__dirname, '..', '..', 'uploads', 'stickers');
fs.mkdirSync(STICKER_DIR, { recursive: true });

const ALLOWED = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'];

const storage = multer.diskStorage({
  destination: STICKER_DIR,
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const name = Date.now() + '-' + Math.random().toString(36).slice(2, 8) + ext;
    cb(null, name);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 250 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, ALLOWED.includes(ext));
  },
});

router.get('/mine', (req, res) => {
  if (!res.locals.currentUser) return res.status(401).json([]);
  res.json(getMyStickers(res.locals.currentUser.id));
});

router.post('/upload', (req, res) => {
  if (!res.locals.currentUser) return res.status(401).send('Not logged in');
  upload.single('sticker')(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).send('Sticker must be under 250 KB.');
      return res.status(400).send('Invalid file.');
    }
    if (!req.file) return res.status(400).send('No file uploaded.');
    const filePath = '/uploads/stickers/' + req.file.filename;
    addSticker(res.locals.currentUser.id, filePath);
    res.redirect('/stickers/manage');
  });
});

router.get('/manage', (req, res) => {
  if (!res.locals.currentUser) return res.redirect('/login');
  const stickers = getMyStickers(res.locals.currentUser.id);
  res.render('stickers', { stickers });
});

module.exports = router;
