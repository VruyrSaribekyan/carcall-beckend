const jwt = require('jsonwebtoken');

module.exports = (req, res, next) => {
    try {
        const token = req.headers.authorization?.split(' ')[1];
        if (!token) return res.status(401).json({ message: 'Auth failed: No token' });

        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.userData = decoded; // { userId: 1, carNumber: '...' }
        next();
    } catch (error) {
        return res.status(401).json({ message: 'Auth failed: Invalid token' });
    }
};