const { validateSession } = require('../../db/users');

function sessionMiddleware(req, res, next) {
    // Token aus Header, Cookie oder Query
    const token =
        req.headers['x-session-token'] ||
        req.headers['x-dashboard-token'] ||
        req.cookies?.session ||
        req.query.token;

    const session = validateSession(token);
    if (!session) {
        return res.status(401).json({ error: 'Unauthorized', redirect: '/login.html' });
    }

    req.session = session;
    next();
}

module.exports = sessionMiddleware;
