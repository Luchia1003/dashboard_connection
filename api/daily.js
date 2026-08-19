const { query } = require('../lib/snowflake');
const requireAuth = require('../lib/auth');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const user = requireAuth(req, res);
  if (!user) return;

  try {
    const rows = await query(`SELECT * FROM SKU_PROFIT_PROJECT.DASHBOARD_DB.ORDER_DAILY_METRICS ORDER BY DATE ASC`);
    res.setHeader('Cache-Control', 'no-store');  // never let the browser HTTP-cache API data:
    // swrJSON already caches in IndexedDB, and a stale HTTP entry cannot be cleared
    // by Cmd+Shift+R (script fetches do not revalidate on hard reload).
    res.status(200).json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};
