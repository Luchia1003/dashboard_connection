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
    // ?view=ads_pl → the Marketing page's Google Ads P&L view (30d product-level).
    // Whitelist-mapped: user input never reaches the SQL string.
    const sql = req.query && req.query.view === 'ads_pl'
      ? `SELECT * FROM SKU_PROFIT_PROJECT.DASHBOARD_DB.ADS_PL_ENRICHED ORDER BY COST DESC`
      : `SELECT * FROM SKU_PROFIT_PROJECT.DASHBOARD_DB.AGING_INVENTORY_ENRICHED ORDER BY DAYS_SINCE_LAST_ORDER ASC, AVAILABLE DESC`;
    const rows = await query(sql);
    // ads_pl: no HTTP caching — the frontend's IndexedDB SWR layer already
    // gives instant paint, and an HTTP-cached response makes its background
    // revalidation fetch the same stale payload for an hour after any view
    // logic change (tiers looked "stuck" even after a hard refresh).
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};
