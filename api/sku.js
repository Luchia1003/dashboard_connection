const { query } = require('../lib/snowflake');
const requireAuth = require('../lib/auth');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const user = requireAuth(req, res);
  if (!user) return;

  // ?suppliers=1 → lightweight SKU→supplier map straight from MASTER_COST
  // (Action Center supplier column; the forecast table only covers SKUs with
  // recent activity, so it can't be the only source).
  const sqlText = req.query && req.query.suppliers
    ? `SELECT UPPER(TRIM(SKU)) AS SKU, MAX(NULLIF(TRIM(SUPPLIER),'')) AS SUPPLIER
       FROM SKU_PROFIT_PROJECT.AMAZON_MART.MASTER_COST
       WHERE SUPPLIER IS NOT NULL AND TRIM(SUPPLIER) <> ''
       GROUP BY 1`
    : `SELECT * FROM SKU_PROFIT_PROJECT.DASHBOARD_DB.SKU_SUMMARY_METRICS ORDER BY DATE ASC`;

  try {
    const rows = await query(sqlText);
    res.setHeader('Cache-Control', 'no-store');  // never let the browser HTTP-cache API data:
    // swrJSON already caches in IndexedDB, and a stale HTTP entry cannot be cleared
    // by Cmd+Shift+R (script fetches do not revalidate on hard reload).
    res.status(200).json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};
