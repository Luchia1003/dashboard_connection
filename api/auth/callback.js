const jwt = require('jsonwebtoken');

module.exports = async function handler(req, res) {
  const { code } = req.query;
  if (!code) return res.status(400).send('Missing code parameter');

  const clientId     = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const jwtSecret    = process.env.JWT_SECRET;
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const redirectUri = `${proto}://${req.headers.host}/api/auth/callback`;

  try {
    // Exchange code for access token
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code' }),
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) throw new Error('Failed to get access token from Google');

    // Get user info
    const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const user = await userRes.json();
    if (!user.email) throw new Error('Could not retrieve email from Google');

    // Check whitelist
    const allowed = (process.env.ALLOWED_EMAILS || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
    if (allowed.length > 0 && !allowed.includes(user.email.toLowerCase())) {
      return res.status(403).send(`
        <!DOCTYPE html><html><body style="font-family:system-ui;text-align:center;padding:60px;background:#0f172a;color:#e2e8f0;">
        <div style="font-size:32px;margin-bottom:16px;">🚫</div>
        <h2 style="margin-bottom:8px;">Access Denied</h2>
        <p style="color:#94a3b8;margin-bottom:20px;">${user.email} is not on the authorized list.</p>
        <a href="/login.html" style="color:#0ea5e9;">← Back to login</a>
        </body></html>`);
    }

    // Issue JWT (7-day expiry)
    const token = jwt.sign({ email: user.email, name: user.name || '' }, jwtSecret, { expiresIn: '7d' });
    const secure = req.headers.host?.includes('localhost') ? '' : '; Secure';
    res.setHeader('Set-Cookie', `auth=${token}; HttpOnly${secure}; SameSite=Lax; Path=/; Max-Age=604800`);
    res.redirect(302, '/');

  } catch (err) {
    console.error('Auth callback error:', err);
    res.status(500).send(`Authentication error: ${err.message}`);
  }
};
