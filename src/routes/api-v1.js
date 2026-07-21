'use strict';

const express = require('express');
const crypto = require('node:crypto');
const multer = require('multer');
const path = require('node:path');
const fs = require('node:fs');
const { Buffer } = require('node:buffer');
const sharp = require('sharp');
const db = require('../db');
const { canView } = require('../network');
const feed = require('../feed');
const { requireApiAuth, clientAppAuth, generateToken, VALID_SCOPES } = require('../api-auth');
const { signIdToken, ISSUER } = require('../oidc');
const { getOnlineUsers, getUserPresence, cancelPendingCallByToken } = require('../webrtc-signaling');
const { onNotification } = require('../notif-broadcaster');
const dm = require('../dm');
const { getVapidPublicKey } = require('../push');

const router = express.Router();

// ----- helpers -----
const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads');
const API_UPLOAD_DIR = path.join(__dirname, '..', '..', 'data', 'api-uploads');
fs.mkdirSync(API_UPLOAD_DIR, { recursive: true });

const ALLOWED_EXT = new Set(['.jpg','.jpeg','.png','.gif','.webp','.mp4','.webm','.mov']);

const upload = multer({
  storage: multer.diskStorage({
    destination: API_UPLOAD_DIR,
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, crypto.randomBytes(16).toString('hex') + (ALLOWED_EXT.has(ext) ? ext : ''));
    },
  }),
  limits: { fileSize: 60 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_EXT.has(ext)) return cb(null, false);
    if (!file.mimetype.startsWith('image/') && !file.mimetype.startsWith('video/')) return cb(null, false);
    cb(null, true);
  },
});

function responseEnvelope(res, data, opts = {}) {
  const body = { data };
  if (opts.pagination) body.pagination = opts.pagination;
  res.json(body);
}

function errorResponse(res, status, title, detail, type = 'about:blank') {
  res.status(status).json({
    type,
    title,
    status,
    detail,
  });
}

function makeCursor(items, key = 'id') {
  if (!items || items.length === 0) return null;
  return Buffer.from(JSON.stringify({ [key]: items[items.length - 1][key] })).toString('base64url');
}

function decodeCursor(cursor) {
  try {
    return JSON.parse(Buffer.from(cursor, 'base64url').toString());
  } catch {
    return null;
  }
}

function serializeAccount(user, currentUserId) {
  return {
    id: String(user.id),
    username: user.username,
    display_name: user.display_name,
    avatar: user.avatar || null,
    bio: user.bio || '',
    created_at: user.created_at,
    statuses_count: db.countPostsByUser(user.id),
    followers_count: db.countFollowers(user.id),
    following_count: db.countFollowing(user.id),
    is_following: currentUserId ? db.isFollowing(currentUserId, user.id) : false,
    is_self: currentUserId ? currentUserId === user.id : false,
  };
}

function serializePost(post, author, currentUserId) {
  const interactId = post.type === 'repost' && post.repost_of_id
    ? db.getPostById(post.repost_of_id)
    : post;
  const targetId = interactId ? interactId.id : post.id;
  return {
    id: String(post.id),
    type: post.type,
    body: post.body || '',
    media_path: post.media_path || null,
    created_at: post.created_at,
    account: author ? serializeAccount(author, currentUserId) : null,
    likes_count: db.db.prepare(`SELECT COUNT(*) FROM likes WHERE post_id = ?`).get(targetId)['COUNT(*)'],
    shares_count: db.db.prepare(`SELECT COUNT(*) FROM shares WHERE post_id = ?`).get(targetId)['COUNT(*)'],
    comments_count: db.db.prepare(`SELECT COUNT(*) FROM comments WHERE post_id = ?`).get(targetId)['COUNT(*)'],
    liked: currentUserId ? db.hasLiked(currentUserId, targetId) : false,
    shared: currentUserId ? db.hasShared(currentUserId, targetId) : false,
    repost_of_id: post.repost_of_id ? String(post.repost_of_id) : null,
    is_own: currentUserId ? currentUserId === post.user_id : false,
  };
}

// ======== OAuth endpoints ========

// Register a new OAuth app
router.post('/oauth/apps', (req, res) => {
  const { name, description, website, redirect_uris, scopes } = req.body;
  if (!name || !redirect_uris) {
    return errorResponse(res, 400, 'Bad Request', 'name and redirect_uris are required.');
  }

  if (!req.session.userId) {
    return errorResponse(res, 401, 'Unauthorized', 'You must be logged in to register an app.');
  }

  const validScopes = scopes
    ? scopes.split(' ').filter(s => VALID_SCOPES.has(s)).join(' ')
    : 'read';

  const clientId = crypto.randomBytes(24).toString('hex');
  const clientSecret = crypto.randomBytes(32).toString('hex');
  const uris = Array.isArray(redirect_uris) ? redirect_uris.join(',') : redirect_uris;

  const id = db.createOAuthApp({
    name,
    description: description || '',
    website: website || '',
    redirectUris: uris,
    clientId,
    clientSecret,
    scopes: validScopes,
    ownerId: req.session.userId,
  });

  db.auditLog('oauth_app_created', req.session.userId, `App "${name}" (client_id: ${clientId})`);

  res.status(201).json({
    data: {
      id: String(id),
      name,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uris: uris.split(','),
      scopes: validScopes,
      website: website || '',
    },
  });
});

// List user's registered apps
router.get('/oauth/apps', (req, res) => {
  if (!req.session.userId) {
    return errorResponse(res, 401, 'Unauthorized', 'You must be logged in.');
  }
  const apps = db.getOAuthAppsByOwner(req.session.userId);
  responseEnvelope(res, apps.map(a => ({
    id: String(a.id),
    name: a.name,
    client_id: a.client_id,
    redirect_uris: a.redirect_uris.split(','),
    scopes: a.scopes,
    website: a.website || '',
    created_at: a.created_at,
  })));
});

