'use strict';

const express = require('express');
const {
  getUserByUsername, getUserById, follow, unfollow, isFollowing,
  createNotification, getFollowers, getFollowing, countFollowers, countFollowing,
} = require('../db');

const router = express.Router();

function back(req, fallback = '/') {
  const ref = req.get('referer');
  return ref || fallback;
}

router.post('/follow/:username', (req, res) => {
  const user = res.locals.currentUser;
  if (!user) return res.redirect('/login');
  const target = getUserByUsername(req.params.username);
  if (target && target.id !== user.id) {
    follow(user.id, target.id);
    createNotification({ userId: target.id, type: 'follow', actorId: user.id });
  }
  res.redirect(back(req, '/u/' + (target ? target.username : '')));
});

router.post('/unfollow/:username', (req, res) => {
  const user = res.locals.currentUser;
  if (!user) return res.redirect('/login');
  const target = getUserByUsername(req.params.username);
  if (target) unfollow(user.id, target.id);
  res.redirect(back(req, '/u/' + (target ? target.username : '')));
});

// Followers list.
router.get('/:username/followers', (req, res) => {
  const user = res.locals.currentUser;
  if (!user) return res.redirect('/login');
  const target = getUserByUsername(req.params.username);
  if (!target) return res.status(404).render('404', { thing: 'user' });
  const list = getFollowers(target.id).map(u => ({
    ...u, following: isFollowing(user.id, u.id),
  }));
  res.render('user-list', {
    title: 'Followers',
    targetUser: target, list, emptyMsg: 'No followers yet.',
  });
});

// Following list.
router.get('/:username/following', (req, res) => {
  const user = res.locals.currentUser;
  if (!user) return res.redirect('/login');
  const target = getUserByUsername(req.params.username);
  if (!target) return res.status(404).render('404', { thing: 'user' });
  const list = getFollowing(target.id).map(u => ({
    ...u, following: isFollowing(user.id, u.id),
  }));
  res.render('user-list', {
    title: 'Following',
    targetUser: target, list, emptyMsg: 'Not following anyone yet.',
  });
});

module.exports = router;
