const { query } = require('../lib/snowflake');
const requireAuth = require('../lib/auth');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const user = requireAuth(req, res);
  if (!user) return;

  // One function serves two datasets (Vercel Hobby caps deployments at 12
  // functions): the default SKU_INVENTORY_POOL, and ?view=reconciliation →
  // INVENTORY_RECONCILIATION (Action Center Inventory Check; also reachable
  // as /api/inventory-reconciliation via a vercel.json rewrite).
  const table = req.query && req.query.view === 'reconciliation'
    ? 'INVENTORY_RECONCILIATION'
    : 'SKU_INVENTORY_POOL';

  try {
    const rows = await query(`SELECT * FROM SKU_PROFIT_PROJECT.DASHBOARD_DB.${table}`);
    // Data refreshes once daily — let the browser reuse the response for an
    // hour (private: responses are per-login, must not hit shared caches).
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.status(200).json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};