// OAuth authorize endpoint (user-facing, renders consent page)
router.get('/oauth/authorize', (req, res) => {
  if (!req.session.userId) {
    return res.redirect('/login?next=' + encodeURIComponent('/api/v1/oauth/authorize?' + new URLSearchParams(req.query).toString()));
  }

  const { client_id, redirect_uri, response_type, scope, state, code_challenge, code_challenge_method, nonce } = req.query;

  if (response_type !== 'code') {
    return errorResponse(res, 400, 'Bad Request', 'Only response_type=code is supported (Authorization Code flow).');
  }

  const app = db.getOAuthAppByClientId(client_id);
  if (!app) {
    return errorResponse(res, 401, 'Invalid Client', 'Unknown client_id.');
  }

  const allowedUris = app.redirect_uris.split(',');
  if (!allowedUris.includes(redirect_uri)) {
    return errorResponse(res, 400, 'Bad Request', 'redirect_uri does not match registered URIs.');
  }

  const requestedScopes = scope || app.scopes;
  const validScopes = requestedScopes.split(' ').filter(s => VALID_SCOPES.has(s)).join(' ');

  res.render('oauth-authorize', {
    app,
    redirect_uri,
    state,
    scopes: validScopes,
    code_challenge,
    code_challenge_method,
    nonce,
    csrfToken: req.session.csrfToken,
  });
});

// OAuth authorize consent POST
router.post('/oauth/authorize', (req, res) => {
  if (!req.session.userId) {
    return errorResponse(res, 401, 'Unauthorized', 'Not logged in.');
  }

  const { client_id, redirect_uri, scope, state, code_challenge, code_challenge_method, nonce, approve } = req.body;

  if (approve !== 'yes') {
    const redirectUrl = new URL(redirect_uri);
    redirectUrl.searchParams.set('error', 'access_denied');
    if (state) redirectUrl.searchParams.set('state', state);
    return res.redirect(redirectUrl.toString());
  }

  const app = db.getOAuthAppByClientId(client_id);
  if (!app) return errorResponse(res, 401, 'Invalid Client', 'Unknown client_id.');

  const code = crypto.randomBytes(32).toString('hex');
  const validScopes = (scope || app.scopes).split(' ').filter(s => VALID_SCOPES.has(s)).join(' ');

  db.createOAuthCode(code, app.id, req.session.userId, validScopes, code_challenge || null, code_challenge_method || null, redirect_uri, nonce || null);

  const redirectUrl = new URL(redirect_uri);
  redirectUrl.searchParams.set('code', code);
  if (state) redirectUrl.searchParams.set('state', state);

  db.auditLog('oauth_code_issued', req.session.userId, `App "${app.name}" scopes: ${validScopes}`);
  res.redirect(redirectUrl.toString());
});

// Token exchange (authorization code -> access token)
router.post('/oauth/token', clientAppAuth, (req, res) => {
  const { grant_type, code, code_verifier, redirect_uri, refresh_token } = req.body;
  const app = req.oauthApp;

  if (grant_type === 'authorization_code') {
    if (!code) return errorResponse(res, 400, 'Bad Request', 'code is required for authorization_code grant.');

    const authCode = db.getOAuthCode(code);
    if (!authCode || authCode.used || Date.now() > authCode.expires_at) {
      return errorResponse(res, 400, 'Bad Request', 'Invalid, expired, or already used authorization code.');
    }

    if (authCode.app_id !== app.id) {
      return errorResponse(res, 400, 'Bad Request', 'Code was issued to a different client.');
    }

    if (authCode.redirect_uri !== redirect_uri) {
      return errorResponse(res, 400, 'Bad Request', 'redirect_uri mismatch.');
    }

    if (authCode.code_challenge) {
      if (!code_verifier) {
        return errorResponse(res, 400, 'Bad Request', 'code_verifier is required (PKCE).');
      }
      const method = authCode.code_challenge_method || 'S256';
      let challenge;
      if (method === 'S256') {
        challenge = crypto.createHash('sha256').update(code_verifier).digest('base64url');
      } else {
        challenge = code_verifier;
      }
      if (challenge !== authCode.code_challenge) {
        return errorResponse(res, 400, 'Bad Request', 'code_verifier does not match code_challenge.');
      }
    }

    db.markOAuthCodeUsed(authCode.id);

    const accessToken = generateToken();
    const refreshToken = generateToken();
    const expiresAt = Date.now() + 86400000; // 24h

    db.createOAuthToken(accessToken, refreshToken, app.id, authCode.user_id, authCode.scopes, expiresAt);
    db.auditLog('oauth_token_issued', authCode.user_id, `App "${app.name}"`);

    const tokenResponse = {
      access_token: accessToken,
      token_type: 'Bearer',
      scope: authCode.scopes,
      created_at: Math.floor(Date.now() / 1000),
      expires_in: 86400,
      refresh_token: refreshToken,
    };

    const scopesSet = new Set(authCode.scopes.split(' '));
    if (scopesSet.has('openid')) {
      const user = db.getUserById(authCode.user_id);
      const idTokenPayload = {
        sub: String(authCode.user_id),
        aud: app.client_id,
        auth_time: Math.floor(Date.now() / 1000),
      };
      if (authCode.nonce) idTokenPayload.nonce = authCode.nonce;
      if (scopesSet.has('profile')) {
        idTokenPayload.preferred_username = user.username;
        idTokenPayload.name = user.display_name;
        if (user.avatar) idTokenPayload.picture = `${ISSUER}${user.avatar}`;
      }
      tokenResponse.id_token = signIdToken(idTokenPayload);
    }

    return res.json(tokenResponse);
  }

  if (grant_type === 'refresh_token') {
    if (!refresh_token) return errorResponse(res, 400, 'Bad Request', 'refresh_token is required.');

    const existing = db.getOAuthTokenByRefresh(refresh_token);
    if (!existing) {
      return errorResponse(res, 400, 'Bad Request', 'Invalid or already revoked refresh token.');
    }
    if (existing.refresh_expires_at && Date.now() > existing.refresh_expires_at) {
      return errorResponse(res, 400, 'Bad Request', 'Refresh token has expired.');
    }

    const newToken = generateToken();
    const newRefreshToken = generateToken();
    const expiresAt = Date.now() + 86400000;

    db.rotateRefreshToken(refresh_token, newToken, newRefreshToken, expiresAt);
    db.auditLog('oauth_token_refreshed', existing.user_id, `App "${app.name}"`);

    return res.json({
      access_token: newToken,
      token_type: 'Bearer',
      scope: existing.scopes,
      created_at: Math.floor(Date.now() / 1000),
      expires_in: 86400,
      refresh_token: newRefreshToken,
    });
  }

  return errorResponse(res, 400, 'Bad Request', `Unsupported grant_type: ${grant_type}.`);
});

