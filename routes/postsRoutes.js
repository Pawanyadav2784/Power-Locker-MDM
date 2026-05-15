// ─────────────────────────────────────────────────────────────
//  routes/postsRoutes.js
//  POST /api/posts  — Announcements / Notices for retailers
// ─────────────────────────────────────────────────────────────
const express = require('express');
const router  = express.Router();
const Post    = require('../models/Post');
const { protect, adminOnly } = require('../middleware/auth');

// ── GET /api/posts — Get all posts (role-filtered for non-admin)
router.get('/', protect, async (req, res) => {
  try {
    const { page = 1, limit = 20, type } = req.query;
    const query = { isActive: true };

    // Non-admin: show posts targeted to their role OR 'all'
    if (req.user.role !== 'super_admin') {
      query.$or = [{ targetRole: 'all' }, { targetRole: req.user.role }];
    }
    if (type) query.type = type;

    const total = await Post.countDocuments(query);
    const posts = await Post.find(query)
      .populate('createdBy', 'name')
      .sort({ isPinned: -1, createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit));

    res.json({ success: true, total, totalPages: Math.ceil(total / limit), data: posts });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── GET /api/posts/:id — Single post
router.get('/:id', protect, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id).populate('createdBy', 'name');
    if (!post) return res.status(404).json({ success: false, message: 'Post not found' });
    res.json({ success: true, post });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── POST /api/posts — Create post (Admin only)
router.post('/', protect, adminOnly, async (req, res) => {
  try {
    const { title, content, type, targetRole, imageUrl, isPinned } = req.body;
    const post = await Post.create({
      title, content, type, targetRole, imageUrl, isPinned,
      createdBy: req.user._id,
    });
    res.status(201).json({ success: true, message: 'Post created', post });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── PUT /api/posts/:id — Update post (Admin only)
router.put('/:id', protect, adminOnly, async (req, res) => {
  try {
    const post = await Post.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!post) return res.status(404).json({ success: false, message: 'Post not found' });
    res.json({ success: true, post });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── DELETE /api/posts/:id — Delete post (Admin only)
router.delete('/:id', protect, adminOnly, async (req, res) => {
  try {
    await Post.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Post deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
