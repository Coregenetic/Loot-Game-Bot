const AUTH_TOKEN = process.env.DASHBOARD_PASSWORD || 'changeme';

function authMiddleware(req, res, next) {
    // Token aus Header oder Query
    const token = req.headers['x-dashboard-token'] || req.query.token;

    if (!token || token !== AUTH_TOKEN) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
}

module.exports = authMiddleware;