// Token revocation
router.post('/oauth/revoke', (req, res) => {
  const { token, client_id } = req.body;
  if (!token) return errorResponse(res, 400, 'Bad Request', 'token is required.');

  const tokenRecord = db.getOAuthToken(token);
  if (tokenRecord) {
    db.revokeOAuthToken(token);
    db.auditLog('oauth_token_revoked', tokenRecord.user_id, `App id: ${tokenRecord.app_id}`);
  }
  // Always return OK to prevent token enumeration
  res.json({ ok: true });
});

// List authorized apps for the current session user
router.get('/oauth/authorized_apps', (req, res) => {
  if (!req.session.userId) {
    return errorResponse(res, 401, 'Unauthorized', 'You must be logged in.');
  }
  const apps = db.getAuthorizedAppsForUser(req.session.userId);
  responseEnvelope(res, apps.map(a => ({
    id: String(a.id),
    name: a.name,
    website: a.website || '',
    client_id: a.client_id,
    scopes: a.token_scopes,
    authorized_at: a.authorized_at,
  })));
});

// Revoke specific app's access for current user
router.post('/oauth/authorized_apps/:appId/revoke', (req, res) => {
  if (!req.session.userId) return errorResponse(res, 401, 'Unauthorized', 'Not logged in.');
  const appId = parseInt(req.params.appId, 10);
  db.revokeOAuthTokensForUser(req.session.userId, appId);
  db.auditLog('oauth_app_access_revoked', req.session.userId, `App id: ${appId}`);
  res.json({ ok: true });
});

// OIDC UserInfo endpoint
router.get('/oauth/userinfo', requireApiAuth('openid'), (req, res) => {
  const scopesSet = new Set(req.apiToken.scopes.split(' '));
  const user = req.apiUser;
  const info = {
    sub: String(user.id),
  };
  if (scopesSet.has('profile')) {
    info.preferred_username = user.username;
    info.name = user.display_name;
    if (user.avatar) info.picture = `${ISSUER}${user.avatar}`;
  }
  res.json(info);
});

// Avatar upload dir
const AVATAR_DIR = path.join(__dirname, '..', '..', 'uploads', 'avatars');
fs.mkdirSync(AVATAR_DIR, { recursive: true });

