'use strict';

const express = require('express');
const multer = require('multer');
const path = require('node:path');
const crypto = require('node:crypto');
const {
  db, createPost, getPostById, getDisplayPost, getUserById,
  toggleLike, addComment, commentsForPost, hasLiked, hasShared,
  sharePost, hasReposted, recordFollowFromPost, isFollowing,
  createNotification,
} = require('../db');
const { canView } = require('../network');

const router = express.Router();

const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads');

const ALLOWED_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg',
  '.mp4', '.webm', '.mov', '.avi', '.mkv',
]);

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      const safeExt = ALLOWED_EXTENSIONS.has(ext) ? ext : '';
      cb(null, crypto.randomBytes(12).toString('hex') + safeExt);
    },
  }),
  limits: { fileSize: 60 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      return cb(null, false);
    }
    if (file.mimetype.startsWith('image/') || file.mimetype.startsWith('video/')) {
      cb(null, true);
    } else {
      cb(null, false);
    }
  },
});

function back(req, fallback = '/') {
  const ref = req.get('referer');
  if (ref && ref.startsWith('/') && !ref.startsWith('//')) return ref;
  return fallback;
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
  const liked = toggleLike(ctx.user.id, ctx.content.id);
  if (liked && ctx.content.user_id !== ctx.user.id) {
    createNotification({ userId: ctx.content.user_id, type: 'like', actorId: ctx.user.id, postId: ctx.content.id });
  }
  res.redirect(back(req, '/'));
});

// Comment.
router.post('/:id/comment', (req, res) => {
  const ctx = resolveVisibleContent(req, res);
  if (!ctx) return res.redirect(back(req, '/'));
  const body = String(req.body.body || '').trim();
  if (body) {
    addComment(ctx.user.id, ctx.content.id, body.slice(0, 1000));
    if (ctx.content.user_id !== ctx.user.id) {
      createNotification({ userId: ctx.content.user_id, type: 'comment', actorId: ctx.user.id, postId: ctx.content.id });
    }
  }
  res.redirect(back(req, '/'));
});

// View a single post (shareable link).
router.get('/:id', (req, res) => {
  const user = res.locals.currentUser;
  if (!user) return res.redirect('/login');
  const post = getPostById(Number(req.params.id));
  if (!post) return res.status(404).render('404', { thing: 'post' });
  const content = post.type === 'repost' && post.repost_of_id
    ? getPostById(post.repost_of_id) || post
    : post;
  if (!canView(user.id, content.user_id)) return res.redirect('/');
  const interactId = content.id;
  const author = getUserById(content.user_id);
  const reposter = post.type === 'repost' ? getUserById(post.user_id) : null;
  const item = {
    id: post.id, interactId,
    type: content.type, body: content.body, mediaPath: content.media_path,
    createdAt: post.created_at,
    isRepost: post.type === 'repost',
    reposterName: reposter?.display_name, reposterUsername: reposter?.username,
    authorId: author.id, authorUsername: author.username, authorName: author.display_name,
    likeCount: +db.prepare(`SELECT COUNT(*) FROM likes WHERE post_id = ?`).get(interactId)['COUNT(*)'],
    shareCount: +db.prepare(`SELECT COUNT(*) FROM shares WHERE post_id = ?`).get(interactId)['COUNT(*)'],
    commentCount: commentsForPost(interactId).length,
    liked: hasLiked(user.id, interactId), shared: hasShared(user.id, interactId),
    followingAuthor: isFollowing(user.id, author.id), isOwn: author.id === user.id,
    comments: commentsForPost(interactId),
  };
  res.render('post', { item });
});

// Share (engagement boost, a little more than like).
router.post('/:id/share', (req, res) => {
  const ctx = resolveVisibleContent(req, res);
  if (!ctx) return res.redirect(back(req, '/'));
  if (ctx.content.user_id !== ctx.user.id) {
    sharePost(ctx.user.id, ctx.content.id);
    createNotification({ userId: ctx.content.user_id, type: 'share', actorId: ctx.user.id, postId: ctx.content.id });
  }
  res.redirect('/posts/' + ctx.content.id);
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
