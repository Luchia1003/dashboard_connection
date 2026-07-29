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
    // Data refreshes once daily — let the browser reuse the response for an
    // hour (private: responses are per-login, must not hit shared caches).
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.status(200).json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};