const avatarUpload = multer({
  storage: multer.diskStorage({
    destination: AVATAR_DIR,
    filename: (req, file, cb) => {
      cb(null, crypto.randomBytes(12).toString('hex') + '.jpg');
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) return cb(null, false);
    cb(null, true);
  },
});

// ======== Accounts ========

router.get('/accounts/verify_credentials', requireApiAuth('read'), (req, res) => {
  responseEnvelope(res, serializeAccount(req.apiUser, req.apiUser.id));
});

router.patch('/accounts/update_credentials', requireApiAuth('profile'), (req, res) => {
  const { display_name, bio, theme } = req.body;
  if (display_name !== undefined) req.apiUser.display_name = String(display_name).trim().slice(0, 100);
  if (bio !== undefined) req.apiUser.bio = String(bio).trim().slice(0, 500);
  if (theme !== undefined && ['light', 'dark', 'default'].includes(theme)) {
    req.apiUser.theme = theme;
    db.setUserTheme(req.apiUser.id, theme);
  }
  db.updateUserProfile(req.apiUser.id, { displayName: req.apiUser.display_name, bio: req.apiUser.bio });
  db.auditLog('profile_updated', req.apiUser.id, 'Updated via API');
  responseEnvelope(res, serializeAccount(req.apiUser, req.apiUser.id));
});

// Avatar upload via API
router.post('/accounts/avatar', requireApiAuth('profile'), avatarUpload.single('avatar'), async (req, res) => {
  if (!req.file) return errorResponse(res, 400, 'Bad Request', 'No file uploaded. Use multipart/form-data with field "avatar".');

  const inputPath = req.file.path;
  const outputName = crypto.randomBytes(12).toString('hex') + '.jpg';
  const outputPath = path.join(AVATAR_DIR, outputName);

  try {
    await sharp(inputPath).resize(200, 200, { fit: 'cover', position: 'center' }).jpeg({ quality: 85 }).toFile(outputPath);
    fs.unlinkSync(inputPath);
    db.setAvatar(req.apiUser.id, '/uploads/avatars/' + outputName);
  } catch (e) {
    try { fs.unlinkSync(inputPath); } catch {}
    return errorResponse(res, 400, 'Bad Request', 'Failed to process image.');
  }

  db.auditLog('avatar_updated', req.apiUser.id, 'Updated via API');
  responseEnvelope(res, serializeAccount(db.getUserById(req.apiUser.id), req.apiUser.id));
});

router.get('/accounts/relationships', requireApiAuth('read'), (req, res) => {
  const ids = String(req.query.id || '').split(',').map(Number).filter(Boolean);
  const results = ids.map(id => ({
    id: String(id),
    following: db.isFollowing(req.apiUser.id, id),
    followed_by: db.isFollowing(id, req.apiUser.id),
  }));
  responseEnvelope(res, results);
});

router.get('/accounts/:id', requireApiAuth('read'), (req, res) => {
  const user = db.getUserById(parseInt(req.params.id, 10));
  if (!user) return errorResponse(res, 404, 'Not Found', 'Account not found.');
  responseEnvelope(res, serializeAccount(user, req.apiUser.id));
});

router.get('/accounts/:id/statuses', requireApiAuth('read'), (req, res) => {
  const user = db.getUserById(parseInt(req.params.id, 10));
  if (!user) return errorResponse(res, 404, 'Not Found', 'Account not found.');
  if (!canView(req.apiUser.id, user.id)) return errorResponse(res, 404, 'Not Found', 'Account not found.');

  const limit = Math.min(parseInt(req.query.limit, 10) || 20, 40);
  const cursor = req.query.cursor ? decodeCursor(req.query.cursor) : null;

  let posts;
  if (cursor) {
    posts = db.db.prepare(`
      SELECT * FROM posts WHERE user_id = ? AND id < ? ORDER BY id DESC LIMIT ?
    `).all(user.id, cursor.id, limit);
  } else {
    posts = db.db.prepare(`
      SELECT * FROM posts WHERE user_id = ? ORDER BY id DESC LIMIT ?
    `).all(user.id, limit);
  }

  responseEnvelope(res, posts.map(p => serializePost(p, user, req.apiUser.id)), {
    pagination: {
      next: makeCursor(posts),
    },
  });
});

router.get('/accounts/:id/followers', requireApiAuth('read'), (req, res) => {
  const user = db.getUserById(parseInt(req.params.id, 10));
  if (!user) return errorResponse(res, 404, 'Not Found', 'Account not found.');

  const followers = db.getFollowers(user.id);
  responseEnvelope(res, followers.map(f => serializeAccount(f, req.apiUser.id)));
});

router.get('/accounts/:id/following', requireApiAuth('read'), (req, res) => {
  const user = db.getUserById(parseInt(req.params.id, 10));
  if (!user) return errorResponse(res, 404, 'Not Found', 'Account not found.');

  const following = db.getFollowing(user.id);
  responseEnvelope(res, following.map(f => serializeAccount(f, req.apiUser.id)));
});

// ======== Follows ========

router.post('/accounts/:id/follow', requireApiAuth('follow'), (req, res) => {
  const target = db.getUserById(parseInt(req.params.id, 10));
  if (!target) return errorResponse(res, 404, 'Not Found', 'Account not found.');
  if (target.id === req.apiUser.id) return errorResponse(res, 400, 'Bad Request', 'Cannot follow yourself.');

  db.follow(req.apiUser.id, target.id);
  db.createNotification({ userId: target.id, type: 'follow', actorId: req.apiUser.id });
  db.auditLog('follow', req.apiUser.id, `Followed user ${target.id}`);
  responseEnvelope(res, serializeAccount(target, req.apiUser.id));
});

router.post('/accounts/:id/unfollow', requireApiAuth('follow'), (req, res) => {
  const target = db.getUserById(parseInt(req.params.id, 10));
  if (!target) return errorResponse(res, 404, 'Not Found', 'Account not found.');

  db.unfollow(req.apiUser.id, target.id);
  db.auditLog('unfollow', req.apiUser.id, `Unfollowed user ${target.id}`);
  responseEnvelope(res, serializeAccount(target, req.apiUser.id));
});

// ======== Statuses ========

router.post('/statuses', requireApiAuth('write'), upload.single('media'), (req, res) => {
  const idempotencyKey = req.headers['idempotency-key'];
  if (idempotencyKey) {
    const cached = db.getIdempotencyKey(idempotencyKey);
    if (cached) {
      return res.status(cached.status_code).set('X-Idempotency-Replayed', 'true')
        .json(JSON.parse(cached.response));
    }
  }

  const { type, body, repost_of_id } = req.body;
  const postType = type || 'text';
  let mediaPath = null;

  if ((postType === 'photo' || postType === 'video') && req.file) {
    mediaPath = '/api-uploads/' + req.file.filename;
  }

  if (postType === 'text' && !body) return errorResponse(res, 400, 'Bad Request', 'body is required for text posts.');
  if (postType === 'repost') {
    if (!repost_of_id) return errorResponse(res, 400, 'Bad Request', 'repost_of_id is required for repost type.');
    const original = db.getPostById(parseInt(repost_of_id, 10));
    if (!original) return errorResponse(res, 404, 'Not Found', 'Original post not found.');
    if (!canView(req.apiUser.id, original.user_id)) return errorResponse(res, 404, 'Not Found', 'Original post not found.');
    if (db.hasReposted(req.apiUser.id, original.id)) return errorResponse(res, 409, 'Conflict', 'Already reposted this post.');
  }

  const postId = db.createPost({
    userId: req.apiUser.id,
    type: postType,
    body: String(body || '').trim().slice(0, 5000),
    mediaPath,
    repostOfId: repost_of_id ? parseInt(repost_of_id, 10) : null,
  });

  const post = db.getPostById(postId);
  const author = db.getUserById(post.user_id);

  const response = serializePost(post, author, req.apiUser.id);

  const envelope = { data: response };
  if (idempotencyKey) {
    db.setIdempotencyKey(idempotencyKey, JSON.stringify(envelope), 201);
  }

  db.auditLog('post_created', req.apiUser.id, `Post ${postId} type: ${postType}`);
  res.status(201).json(envelope);
});

router.get('/statuses/:id', requireApiAuth('read'), (req, res) => {
  const post = db.getPostById(parseInt(req.params.id, 10));
  if (!post) return errorResponse(res, 404, 'Not Found', 'Post not found.');

  const author = db.getUserById(post.user_id);
  if (!author) return errorResponse(res, 404, 'Not Found', 'Author not found.');
  if (!canView(req.apiUser.id, author.id)) return errorResponse(res, 404, 'Not Found', 'Post not found.');

  responseEnvelope(res, serializePost(post, author, req.apiUser.id));
});

router.delete('/statuses/:id', requireApiAuth('write'), (req, res) => {
  const deleted = db.deletePost(parseInt(req.params.id, 10), req.apiUser.id);
  if (!deleted) return errorResponse(res, 404, 'Not Found', 'Post not found or not yours.');
  db.auditLog('post_deleted', req.apiUser.id, `Post ${req.params.id}`);
  res.json({ data: { ok: true } });
});

router.post('/statuses/:id/favourite', requireApiAuth('write'), (req, res) => {
  const post = resolveVisiblePost(parseInt(req.params.id, 10), req.apiUser.id);
  if (!post) return errorResponse(res, 404, 'Not Found', 'Post not found.');

  const liked = db.toggleLike(req.apiUser.id, post.id);
  if (liked && post.user_id !== req.apiUser.id) {
    db.createNotification({ userId: post.user_id, type: 'like', actorId: req.apiUser.id, postId: post.id });
  }
  db.auditLog('like_toggle', req.apiUser.id, `Post ${post.id} liked: ${liked}`);

  const author = db.getUserById(post.user_id);
  responseEnvelope(res, serializePost(post, author, req.apiUser.id));
});

router.post('/statuses/:id/unfavourite', requireApiAuth('write'), (req, res) => {
  const post = resolveVisiblePost(parseInt(req.params.id, 10), req.apiUser.id);
  if (!post) return errorResponse(res, 404, 'Not Found', 'Post not found.');

  db.db.prepare(`DELETE FROM likes WHERE user_id = ? AND post_id = ?`).run(req.apiUser.id, post.id);

  const author = db.getUserById(post.user_id);
  responseEnvelope(res, serializePost(post, author, req.apiUser.id));
});

router.post('/statuses/:id/reblog', requireApiAuth('write'), (req, res) => {
  const post = resolveVisiblePost(parseInt(req.params.id, 10), req.apiUser.id);
  if (!post) return errorResponse(res, 404, 'Not Found', 'Post not found.');
  if (post.user_id === req.apiUser.id) return errorResponse(res, 400, 'Bad Request', 'Cannot repost your own post.');

  if (!db.hasReposted(req.apiUser.id, post.id)) {
    db.createPost({ userId: req.apiUser.id, type: 'repost', repostOfId: post.id });
    db.createNotification({ userId: post.user_id, type: 'share', actorId: req.apiUser.id, postId: post.id });
  }

  const author = db.getUserById(post.user_id);
  responseEnvelope(res, serializePost(post, author, req.apiUser.id));
});

router.get('/statuses/:id/context', requireApiAuth('read'), (req, res) => {
  const post = resolveVisiblePost(parseInt(req.params.id, 10), req.apiUser.id);
  if (!post) return errorResponse(res, 404, 'Not Found', 'Post not found.');

  const comments = db.commentsForPost(post.id);
  res.json({
    data: {
      ancestors: [],
      descendants: comments.map(c => ({
        id: String(c.id),
        body: c.body,
        created_at: c.created_at,
        account: serializeAccount({ id: c.user_id, username: c.username, display_name: c.display_name, avatar: c.avatar, bio: '', created_at: c.user_created_at }, req.apiUser.id),
      })),
    },
  });
});

router.get('/statuses/:id/favourited_by', requireApiAuth('read'), (req, res) => {
  const post = resolveVisiblePost(parseInt(req.params.id, 10), req.apiUser.id);
  if (!post) return errorResponse(res, 404, 'Not Found', 'Post not found.');

  const likers = db.db.prepare(`
    SELECT u.id, u.username, u.display_name, u.avatar, u.bio, u.created_at
    FROM likes l JOIN users u ON u.id = l.user_id
    WHERE l.post_id = ? ORDER BY l.created_at DESC
  `).all(post.id);

  responseEnvelope(res, likers.map(u => serializeAccount(u, req.apiUser.id)));
});

router.get('/statuses/:id/reblogged_by', requireApiAuth('read'), (req, res) => {
  const post = resolveVisiblePost(parseInt(req.params.id, 10), req.apiUser.id);
  if (!post) return errorResponse(res, 404, 'Not Found', 'Post not found.');

  const reposters = db.db.prepare(`
    SELECT u.id, u.username, u.display_name, u.avatar, u.bio, u.created_at
    FROM posts p JOIN users u ON u.id = p.user_id
    WHERE p.type = 'repost' AND p.repost_of_id = ? ORDER BY p.created_at DESC
  `).all(post.id);

  responseEnvelope(res, reposters.map(u => serializeAccount(u, req.apiUser.id)));
});

function resolveVisiblePost(postId, userId) {
  const post = db.getPostById(postId);
  if (!post) return null;
  const content = post.type === 'repost' && post.repost_of_id
    ? db.getPostById(post.repost_of_id) || post
    : post;
  if (!canView(userId, content.user_id)) return null;
  return content;
}

// ======== Timelines ========

router.get('/timelines/home', requireApiAuth('read'), (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 20, 40);
  const cursor = req.query.cursor ? decodeCursor(req.query.cursor) : null;

  const feedResult = feed.buildFeed(req.apiUser.id);

  let items = feedResult.items;
  if (cursor) {
    const cursorIndex = items.findIndex(i => i.id === cursor.id || i.postId === cursor.id);
    if (cursorIndex !== -1) {
      items = items.slice(cursorIndex + 1);
    }
  }
  items = items.slice(0, limit);

  // Batch-fetch counts for all posts in the page
  const postIds = items.map(i => i.interactId || i.id).filter(Boolean);
  const counts = db.batchPostCounts(postIds);

  const results = items.map(item => {
    const post = db.getPostById(item.id);
    if (!post) return null;
    const author = db.getUserById(post.user_id);
    const targetId = item.interactId || post.id;
    return {
      id: String(post.id),
      type: post.type,
      body: post.body || '',
      media_path: post.media_path || null,
      created_at: post.created_at,
      account: author ? serializeAccount(author, req.apiUser.id) : null,
      likes_count: counts.likeMap[targetId] || 0,
      shares_count: counts.shareMap[targetId] || 0,
      comments_count: counts.commentMap[targetId] || 0,
      liked: req.apiUser.id ? db.hasLiked(req.apiUser.id, targetId) : false,
      shared: req.apiUser.id ? db.hasShared(req.apiUser.id, targetId) : false,
      repost_of_id: post.repost_of_id ? String(post.repost_of_id) : null,
      is_own: req.apiUser.id ? req.apiUser.id === post.user_id : false,
    };
  }).filter(Boolean);

  responseEnvelope(res, results, {
    pagination: {
      next: items.length >= limit ? Buffer.from(JSON.stringify({ id: items[items.length - 1].id })).toString('base64url') : null,
    },
  });
});

