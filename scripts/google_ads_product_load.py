#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Load a Google Ads product report CSV into SKU_PROFIT_PROJECT.MARKETING.

How to download the CSV:
  Google Ads → Campaigns → Products → (推荐: 先把 campaign 筛选去掉, 用
  Columns 加上 Conversions / Conv. value 两列) → Download → CSV。
  报表第 2 行会带日期范围, 脚本自动解析成 PERIOD_START / PERIOD_END。

Usage:
  python3 scripts/google_ads_product_load.py "~/Downloads/Product report.csv"           # 预览
  python3 scripts/google_ads_product_load.py "~/Downloads/Product report.csv" --load    # 写入

What it does:
  1. Parses the CSV (Item ID 形如 shopify_us_<product_id>_<variant_id>).
  2. Pulls ALL Shopify variants via Admin GraphQL (creds from .env.local)
     → variant_id → SKU 映射, 同时刷新 MARKETING.SHOPIFY_VARIANT_MAP 快照.
  3. Idempotent write: DELETE 同 PERIOD_START/PERIOD_END 的旧行, 再 INSERT。
     (同一时间窗重复跑安全; 不同窗口各存一份, 时间序列就攒出来了)

Tables:
  MARKETING.GOOGLE_ADS_PRODUCT_PERFORMANCE  — per-SKU × period 的广告表现
  MARKETING.SHOPIFY_VARIANT_MAP             — variant_id→SKU 快照 (每次跑覆盖)
