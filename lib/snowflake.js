// Shared Snowflake access for the api/ functions.
//
// The connection is cached at module scope so warm serverless invocations
// reuse it instead of paying the JWT handshake (~1-2s) on every request.
// A stale/expired cached connection surfaces as a query error → we drop the
// cache, reconnect once, and retry.

const snowflake = require('snowflake-sdk');
const crypto = require('crypto');

function getPrivateKey() {
  const key = process.env.SNOWFLAKE_PRIVATE_KEY.replace(/\\n/g, '\n');
  return crypto.createPrivateKey({ key, format: 'pem' })
    .export({ type: 'pkcs8', format: 'pem' });
}

function connect() {
  const conn = snowflake.createConnection({
    account:       process.env.SNOWFLAKE_ACCOUNT,
    username:      process.env.SNOWFLAKE_USERNAME,
    authenticator: 'SNOWFLAKE_JWT',
    privateKey:    getPrivateKey(),
    database:      process.env.SNOWFLAKE_DATABASE,
    schema:        process.env.SNOWFLAKE_SCHEMA,
    warehouse:     process.env.SNOWFLAKE_WAREHOUSE,
    role:          process.env.SNOWFLAKE_ROLE,
    clientSessionKeepAlive: true,
  });
  return new Promise((resolve, reject) =>
    conn.connect(err => err ? reject(err) : resolve(conn)));
}

// Promise so concurrent requests during a cold start share one handshake.
let cachedConn = null;

function getConn() {
  if (!cachedConn) {
    cachedConn = connect().catch(err => { cachedConn = null; throw err; });
  }
  return cachedConn;
}

function run(conn, sqlText) {
  return new Promise((resolve, reject) => {
    conn.execute({
      sqlText,
      complete: (err, stmt, rows) => err ? reject(err) : resolve(rows),
    });
  });
}

async function query(sqlText) {
  let conn = await getConn();
  try {
    return await run(conn, sqlText);
  } catch (err) {
    // Likely an expired session on a reused connection — reconnect and retry
    // once; a second failure is a real error.
    cachedConn = null;
    try { conn.destroy(() => {}); } catch (_) {}
    conn = await getConn();
    return await run(conn, sqlText);
  }
}

module.exports = { query };