router.get('/timelines/public', (req, res) => {
  errorResponse(res, 403, 'Forbidden', 'Extrovert does not have a public timeline. Content is network-bound.');
});

// ======== Notifications ========

router.get('/notifications', requireApiAuth('notifications'), (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 20, 40);
  const cursor = req.query.cursor ? decodeCursor(req.query.cursor) : null;
  const notifications = db.getNotifications(req.apiUser.id, limit, cursor ? cursor.id : null);

  responseEnvelope(res, notifications.map(n => ({
    id: String(n.id),
    type: n.type,
    created_at: n.created_at,
    read: !!n.read,
    account: serializeAccount({ id: n.actor_id, username: n.actor_username, display_name: n.actor_name, avatar: n.actor_avatar, bio: '', created_at: n.actor_created_at }, req.apiUser.id),
    post_id: n.post_id ? String(n.post_id) : null,
  })), {
    pagination: {
      next: makeCursor(notifications),
    },
  });
});

router.post('/notifications/clear', requireApiAuth('notifications'), (req, res) => {
  db.markNotificationsRead(req.apiUser.id);
  res.json({ data: { ok: true } });
});

router.get('/notifications/unread_count', requireApiAuth('notifications'), (req, res) => {
  const count = db.countUnreadNotifications(req.apiUser.id);
  responseEnvelope(res, { count });
});

