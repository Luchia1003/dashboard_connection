const snowflake = require('snowflake-sdk');
const crypto = require('crypto');

function getPrivateKey() {
  const key = process.env.SNOWFLAKE_PRIVATE_KEY.replace(/\\n/g, '\n');
  return crypto.createPrivateKey({ key, format: 'pem' })
    .export({ type: 'pkcs8', format: 'der' });
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

  const conn = getConnection();

  try {
    await new Promise((resolve, reject) => {
      conn.connect((err) => err ? reject(err) : resolve());
    });

    const rows = await new Promise((resolve, reject) => {
      conn.execute({
        sqlText: `SELECT * FROM SKU_PROFIT_PROJECT.DASHBOARD_DB.ORDER_DAILY_METRICS ORDER BY DATE ASC`,
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
