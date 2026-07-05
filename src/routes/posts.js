'use strict';

const express = require('express');
const multer = require('multer');
const path = require('node:path');
const crypto = require('node:crypto');
const {
  createPost, getPostById, toggleLike, addComment, sharePost,
  hasReposted, recordFollowFromPost,
} = require('../db');
const { canView } = require('../network');

const router = express.Router();

const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads');

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname) || '';
      cb(null, crypto.randomBytes(12).toString('hex') + ext);
    },
  }),
  limits: { fileSize: 60 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/') || file.mimetype.startsWith('video/')) {
      cb(null, true);
    } else {
      cb(null, false);
    }
  },
});

function back(req, fallback = '/') {
  const ref = req.get('referer');
  return ref && ref.startsWith('/') ? ref : (ref || fallback);
}

// Create a post (text / photo / video).
router.post('/', upload.single('media'), (req, res) => {
  const user = res.locals.currentUser;
  if (!user) return res.redirect('/login');
  const type = req.body.type;
  const body = String(req.body.body || '').trim();

  let mediaPath = null;
  if ((type === 'photo' || type === 'video') && req.file) {
    mediaPath = '/uploads/' + req.file.filename;
  }

  if (type === 'text') {
    if (!body) return res.redirect(back(req, '/compose'));
    createPost({ userId: user.id, type: 'text', body });
  } else if (type === 'photo' && mediaPath) {
    createPost({ userId: user.id, type: 'photo', body, mediaPath });
  } else if (type === 'video' && mediaPath) {
    createPost({ userId: user.id, type: 'video', body, mediaPath });
  } else {
    return res.redirect(back(req, '/compose'));
  }
  res.redirect(back(req, '/'));
});

function resolveVisibleContent(req, res) {
  const user = res.locals.currentUser;
  if (!user) return null;
  const post = getPostById(Number(req.params.id));
  if (!post) return null;
  // Engagement targets the original content; repost wrappers are not directly
  // engaged with, so resolve one level.
  const content = post.type === 'repost' && post.repost_of_id
    ? getPostById(post.repost_of_id) || post
    : post;
  if (!canView(user.id, content.user_id)) return null;
  return { user, content };
}

// Like (toggle).
router.post('/:id/like', (req, res) => {
  const ctx = resolveVisibleContent(req, res);
  if (!ctx) return res.redirect(back(req, '/'));
  toggleLike(ctx.user.id, ctx.content.id);
  res.redirect(back(req, '/'));
});

// Comment.
router.post('/:id/comment', (req, res) => {
  const ctx = resolveVisibleContent(req, res);
  if (!ctx) return res.redirect(back(req, '/'));
  const body = String(req.body.body || '').trim();
  if (body) addComment(ctx.user.id, ctx.content.id, body.slice(0, 1000));
  res.redirect(back(req, '/'));
});

// Share (engagement boost, a little more than like).
router.post('/:id/share', (req, res) => {
  const ctx = resolveVisibleContent(req, res);
  if (!ctx) return res.redirect(back(req, '/'));
  if (ctx.content.user_id !== ctx.user.id) sharePost(ctx.user.id, ctx.content.id);
  res.redirect(back(req, '/'));
});

// Repost: re-publish the original content into your own stream.
router.post('/:id/repost', (req, res) => {
  const ctx = resolveVisibleContent(req, res);
  if (!ctx) return res.redirect(back(req, '/'));
  if (ctx.content.user_id === ctx.user.id) return res.redirect(back(req, '/'));
  if (!hasReposted(ctx.user.id, ctx.content.id)) {
    createPost({ userId: ctx.user.id, type: 'repost', repostOfId: ctx.content.id });
  }
  res.redirect(back(req, '/'));
});

// Follow the author *because of* this post -> BIG boost to that post.
router.post('/:id/follow-from', (req, res) => {
  const ctx = resolveVisibleContent(req, res);
  if (!ctx) return res.redirect(back(req, '/'));
  if (ctx.content.user_id !== ctx.user.id) {
    recordFollowFromPost(ctx.user.id, ctx.content.user_id, ctx.content.id);
  }
  res.redirect(back(req, '/'));
});

module.exports = router;