// SSE notification stream
router.get('/notifications/stream', requireApiAuth('notifications'), (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  res.write('event: connected\ndata: {}\n\n');

  const heartbeat = setInterval(() => {
    res.write(': heartbeat\n\n');
  }, 15000);

  const unsubscribe = onNotification(req.apiUser.id, (notif) => {
    res.write(`event: notification\ndata: ${JSON.stringify(notif)}\n\n`);
  });

  req.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
});

// ======== Media ========

router.post('/media', requireApiAuth('media.write'), upload.single('file'), async (req, res) => {
  if (!req.file) return errorResponse(res, 400, 'Bad Request', 'No file uploaded. Use multipart/form-data with field "file".');

  const mimeType = req.file.mimetype;
  const fileSize = req.file.size;
  const filePath = req.file.filename;

  const id = db.createMediaAttachment(req.apiUser.id, filePath, mimeType, fileSize);

  // Read image dimensions with sharp (skip for video).
  if (mimeType.startsWith('image/')) {
    try {
      const metadata = await sharp(req.file.path).metadata();
      if (metadata.width && metadata.height) {
        db.updateMediaAttachmentDimensions(id, metadata.width, metadata.height);
      }
    } catch {}
  }

  db.auditLog('media_uploaded', req.apiUser.id, `Media ${id} (${mimeType}, ${fileSize} bytes)`);

  const media = db.getMediaAttachment(id);

  res.status(201).json({
    data: {
      id: String(id),
      url: `/api-uploads/${filePath}`,
      mime_type: mimeType,
      file_size: fileSize,
      width: media.width,
      height: media.height,
      created_at: Date.now(),
    },
  });
});

router.get('/media/:id', requireApiAuth('read'), (req, res) => {
  const media = db.getMediaAttachment(parseInt(req.params.id, 10));
  if (!media) return errorResponse(res, 404, 'Not Found', 'Media not found.');
  if (media.user_id !== req.apiUser.id) return errorResponse(res, 403, 'Forbidden', 'You do not have access to this media.');

  res.json({
    data: {
      id: String(media.id),
      url: `/api-uploads/${media.file_path}`,
      mime_type: media.mime_type,
      file_size: media.file_size,
      width: media.width,
      height: media.height,
      created_at: media.created_at,
    },
  });
});

// ======== Search ========

