const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

function authenticate(username, password, config) {
    const user = config.users.find(u => u.username === username);
    if (!user) return null;

    let isValid = false;
    if (user.passwordHash) {
        isValid = bcrypt.compareSync(password, user.passwordHash);
    } else if (user.password) {
        isValid = (password === user.password);
    }

    if (!isValid) return null;

    return jwt.sign({ username: user.username }, config.jwtSecret, { expiresIn: '8h' });
}

function verifyTokenRest(secret) {
    return (req, res, next) => {
        const authHeader = req.headers['authorization'];
        const token = authHeader && authHeader.split(' ')[1];

        if (!token) return res.status(401).json({ error: 'Access denied. No token provided.' });

        try {
            const decoded = jwt.verify(token, secret);
            req.user = decoded;
            next();
        } catch (ex) {
            res.status(400).json({ error: 'Invalid token.' });
        }
    };
}

function verifyTokenSocket(secret) {
    return (socket, next) => {
        const token = socket.handshake.auth.token;
        if (!token) {
            return next(new Error('Authentication error'));
        }

        try {
            const decoded = jwt.verify(token, secret);
            socket.user = decoded;
            next();
        } catch (err) {
            next(new Error('Authentication error'));
        }
    };
}

module.exports = {
    authenticate,
    verifyTokenRest,
    verifyTokenSocket
};
