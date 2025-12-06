const express = require('express');
const router = express.Router();
const authRoutes = require('./authRoutes');
const chatRoutes = require('./chatRoutes');
const callRoutes = require('./callRoutes');
const userRoutes = require('./userRoutes')
router.use('/auth', authRoutes);
router.use('/chat', chatRoutes);
router.use('/call', callRoutes);
router.use('/users', userRoutes);
module.exports = router;