router.get('/search', requireApiAuth('read'), (req, res) => {
  const { q, type, limit } = req.query;
  if (!q || String(q).trim().length === 0) return errorResponse(res, 400, 'Bad Request', 'Query parameter "q" is required.');

  const query = String(q).trim();
  const maxResults = Math.min(parseInt(limit, 10) || 20, 40);

  if (type === 'accounts') {
    const users = db.searchUsers(query, { limit: maxResults });
    return responseEnvelope(res, users.map(u => serializeAccount(u, req.apiUser.id)));
  }

  if (type === 'statuses') {
    const posts = db.searchPosts(query, req.apiUser.id, maxResults);
    return responseEnvelope(res, posts.map(p => {
      const author = { id: p.user_id, username: p.username, display_name: p.display_name, avatar: p.avatar, bio: '', created_at: 0 };
      return serializePost(p, author, req.apiUser.id);
    }));
  }

  // Default: return both
  const users = db.searchUsers(query, { limit: maxResults });
  const posts = db.searchPosts(query, req.apiUser.id, maxResults);

  responseEnvelope(res, {
    accounts: users.map(u => serializeAccount(u, req.apiUser.id)),
    statuses: posts.map(p => {
      const author = { id: p.user_id, username: p.username, display_name: p.display_name, avatar: p.avatar, bio: '', created_at: 0 };
      return serializePost(p, author, req.apiUser.id);
    }),
  });
});

// ----- Calls / Presence -----

router.get('/calls/presence', requireApiAuth, (req, res) => {
  const users = getOnlineUsers(req.apiUser.id);
  responseEnvelope(res, users);
});

router.get('/calls/presence/:username', requireApiAuth, (req, res) => {
  const presence = getUserPresence(req.params.username);
  res.json(presence);
});

// ======== Push subscriptions (native/mobile + PWA) ========

router.get('/push/vapid-public', requireApiAuth, (req, res) => {
  const key = getVapidPublicKey();
  if (!key) return res.status(404).json({ error: 'Push not configured' });
  res.json({ data: { publicKey: key } });
});

router.post('/push/subscribe', requireApiAuth, (req, res) => {
  const { platform, endpoint, p256dh, auth: pushAuth } = req.body || {};
  if (!endpoint) return res.status(400).json({ error: 'endpoint is required' });
  if (!platform) return res.status(400).json({ error: 'platform is required' });
  db.addPushSubscription({
    userId: req.apiUser.id,
    platform,
    endpoint,
    p256dh,
    auth: pushAuth,
  });
  res.json({ data: { ok: true } });
});

router.post('/push/unsubscribe', requireApiAuth, (req, res) => {
  const { endpoint } = req.body || {};
  if (!endpoint) return res.status(400).json({ error: 'endpoint is required' });
  db.removePushSubscription(req.apiUser.id, endpoint);
  res.json({ data: { ok: true } });
});

// ======== Rooms ========

router.get('/rooms', requireApiAuth('read'), (req, res) => {
  const myRooms = db.getRoomsForUser(req.apiUser.id);
  const result = myRooms.map(r => ({
    id: String(r.id),
    name: r.name,
    description: r.description || '',
    is_public: !!r.is_public,
    member_count: db.countRoomMembers(r.id),
    is_member: true,
  }));
  responseEnvelope(res, result);
});

router.get('/rooms/:id', requireApiAuth('read'), (req, res) => {
  const room = db.getRoom(parseInt(req.params.id, 10));
  if (!room) return errorResponse(res, 404, 'Not Found', 'Room not found.');
  const isMember = db.isRoomMember(room.id, req.apiUser.id);
  const channels = db.getRoomChannels(room.id).map(c => ({
    id: String(c.id),
    name: c.name,
    type: c.type || 'text',
  }));
  responseEnvelope(res, {
    id: String(room.id),
    name: room.name,
    description: room.description || '',
    html: room.html || '',
    css: room.css || '',
    is_public: !!room.is_public,
    is_member: isMember,
    channels,
  });
});

router.get('/rooms/:id/channels/:cid/messages', requireApiAuth('read'), (req, res) => {
  const room = db.getRoom(parseInt(req.params.id, 10));
  if (!room) return errorResponse(res, 404, 'Not Found', 'Room not found.');
  if (!db.isRoomMember(room.id, req.apiUser.id)) return errorResponse(res, 403, 'Forbidden', 'Not a member.');
  const channel = db.getRoomChannel(parseInt(req.params.cid, 10));
  if (!channel || channel.room_id !== room.id) return errorResponse(res, 404, 'Not Found', 'Channel not found.');

  const cursor = req.query.cursor ? parseInt(req.query.cursor, 10) : null;
  const messages = db.getRoomMessages(channel.id, cursor);
  const next = messages.length >= 50 ? String(messages[messages.length - 1].id) : null;

  responseEnvelope(res, {
    messages: messages.map(m => ({
      id: String(m.id),
      user_id: String(m.user_id),
      username: m.username,
      display_name: m.display_name,
      avatar: m.avatar || null,
      body: m.body,
      created_at: m.created_at,
      edited_at: m.edited_at || null,
    })),
    next,
  });
});

router.post('/rooms/:id/channels/:cid/messages', requireApiAuth('write'), (req, res) => {
  const room = db.getRoom(parseInt(req.params.id, 10));
  if (!room) return errorResponse(res, 404, 'Not Found', 'Room not found.');
  if (!db.isRoomMember(room.id, req.apiUser.id)) return errorResponse(res, 403, 'Forbidden', 'Not a member.');
  const channel = db.getRoomChannel(parseInt(req.params.cid, 10));
  if (!channel || channel.room_id !== room.id) return errorResponse(res, 404, 'Not Found', 'Channel not found.');

  const body = String(req.body.body || '').trim();
  if (!body) return errorResponse(res, 400, 'Bad Request', 'body is required.');

  const msgId = db.sendRoomMessage(channel.id, req.apiUser.id, body);
  res.status(201).json({ data: { id: String(msgId) } });
});

// ======== Direct Messages (E2E) ========

// List conversations
router.get('/conversations', requireApiAuth('read:direct'), (req, res) => {
  const conversations = dm.getConversations(req.apiUser.id);
  const filtered = conversations.filter(c => db.areMutualFollowers(req.apiUser.id, c.id));
  responseEnvelope(res, filtered.map(c => ({
    id: String(c.id),
    username: c.username,
    display_name: c.display_name,
    avatar: c.avatar,
    last_message: c.last_message,
    last_at: c.last_at,
    unread: c.unread,
  })));
});

