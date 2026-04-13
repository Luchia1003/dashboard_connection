# E-commerce Analytics Dashboard — 产品规格

## 数据原则
- 前端只查聚合表，绝不直接查原始表
- 两张聚合表：`ORDER_DAILY_METRICS`（首页）、`SKU_SUMMARY_METRICS`（SKU 页）
- 数据库：`SKU_PROFIT_PROJECT.DASHBOARD_DB`
- 前端拉全量数据，rolling avg / 排序 / 切换全在 JS 侧计算

---

## Snowflake 连接与数据获取

### 技术栈
- 后端：Vercel Serverless Functions（Node.js）
- 前端：纯 HTML + Tailwind CDN + Chart.js
- 数据库：Snowflake，通过 `snowflake-sdk` npm 包连接

### 环境变量（存在 Vercel Environment Variables，不硬编码）

```
SNOWFLAKE_ACCOUNT=RRCWSFA-BSB89302
SNOWFLAKE_USERNAME=LUCHIACHANG
SNOWFLAKE_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----
SNOWFLAKE_DATABASE=SKU_PROFIT_PROJECT
SNOWFLAKE_SCHEMA=DASHBOARD_DB
SNOWFLAKE_WAREHOUSE=COMPUTE_WH
SNOWFLAKE_ROLE=ACCOUNTADMIN
```

### API Endpoints（两个，对应两张聚合表）

**GET /api/daily**
- 查询表：`ORDER_DAILY_METRICS`
- 返回：全量所有行，按 DATE 升序
- 用于：首页 KPI、Time Comparisons、Trend Charts、Advanced Insights

```sql
SELECT * FROM SKU_PROFIT_PROJECT.DASHBOARD_DB.ORDER_DAILY_METRICS
ORDER BY DATE ASC
```

**GET /api/sku**
- 查询表：`SKU_SUMMARY_METRICS`
- 返回：全量所有行，按 DATE 升序
- 用于：SKU 详情页表格、Rolling 对比、退货率预警

```sql
SELECT * FROM SKU_PROFIT_PROJECT.DASHBOARD_DB.SKU_SUMMARY_METRICS
ORDER BY DATE ASC
```

### Vercel Serverless Function 示例（/api/daily.js）

```javascript
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
```

`/api/sku.js` 结构完全一样，只把 SQL 里的表名换成 `SKU_SUMMARY_METRICS`。

### 前端调用方式

```javascript
// 首页：拉 ORDER_DAILY_METRICS
const dailyRes = await fetch('/api/daily');
const dailyData = await dailyRes.json();
// dailyData 是数组，每个元素对应一行，字段名与 Snowflake 列名一致（大写）
// 例：dailyData[0].DATE, dailyData[0].NET_PROFIT

// SKU 页：拉 SKU_SUMMARY_METRICS
const skuRes = await fetch('/api/sku');
const skuData = await skuRes.json();
// 例：skuData[0].SALES_SKU, skuData[0].RETURN_RATE
```

### 项目目录结构（给 Cursor 参考）

```
project/
├── api/
│   ├── daily.js        # /api/daily endpoint
│   └── sku.js          # /api/sku endpoint
├── public/
│   ├── index.html      # Sales Dashboard（首页）
│   ├── product.html    # Product Detail（SKU 页）
│   └── js/
│       ├── daily.js    # 首页逻辑（rolling avg、图表、异常检测）
│       └── sku.js      # SKU 页逻辑（排序、筛选、预警）
├── package.json
└── vercel.json
```

### vercel.json 配置

```json
{
  "rewrites": [
    { "source": "/api/(.*)", "destination": "/api/$1" }
  ]
}
```

### package.json 依赖

```json
{
  "dependencies": {
    "snowflake-sdk": "^1.9.0"
  }
}
```

---

## 聚合表字段参考

### ORDER_DAILY_METRICS

| 字段 | 说明 |
|---|---|
| DATE | 日期（Pacific Time，ORDER_DATE 优先，NULL 时用 TRANSACTION_DATE） |
| ORDER_COUNT | 订单数 |
| ORDER_QUANTITY | 销售数量 |
| ORDER_PRODUCT_SALES | 商品销售额 |
| ORDER_GROSS_SALES | 毛销售额 |
| ORDER_MARGIN | 销售 margin（含 shipping fee） |
| ORDER_COGS | 销售成本 |
| ORDER_PROFIT | 销售利润（ORDER_MARGIN - ORDER_COGS） |
| REFUND_COUNT | 退款订单数 |
| REFUND_QUANTITY | 退款数量（负数） |
| REFUND_PRODUCT_SALES | 退款商品金额（负数） |
| REFUND_GROSS_SALES | 退款毛额（负数） |
| REFUND_MARGIN | 退款 margin（负数） |
| REFUND_COGS | 退货收回成本（正数） |
| REFUND_PROFIT | 退款利润贡献（REFUND_MARGIN + REFUND_COGS） |
| NET_ORDER_COUNT | 净订单数 |
| NET_QUANTITY | 净数量 |
| NET_PRODUCT_SALES | 净商品销售额 |
| NET_GROSS_SALES | 净毛销售额 |
| NET_MARGIN | 净 margin |
| NET_COGS | 净成本 |
| NET_PROFIT | 净利润 |
| NET_MARGIN_PCT | 净利润率（NET_PROFIT / NET_GROSS_SALES） |

