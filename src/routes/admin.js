'use strict';

const express = require('express');
const { getAllUsers, getUserById, removeReferralBadge, banUser, unbanUser, deleteUser, getAllRooms, deleteRoom, getPendingReports, getReport, resolveReport, dismissReport } = require('../db');

const router = express.Router();

function requireAdmin(req, res, next) {
  const user = res.locals.currentUser;
  if (!user || !user.is_admin) return res.status(403).send('Admins only.');
  next();
}

router.get('/', requireAdmin, (req, res) => {
  const users = getAllUsers();
  const rooms = getAllRooms();
  res.render('admin', { users, rooms });
});

router.post('/remove-referral/:id', requireAdmin, (req, res) => {
  const target = getUserById(Number(req.params.id));
  if (!target) return res.status(404).send('User not found');
  removeReferralBadge(target.id);
  res.redirect('/admin');
});

router.post('/ban/:id', requireAdmin, (req, res) => {
  const target = getUserById(Number(req.params.id));
  if (!target) return res.status(404).send('User not found');
  if (target.is_admin) return res.status(403).send('Cannot ban another admin.');
  banUser(target.id);
  res.redirect('/admin');
});

router.post('/unban/:id', requireAdmin, (req, res) => {
  const target = getUserById(Number(req.params.id));
  if (!target) return res.status(404).send('User not found');
  unbanUser(target.id);
  res.redirect('/admin');
});

router.post('/delete/:id', requireAdmin, (req, res) => {
  const target = getUserById(Number(req.params.id));
  if (!target) return res.status(404).send('User not found');
  if (target.is_admin) return res.status(403).send('Cannot delete another admin.');
  deleteUser(target.id);
  res.redirect('/admin');
});

// Admin: delete any room
router.post('/rooms/:id/delete', requireAdmin, (req, res) => {
  const room = getAllRooms().find(r => r.id === Number(req.params.id));
  if (!room) return res.status(404).send('Room not found');
  deleteRoom(room.id);
  res.redirect('/admin#rooms');
});

// Admin: reports
router.get('/reports', requireAdmin, (req, res) => {
  const reports = getPendingReports();
  res.render('admin-reports', { reports });
});

router.post('/reports/:id/ban', requireAdmin, (req, res) => {
  const report = getReport(Number(req.params.id));
  if (!report) return res.status(404).send('Report not found');
  if (report.status !== 'pending') return res.status(400).send('Report already resolved');
  const target = getUserById(report.reported_user_id);
  if (!target) return res.status(404).send('User not found');
  if (target.is_admin) return res.status(403).send('Cannot ban another admin');
  banUser(target.id);
  resolveReport(report.id);
  res.redirect('/admin/reports');
});

router.post('/reports/:id/dismiss', requireAdmin, (req, res) => {
  const report = getReport(Number(req.params.id));
  if (!report) return res.status(404).send('Report not found');
  if (report.status !== 'pending') return res.status(400).send('Report already resolved');
  dismissReport(report.id);
  res.redirect('/admin/reports');
});

module.exports = router;