// Fetch my own keys (must be before :username routes)
router.get('/conversations/keys', requireApiAuth('read:direct'), (req, res) => {
  const publicKey = dm.getPublicKey(req.apiUser.id);
  const encryptedPrivateKey = dm.getEncryptedPrivateKey(req.apiUser.id);
  responseEnvelope(res, { public_key: publicKey, encrypted_private_key: encryptedPrivateKey });
});

// Publish / rotate your keys (must be before :username routes)
router.post('/conversations/keys', requireApiAuth('write:direct'), (req, res) => {
  const publicKey = String(req.body.public_key || '').trim();
  const encryptedPrivateKey = String(req.body.encrypted_private_key || '').trim() || null;
  if (!publicKey || publicKey.length > 5000) {
    return errorResponse(res, 400, 'Bad Request', 'public_key is required and must be <= 5000 chars.');
  }
  dm.setPublicKey(req.apiUser.id, publicKey, encryptedPrivateKey);
  db.auditLog('dm_key_updated', req.apiUser.id, 'Published public key');
  res.json({ data: { ok: true } });
});

// Message history with a user
router.get('/conversations/:username', requireApiAuth('read:direct'), (req, res) => {
  const other = db.getUserByUsername(req.params.username);
  if (!other) return errorResponse(res, 404, 'Not Found', 'User not found.');
  if (!db.areMutualFollowers(req.apiUser.id, other.id)) {
    return errorResponse(res, 403, 'Forbidden', 'You can only message mutual followers.');
  }

  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 100);
  const cursor = req.query.cursor ? decodeCursor(req.query.cursor) : null;
  const messages = dm.getMessages(req.apiUser.id, other.id, limit, cursor ? cursor.id : null);
  // getMessages returns newest-first; reverse for display (oldest-first)
  messages.reverse();

  const items = messages.map(m => ({
    id: String(m.id),
    from_id: String(m.from_id),
    to_id: String(m.to_id),
    body: m.body,
    created_at: m.created_at,
    edited_at: m.edited_at,
    key_for_sender: m.key_for_sender,
    key_for_recipient: m.key_for_recipient,
  }));

  // Cursor points to the oldest message in this batch (first item after reverse)
  // so the next request fetches messages older than that.
  const nextCursor = items.length > 0
    ? Buffer.from(JSON.stringify({ id: items[0].id })).toString('base64url')
    : null;

  responseEnvelope(res, items, {
    pagination: { next: nextCursor },
  });
});

// Send a message
router.post('/conversations/:username/messages', requireApiAuth('write:direct'), (req, res) => {
  const other = db.getUserByUsername(req.params.username);
  if (!other) return errorResponse(res, 404, 'Not Found', 'User not found.');
  if (!db.areMutualFollowers(req.apiUser.id, other.id)) {
    return errorResponse(res, 403, 'Forbidden', 'You can only message mutual followers.');
  }

  const body = String(req.body.body || '').trim().slice(0, 5000);
  if (!body) return errorResponse(res, 400, 'Bad Request', 'body is required.');

  const keyForSender = String(req.body.key_for_sender || '').trim() || null;
  const keyForRecipient = String(req.body.key_for_recipient || '').trim() || null;

  if (!body.startsWith('/uploads/stickers/') && (!keyForSender || !keyForRecipient)) {
    return errorResponse(res, 400, 'Bad Request', 'End-to-end encryption required. All messages must be encrypted.');
  }

  const msgId = dm.sendMessage(req.apiUser.id, other.id, body, keyForSender, keyForRecipient);
  db.createNotification({ userId: other.id, type: 'message', actorId: req.apiUser.id });

  const msg = db.db.prepare(`SELECT id, from_id, to_id, body, created_at, key_for_sender, key_for_recipient FROM messages WHERE id = ?`).get(msgId);

  res.status(201).json({
    data: {
      id: String(msg.id),
      from_id: String(msg.from_id),
      to_id: String(msg.to_id),
      body: msg.body,
      created_at: msg.created_at,
      key_for_sender: msg.key_for_sender,
      key_for_recipient: msg.key_for_recipient,
    },
  });
});

// Fetch a user's public key
router.get('/conversations/:username/keys', requireApiAuth('read:direct'), (req, res) => {
  const other = db.getUserByUsername(req.params.username);
  if (!other) return errorResponse(res, 404, 'Not Found', 'User not found.');
  if (!db.areMutualFollowers(req.apiUser.id, other.id)) {
    return errorResponse(res, 403, 'Forbidden', 'You can only message mutual followers.');
  }

  const publicKey = dm.getPublicKey(other.id);
  responseEnvelope(res, { public_key: publicKey });
});

// Edit a message
router.patch('/messages/:id', requireApiAuth('write:direct'), (req, res) => {
  const body = String(req.body.body || '').trim().slice(0, 5000);
  if (!body) return errorResponse(res, 400, 'Bad Request', 'body is required.');
  const ok = dm.editMessage(parseInt(req.params.id, 10), req.apiUser.id, body);
  if (!ok) return errorResponse(res, 404, 'Not Found', 'Message not found or not yours.');
  db.auditLog('dm_edited', req.apiUser.id, `Message ${req.params.id}`);
  res.json({ data: { ok: true } });
});

// Delete a message
router.delete('/messages/:id', requireApiAuth('write:direct'), (req, res) => {
  const ok = dm.deleteMessage(parseInt(req.params.id, 10), req.apiUser.id);
  if (!ok) return errorResponse(res, 404, 'Not Found', 'Message not found or not yours.');
  db.auditLog('dm_deleted', req.apiUser.id, `Message ${req.params.id}`);
  res.json({ data: { ok: true } });
});

module.exports = router;
