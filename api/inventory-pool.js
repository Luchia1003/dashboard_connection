const snowflake = require('snowflake-sdk');
const crypto = require('crypto');
const requireAuth = require('../lib/auth');

function getPrivateKey() {
  const key = process.env.SNOWFLAKE_PRIVATE_KEY.replace(/\\n/g, '\n');
  return crypto.createPrivateKey({ key, format: 'pem' })
    .export({ type: 'pkcs8', format: 'pem' });
}

function getConnection() {
  return snowflake.createConnection({
    account:       process.env.SNOWFLAKE_ACCOUNT,
    username:      process.env.SNOWFLAKE_USERNAME,
    authenticator: 'SNOWFLAKE_JWT',
    privateKey:    getPrivateKey(),
    database:      process.env.SNOWFLAKE_DATABASE,
    schema:        process.env.SNOWFLAKE_SCHEMA,
    warehouse:     process.env.SNOWFLAKE_WAREHOUSE,
    role:          process.env.SNOWFLAKE_ROLE,
  });
}

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

  const conn = getConnection();
  try {
    await new Promise((resolve, reject) => conn.connect(err => err ? reject(err) : resolve()));
    const rows = await new Promise((resolve, reject) => {
      conn.execute({
        sqlText: `SELECT * FROM SKU_PROFIT_PROJECT.DASHBOARD_DB.${table} `,
        complete: (err, stmt, rows) => err ? reject(err) : resolve(rows),
      });
    });
    res.status(200).json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  } finally {
    conn.destroy(() => {});
  }
};