### SKU_SUMMARY_METRICS

ORDER_DAILY_METRICS 的所有字段之外，额外包含：

| 字段 | 说明 |
|---|---|
| SALES_SKU | SKU（已去除 -FORFBA 后缀，转大写） |
| DESCRIPTION | 商品名（来自 MASTER_COST） |
| UNIT_COST | 单位成本（MASTER_COST 最新 EFFECTIVE_DATE） |
| RETURN_RATE | 退货率（ABS(REFUND_QUANTITY) / ORDER_QUANTITY） |

---

## 页面一：Sales Dashboard（首页）

### 数据源：ORDER_DAILY_METRICS

### KPI 卡片（4 个，基于全量历史）
- Net Revenue → `NET_GROSS_SALES` 累计
- Net Profit → `NET_PROFIT` 累计
- Total Orders → `NET_ORDER_COUNT` 累计
- Margin → `NET_MARGIN_PCT` 全期平均

### Time Comparisons（Rolling 对比区）

每个时段展示以下指标，标注 vs rolling avg 的涨跌幅：
- Orders → `NET_ORDER_COUNT`
- Revenue → `NET_GROSS_SALES`
- Profit → `NET_PROFIT`
- Product Sales → `NET_PRODUCT_SALES`

时段：
- Yesterday vs 前 7 天 avg
- Last 7 days vs 前 30 天 avg
- Last 14 days vs 前 30 天 avg
- Last 30 days vs 前 60 天 avg

展示规则：
- 高于 rolling avg → 绿色 + 涨幅 %
- 低于 rolling avg → 红色 + 跌幅 %
- 高于 1.5× → 额外标记 surge

### Trend Charts
- Order Count Trend：`NET_ORDER_COUNT` 按月聚合折线
- Financials Over Time：`NET_GROSS_SALES` / `NET_PROFIT` / `NET_MARGIN_PCT` 三线叠加

### Advanced Insights（异常检测，全局级别）

| 检测项 | 计算方式 |
|---|---|
| Sales Surge | 7d avg `NET_GROSS_SALES` > 30d avg × 1.5 |
| Sales Drop | 7d avg `NET_GROSS_SALES` < 30d avg × 0.6 |
| Margin Drop | 14d avg `NET_MARGIN_PCT` 低于 30d avg 超过 5% |

---

## 页面二：Product Detail（SKU 详情页）

### 数据源：SKU_SUMMARY_METRICS

### 筛选与控制
- Date Range（All Time / 自定义区间）
- Toggle：Net / Order / Refund 三口径切换
  - Net → `NET_*` 字段
  - Order → `ORDER_*` 字段
  - Refund → `REFUND_*` 字段
- Sort by：Revenue / Profit / Orders / Return Rate
- Show Top：10 / 20 / 50 / 100

### 表格列

| 列 | Net 口径 | Order 口径 | Refund 口径 |
|---|---|---|---|
| SKU / Product Name | `SALES_SKU` + `DESCRIPTION` | 同左 | 同左 |
| Revenue | `NET_GROSS_SALES` | `ORDER_GROSS_SALES` | `REFUND_GROSS_SALES` |
| Profit | `NET_PROFIT` | `ORDER_PROFIT` | `REFUND_PROFIT` |
| Orders | `NET_ORDER_COUNT` | `ORDER_COUNT` | `REFUND_COUNT` |
| Margin | `NET_MARGIN_PCT` | `DIV0(ORDER_PROFIT, ORDER_GROSS_SALES)` | — |
| Return Rate | 30d `RETURN_RATE` | — | — |

### Rolling 对比（SKU 级别，JS 侧计算）

每个 SKU 展示 7d / 14d / 30d avg vs 该 SKU 全期 avg：
- Orders → `NET_ORDER_COUNT`
- Revenue → `NET_GROSS_SALES`
- Profit → `NET_PROFIT`
- Product Sales → `NET_PRODUCT_SALES`
- Return Rate → `RETURN_RATE`

高退货率预警：
- 30d `RETURN_RATE` > 10% → 警告标记
- 30d `RETURN_RATE` > 该 SKU 全期 avg × 1.5 → 异常标记

