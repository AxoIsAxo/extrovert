'use strict';

const express = require('express');
const {
  getUserByUsername, getCustomization, setCustomization, updateUserProfile,
  getDisplayPost, getUserById, postsByUser, hasLiked, hasShared,
  commentsForPost, isFollowing, countFollowers, countFollowing,
} = require('../db');
const { canView } = require('../network');
const { sanitizeProfileHTML, sanitizeCSS } = require('../sanitize');

const router = express.Router();

const DEFAULT_PROFILE_HTML = `<div class="ev-banner">
  <h2>Welcome to my profile</h2>
  <p>This is my customizable space on Extrovert. I can edit this HTML and the
  page CSS however I like — no JavaScript allowed.</p>
</div>
<div class="ev-posts-wrap">
  <!--POSTS-->
</div>`;

const DEFAULT_PROFILE_CSS = `.ev-banner {
  padding: 32px;
  background: #2a2347;
  color: #d8ccff;
  border: 1px solid #7c5cff;
  border-radius: 18px;
  margin-bottom: 22px;
}
.ev-banner h2 { margin: 0 0 8px; color: #fff; }
.ev-banner p { margin: 0; opacity: .85; }
.ev-posts-wrap { display: flex; flex-direction: column; gap: 16px; }`;

// Hydrate a user's posts for display on their profile (resolves reposts).
function hydrateProfilePosts(userId, viewerId) {
  const rows = postsByUser(userId);
  return rows.map(row => {
    const reposter = getUserById(row.user_id);
    let content = row;
    let author = reposter;
    if (row.type === 'repost' && row.repost_of_id) {
      const disp = getDisplayPost(row.repost_of_id);
      if (disp) { content = disp.post; author = getUserById(content.user_id); }
    }
    const comments = commentsForPost(content.id);
    return {
      id: row.id,
      interactId: content.id,
      type: content.type,
      body: content.body,
      mediaPath: content.media_path,
      createdAt: row.created_at,
      isRepost: row.type === 'repost',
      reposterName: row.type === 'repost' ? reposter?.display_name : null,
      reposterUsername: row.type === 'repost' ? reposter?.username : null,
      authorId: author.id,
      authorUsername: author.username,
      authorName: author.display_name,
      likeCount: countLikes(content.id),
      shareCount: countShares(content.id),
      commentCount: comments.length,
      followBoost: countFollowBoost(content.id),
      liked: hasLiked(viewerId, content.id),
      shared: hasShared(viewerId, content.id),
      followingAuthor: isFollowing(viewerId, author.id),
      isOwn: author.id === viewerId,
      comments,
    };
  });
}

function countLikes(postId) {
  return require('../db').db.prepare(`SELECT COUNT(*) AS n FROM likes WHERE post_id = ?`).get(postId).n;
}
function countShares(postId) {
  return require('../db').db.prepare(`SELECT COUNT(*) AS n FROM shares WHERE post_id = ?`).get(postId).n;
}
function countFollowBoost(postId) {
  return require('../db').db.prepare(`SELECT COUNT(*) AS n FROM follows_from_post WHERE post_id = ?`).get(postId).n;
}

router.get('/:username', (req, res) => {
  const profileUser = getUserByUsername(req.params.username);
  if (!profileUser) return res.status(404).render('404', { thing: 'user' });

  const viewer = res.locals.currentUser;
  const isOwn = viewer && viewer.id === profileUser.id;
  const canSeePosts = viewer && canView(viewer.id, profileUser.id);
  const following = viewer ? isFollowing(viewer.id, profileUser.id) : false;

  const custom = getCustomization(profileUser.id);
  const rawHtml = custom.html && custom.html.trim() ? custom.html : DEFAULT_PROFILE_HTML;
  const rawCss = custom.css && custom.css.trim() ? custom.css : DEFAULT_PROFILE_CSS;
  const html = sanitizeProfileHTML(rawHtml);
  const css = sanitizeCSS(rawCss);

  let postsHtml = '';
  if (canSeePosts) {
    const items = hydrateProfilePosts(profileUser.id, viewer.id);
    res.app.render('partials/post-list', { items, currentUser: viewer, onProfile: true }, (err, html2) => {
      if (err) { console.error(err); }
      postsHtml = html2 || '';
      finish();
    });
  } else {
    postsHtml = '<div class="ev-private">Follow @' + profileUser.username +
      ' to see their posts.</div>';
    finish();
  }

  function finish() {
    let finalHtml = html;
    if (finalHtml.includes('<!--POSTS-->')) {
      finalHtml = finalHtml.replace('<!--POSTS-->', postsHtml);
    } else {
      finalHtml += postsHtml;
    }
    res.render('profile', {
      profileUser, finalHtml, css, isOwn, following, canSeePosts,
      followerCount: countFollowers(profileUser.id),
      followingCount: countFollowing(profileUser.id),
    });
  }
});

router.get('/:username/edit', (req, res) => {
  const viewer = res.locals.currentUser;
  if (!viewer) return res.redirect('/login');
  const profileUser = getUserByUsername(req.params.username);
  if (!profileUser || profileUser.id !== viewer.id) {
    return res.status(403).send('You can only edit your own profile.');
  }
  const custom = getCustomization(viewer.id);
  res.render('profile-edit', {
    profileUser,
    html: custom.html || DEFAULT_PROFILE_HTML,
    css: custom.css || DEFAULT_PROFILE_CSS,
    displayName: viewer.display_name,
    bio: viewer.bio,
  });
});

router.post('/:username/edit', (req, res) => {
  const viewer = res.locals.currentUser;
  if (!viewer) return res.redirect('/login');
  const profileUser = getUserByUsername(req.params.username);
  if (!profileUser || profileUser.id !== viewer.id) {
    return res.status(403).send('You can only edit your own profile.');
  }
  const html = String(req.body.html || '');
  const css = String(req.body.css || '');
  const displayName = String(req.body.displayName || '').trim().slice(0, 60) || viewer.username;
  const bio = String(req.body.bio || '').trim().slice(0, 280);

  setCustomization(viewer.id, html, css);
  updateUserProfile(viewer.id, { displayName, bio });
  res.redirect('/u/' + profileUser.username);
});

module.exports = router;
