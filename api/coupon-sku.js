const { query } = require('../lib/snowflake');
const requireAuth = require('../lib/auth');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');  // API data must never be cached by the browser
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const user = requireAuth(req, res);
  if (!user) return;

  // ?window=prev -> previous full month; ?window=shopify -> Shopify coupon
  // batch SKU rollup (accumulates since batch start); default -> month-to-date.
  // Whitelist mapping (never interpolate user input into SQL).
  const w = req.query && req.query.window;
  const sqlText =
    w === 'prev'    ? 'SELECT * FROM SKU_PROFIT_PROJECT.DASHBOARD_DB.PREV_MONTH_SKU_COUPON_PROFIT ORDER BY ORDER_DATE ASC' :
    w === 'shopify' ? 'SELECT * FROM SKU_PROFIT_PROJECT.DASHBOARD_DB.SHOPIFY_COUPON_SKU_PROFIT ORDER BY GROUP_PCT ASC, SKU ASC' :
                      'SELECT * FROM SKU_PROFIT_PROJECT.DASHBOARD_DB.DAILY_SKU_COUPON_PROFIT ORDER BY ORDER_DATE ASC';

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
