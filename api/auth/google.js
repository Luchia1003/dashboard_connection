module.exports = function handler(req, res) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) return res.status(500).send('GOOGLE_CLIENT_ID not configured');

  const proto = req.headers['x-forwarded-proto'] || 'https';
  const redirectUri = `${proto}://${req.headers.host}/api/auth/callback`;
  const state = Math.random().toString(36).slice(2, 10);

  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'email profile');
  url.searchParams.set('state', state);
  url.searchParams.set('access_type', 'online');
  url.searchParams.set('prompt', 'select_account');

  res.setHeader('Set-Cookie', `oauth_state=${state}; HttpOnly; SameSite=Lax; Path=/; Max-Age=600`);
  res.redirect(302, url.toString());
};
