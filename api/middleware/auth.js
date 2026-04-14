const jwt = require('jsonwebtoken');

function parseCookies(req) {
  return Object.fromEntries(
    (req.headers.cookie || '').split(';')
      .map(s => s.trim().split('='))
      .filter(([k]) => k)
      .map(([k, ...v]) => [k.trim(), decodeURIComponent(v.join('='))])
  );
}

// Returns the JWT payload if valid, null if unauthorized (also sends 401).
// If JWT_SECRET is not configured, auth is disabled (dev mode).
module.exports = function requireAuth(req, res) {
  if (!process.env.JWT_SECRET) return { email: 'dev@local' };

  const cookies = parseCookies(req);
  const token = cookies.auth;

  if (!token) {
    res.status(401).json({ error: 'Unauthorized' });
    return null;
  }

  try {
    return jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    res.status(401).json({ error: 'Unauthorized' });
    return null;
  }
};
