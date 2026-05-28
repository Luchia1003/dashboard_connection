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

-----修改需求
# Dashboard 修改需求

## 0. 性能优化：数据共享，切换页面不重新加载

- 页面初始化时同时请求 `/api/daily` 和 `/api/sku`，存入全局变量 `window.dailyData` 和 `window.skuData`
- Sales Overview 和 Product Detail 切换时直接读内存数据，不重新 fetch
- 顶部导航切换用 JS 控制 `display: none / block`，不跳转 HTML 页面
- 全局加载状态：数据未就绪时显示 loading spinner，就绪后两页都可以切换

---

## 1. Time Range 筛选器

### 规则
- KPI 卡片、Trend Charts、Product Detail 表格受 Time Range 影响
- Time Comparisons（Yesterday / 7d / 14d / 30d 对比区）**永远不受** Time Range 影响，始终基于今天往前算
- Product Detail Rolling 列（7d / 14d / 30d）**永远不受** Time Range 影响，始终基于今天往前算
- Net / Gross Sales / Refunds 切换按钮影响全页数据口径，与 Time Range 独立

### 下拉菜单选项
```
All Time
─────────────
Today
Yesterday
─────────────
This Week（本周一到今天）
Last Week（上周一到上周日）
─────────────
This Month（当月 1 号到今天）
Last Month（上个完整月）
─────────────
按月选择（展开子菜单或滚动列表，显示所有有数据的月份，格式 YYYY-MM，如 2025-03）
─────────────
Last 7 Days
Last 14 Days
Last 30 Days
Last 90 Days
─────────────
This Year（今年 1 月 1 号到今天）
Last Year（去年完整年）
─────────────
Custom Range（显示两个日期输入框 From / To）
```

---

## 2. KPI 卡片优化

- 数字字体加大到至少 32px，粗体，确保清晰可读
- Margin 卡片同时展示两个值：
  - 主数字：`NET_MARGIN_PCT`（百分比，如 24.5%）
  - 副数字：`NET_MARGIN`（金额，如 $2.1M，灰色小字显示在百分比下方）

---

## 3. Product Detail 页优化

### 表格新增 Margin 列
完整列顺序：
```
# | SKU / Product Name | Revenue | Profit | Orders | Margin | Return Rate | Rolling
```

- Margin 金额：随 Net / Order / Refund toggle 分别对应 `NET_MARGIN` / `ORDER_MARGIN` / `REFUND_MARGIN`
- Margin 百分比：`NET_MARGIN_PCT`，小字显示在金额下方

### 排版
- 表格占满页面全宽，每列均匀分配宽度
- SKU / Product Name 列固定宽度较宽，其他列等宽

### Sort By 选项扩展
```
Revenue           ← 现有
Profit            ← 现有
Orders            ← 现有
Return Rate       ← 现有
─────────────
Rolling 7d Revenue     ← 新增
Rolling 14d Revenue    ← 新增
Rolling 30d Revenue    ← 新增
Rolling 7d Profit      ← 新增
Rolling 7d Return Rate ← 新增
```

---

## 4. 响应式布局（手机适配）

### 断点
- 桌面：`>= 1024px`
- 平板：`768px - 1023px`
- 手机：`< 768px`

### 手机版布局调整
- KPI 卡片：4 列 → 2×2 网格
- Time Comparisons：4 列横排 → 纵向堆叠
- Trend Charts：左右并排 → 上下堆叠，图表高度适当缩小
- Product Detail 表格：
  - 隐藏 Rolling 列和 Margin 列
  - 保留：SKU / Revenue / Profit / Orders / Return Rate
  - 表格支持横向滚动
- 导航侧边栏 → 顶部 hamburger menu，点击展开
- 筛选器区域折叠为一行，点击展开

---

## 5. Google OAuth 登录

### 实现方式
- Google OAuth 2.0，Vercel Serverless Function 处理回调
- 白名单邮箱存在环境变量 `ALLOWED_EMAILS`（逗号分隔）
- 验证通过后签发 JWT token，存入 `httpOnly cookie`
- 每个 `/api/*` endpoint 验证 cookie 中的 JWT，无效则返回 401
- 前端检测到 401 自动跳转 `login.html`
- 未登录用户重定向到登录页，登录后跳回原页面

### 环境变量
```
GOOGLE_CLIENT_ID=从 Google Cloud Console 获取
GOOGLE_CLIENT_SECRET=从 Google Cloud Console 获取
ALLOWED_EMAILS=email1@gmail.com,email2@gmail.com
JWT_SECRET=随机字符串（用于签发和验证 JWT）
```

### 新增文件结构
```
project/
├── api/
│   ├── auth/
│   │   ├── google.js      # 发起 Google OAuth 跳转
│   │   ├── callback.js    # 验证邮箱白名单，签发 JWT，写入 cookie
│   │   └── logout.js      # 清除 cookie，跳转 login.html
│   ├── middleware/
│   │   └── auth.js        # JWT 验证中间件，所有 /api/daily /api/sku 复用
│   ├── daily.js           # 引入 auth 中间件
│   └── sku.js             # 引入 auth 中间件
├── public/
│   └── login.html         # 仅显示 Google 登录按钮
```

### Google Cloud Console 配置步骤
1. 去 `console.cloud.google.com` 新建项目
2. APIs & Services → OAuth consent screen → 填写应用名
3. APIs & Services → Credentials → Create OAuth 2.0 Client ID → Web Application
4. Authorized redirect URIs 填写：
   - 本地：`http://localhost:3000/api/auth/callback`
   - 生产：`https://你的vercel域名/api/auth/callback`
5. 把 Client ID 和 Client Secret 填入 Vercel 环境变量

---

## 6. 浅色主题（Light Mode）

- 新增浅色底色版本，与现有深色主题并存
- 右上角加切换按钮（🌙 / ☀️），点击切换，偏好存入 `localStorage`
- 浅色主题配色：
  - 背景：`#F5F6FA`（页面底色），`#FFFFFF`（卡片底色）
  - 文字：`#1A1A2E`（主色），`#6B7280`（次要色）
  - 边框：`#E5E7EB`
  - 强调色：保持与深色主题一致（蓝 / 绿 / 红）
  - 图表线条颜色保持不变，背景改为白色