"""

import csv
import json
import re
import sys
import tomllib
from datetime import datetime
from pathlib import Path

import requests

ENV_FILE = Path(__file__).resolve().parent.parent / ".env.local"
DB = "SKU_PROFIT_PROJECT.MARKETING"


def parse_env(path):
    env = {}
    for line in path.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip().strip('"').strip("'")
    return env


def num(s):
    s = (s or "").strip().replace("$", "").replace(",", "").replace("%", "")
    if s in ("", "--"):
        return None
    try:
        return float(s)
    except ValueError:
        return None


def parse_report(path):
    rows = list(csv.reader(open(path)))
    # row 1 = "June 7, 2026 - July 6, 2026"
    m = re.match(r"(.+?)\s*-\s*(.+)", rows[1][0])
    p_start = datetime.strptime(m.group(1).strip(), "%B %d, %Y").date()
    p_end = datetime.strptime(m.group(2).strip(), "%B %d, %Y").date()
    header = rows[2]
    data = [dict(zip(header, r)) for r in rows[3:] if len(r) == len(header)]
    out = []
    for d in data:
        mm = re.match(r"shopify_us_(\d+)_(\d+)", d["Item ID"])
        if not mm:
            continue
        out.append({
            "item_id": d["Item ID"], "product_id": mm.group(1), "variant_id": mm.group(2),
            "title": d["Title"], "feed_status": d["Status"], "issues": d.get("Issues", ""),
            "feed_price": num(d.get("Price")),
            "clicks": int(d.get("Clicks") or 0),
            "impressions": int((d.get("Impr.") or "0").replace(",", "")),
            "ctr": num(d.get("CTR")), "avg_cpc": num(d.get("Avg. CPC")),
            "cost": num(d.get("Cost")) or 0.0,
            "conversions": num(d.get("Conversions")),
            "conv_value": num(d.get("Conv. value")),
        })
    return p_start, p_end, out


def pull_shopify_variants(env):
    auth = (env["SHOP_API_KEY"], env["SHOP_API_PASSWORD"])
    url = f"https://{env['SHOP_DOMAIN']}/admin/api/{env.get('SHOP_API_VERSION', '2025-10')}/graphql.json"
    q = """query($cursor: String) {
      productVariants(first: 250, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes { id sku price compareAtPrice inventoryQuantity
          product { id title vendor status } } } }"""
    mapping, cursor = {}, None
    while True:
        r = requests.post(url, auth=auth, json={"query": q, "variables": {"cursor": cursor}})
        d = r.json()
        if "errors" in d:
            sys.exit(f"Shopify GraphQL error: {json.dumps(d['errors'])[:300]}")
        pv = d["data"]["productVariants"]
        for n in pv["nodes"]:
            vid = n["id"].split("/")[-1]
            mapping[vid] = {
                "variant_id": vid, "product_id": n["product"]["id"].split("/")[-1],
                "sku": (n["sku"] or "").strip().upper(),
                "price": num(n["price"]), "compare_at": num(n["compareAtPrice"]),
                "inv_qty": n["inventoryQuantity"],
                "title": n["product"]["title"], "vendor": n["product"]["vendor"],
                "status": n["product"]["status"]}
        if not pv["pageInfo"]["hasNextPage"]:
            return mapping
        cursor = pv["pageInfo"]["endCursor"]


def main():
    args = [a for a in sys.argv[1:] if a != "--load"]
    do_load = "--load" in sys.argv
    if not args:
        sys.exit(__doc__)
    csv_path = Path(args[0]).expanduser()

    p_start, p_end, rows = parse_report(csv_path)
    print(f"period {p_start} → {p_end}, rows {len(rows)}, "
          f"cost ${sum(r['cost'] for r in rows):.2f}, "
          f"has conversions col: {rows[0]['conversions'] is not None}")

    env = parse_env(ENV_FILE)
    variants = pull_shopify_variants(env)
    matched = sum(1 for r in rows if r["variant_id"] in variants)
    print(f"shopify variants {len(variants)}, matched {matched}/{len(rows)}")

    if not do_load:
        print("(preview only — add --load to write)")
        return

    import snowflake.connector
    c = tomllib.load(open(Path.home() / ".snowflake/connections.toml", "rb"))["hooves"]
    conn = snowflake.connector.connect(
        account=c["account"], user=c["user"], private_key_file=c["private_key_file"],
        role=c.get("role"), warehouse=c.get("warehouse"))
    cur = conn.cursor()

    cur.execute(f"CREATE SCHEMA IF NOT EXISTS {DB}")
    cur.execute(f"""
    CREATE TABLE IF NOT EXISTS {DB}.GOOGLE_ADS_PRODUCT_PERFORMANCE (
      PERIOD_START DATE, PERIOD_END DATE,
      ITEM_ID VARCHAR, PRODUCT_ID VARCHAR, VARIANT_ID VARCHAR,
      SKU VARCHAR, VENDOR VARCHAR, TITLE VARCHAR,
      FEED_STATUS VARCHAR, ISSUES VARCHAR, FEED_PRICE NUMBER(10,2),
      SHOPIFY_PRICE NUMBER(10,2), COMPARE_AT_PRICE NUMBER(10,2),
      INV_QTY NUMBER, PRODUCT_STATUS VARCHAR,
      CLICKS NUMBER, IMPRESSIONS NUMBER, CTR FLOAT, AVG_CPC NUMBER(10,2),
      COST NUMBER(12,2), CONVERSIONS FLOAT, CONV_VALUE NUMBER(12,2),
      LOADED_AT TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP())""")
    # older loads may miss the conversion columns
    cur.execute(f"ALTER TABLE {DB}.GOOGLE_ADS_PRODUCT_PERFORMANCE ADD COLUMN IF NOT EXISTS CONVERSIONS FLOAT")
    cur.execute(f"ALTER TABLE {DB}.GOOGLE_ADS_PRODUCT_PERFORMANCE ADD COLUMN IF NOT EXISTS CONV_VALUE NUMBER(12,2)")

    cur.execute(f"DELETE FROM {DB}.GOOGLE_ADS_PRODUCT_PERFORMANCE WHERE PERIOD_START = %s AND PERIOD_END = %s",
                (p_start, p_end))
    print(f"deleted {cur.rowcount} old rows for this period")

    cur.executemany(f"""
    INSERT INTO {DB}.GOOGLE_ADS_PRODUCT_PERFORMANCE
    (PERIOD_START, PERIOD_END, ITEM_ID, PRODUCT_ID, VARIANT_ID, SKU, VENDOR, TITLE,
     FEED_STATUS, ISSUES, FEED_PRICE, SHOPIFY_PRICE, COMPARE_AT_PRICE, INV_QTY,
     PRODUCT_STATUS, CLICKS, IMPRESSIONS, CTR, AVG_CPC, COST, CONVERSIONS, CONV_VALUE)
    VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
    """, [(p_start, p_end, r["item_id"], r["product_id"], r["variant_id"],
           (variants.get(r["variant_id"]) or {}).get("sku"),
           (variants.get(r["variant_id"]) or {}).get("vendor"),
           r["title"], r["feed_status"], r["issues"], r["feed_price"],
           (variants.get(r["variant_id"]) or {}).get("price"),
           (variants.get(r["variant_id"]) or {}).get("compare_at"),
           (variants.get(r["variant_id"]) or {}).get("inv_qty"),
           (variants.get(r["variant_id"]) or {}).get("status"),
           r["clicks"], r["impressions"], r["ctr"], r["avg_cpc"], r["cost"],
           r["conversions"], r["conv_value"]) for r in rows])
    print(f"inserted {len(rows)} rows")

    cur.execute(f"""
    CREATE OR REPLACE TABLE {DB}.SHOPIFY_VARIANT_MAP (
      VARIANT_ID VARCHAR, PRODUCT_ID VARCHAR, SKU VARCHAR,
      PRICE NUMBER(10,2), COMPARE_AT_PRICE NUMBER(10,2), INV_QTY NUMBER,
      TITLE VARCHAR, VENDOR VARCHAR, PRODUCT_STATUS VARCHAR,
      LOADED_AT TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP())""")
    cur.executemany(f"""
    INSERT INTO {DB}.SHOPIFY_VARIANT_MAP
    (VARIANT_ID, PRODUCT_ID, SKU, PRICE, COMPARE_AT_PRICE, INV_QTY, TITLE, VENDOR, PRODUCT_STATUS)
    VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)
    """, [(v["variant_id"], v["product_id"], v["sku"], v["price"], v["compare_at"],
           v["inv_qty"], v["title"], v["vendor"], v["status"]) for v in variants.values()])
    print(f"variant map refreshed: {len(variants)} rows")
    conn.close()


if __name__ == "__main__":
    main()
