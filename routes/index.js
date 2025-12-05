const express = require('express');
const router = express.Router();
const authRoutes = require('./authRoutes');
const chatRoutes = require('./chatRoutes');
const callRoutes = require('./callRoutes');
router.use('/auth', authRoutes);
router.use('/chat', chatRoutes);
router.use('/call', callRoutes);
module.exports = router;