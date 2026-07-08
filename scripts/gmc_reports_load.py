#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Pull Google Merchant Center reports via Merchant API into SKU_PROFIT_PROJECT.MARKETING.

Auth: OAuth refresh token in .env.local (GMC_OAUTH_CLIENT_ID / _SECRET / _REFRESH_TOKEN),
created 2026-07-07 (GCP project gmc-marketing-sync, Internal OAuth app "GMC Marketing Sync",
GCP project registered on merchant account 5608676011 via developerRegistration:registerGcp).

Usage:
  python3 scripts/gmc_reports_load.py            # pull + preview counts (no write)
  python3 scripts/gmc_reports_load.py --load     # pull + write to Snowflake

Tables (idempotent per snapshot/date-window):
  MARKETING.GMC_PRODUCT_PERFORMANCE   — daily clicks/impr/CTR per product × marketing method
                                        (ORGANIC = free listings, ADS = paid), last 30 days
  MARKETING.GMC_PRICE_COMPETITIVENESS — today's snapshot: our price vs Google benchmark price
  MARKETING.GMC_BEST_SELLERS          — WEEKLY category best-seller clusters (Animals & Pet
                                        Supplies only), latest complete week, incl.
                                        INVENTORY_STATUS (do we carry the cluster?)
"""

import json
import math
import re
import sys
import tomllib
from datetime import date, timedelta
from pathlib import Path

import requests

ENV_FILE = Path(__file__).resolve().parent.parent / ".env.local"
ACCOUNT = "5608676011"
BASE = f"https://merchantapi.googleapis.com/reports/v1/accounts/{ACCOUNT}/reports:search"
DB = "SKU_PROFIT_PROJECT.MARKETING"
PERF_DAYS = 30
# Animals & Pet Supplies sorts first in the report; 60k rows covers it fully (verified 2026-07-07:
# pet rows identical at 60k and 200k caps — ~20k rows)
BEST_SELLERS_MAX_ROWS = 60000


def parse_env(path):
    env = {}
    for line in path.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip().strip('"').strip("'")
    return env


def access_token(env):
    r = requests.post("https://oauth2.googleapis.com/token", data={
        "client_id": env["GMC_OAUTH_CLIENT_ID"],
        "client_secret": env["GMC_OAUTH_CLIENT_SECRET"],
        "refresh_token": env["GMC_OAUTH_REFRESH_TOKEN"],
        "grant_type": "refresh_token"})
    d = r.json()
    if "access_token" not in d:
        sys.exit(f"token refresh failed: {json.dumps(d)[:300]}")
    return d["access_token"]


def search_all(token, query, max_rows=None, label=""):
    rows, page_token, pages = [], None, 0
    while True:
        body = {"query": query, "pageSize": 1000}
        if page_token:
            body["pageToken"] = page_token
        r = requests.post(BASE, headers={"Authorization": f"Bearer {token}"}, json=body)
        d = r.json()
        if r.status_code != 200:
            sys.exit(f"reports:search failed ({r.status_code}): {json.dumps(d)[:400]}\nquery: {query}")
        rows.extend(d.get("results", []))
        pages += 1
        if pages % 10 == 0:
            print(f"  [{label}] page {pages}, {len(rows)} rows so far...", flush=True)
        page_token = d.get("nextPageToken")
        if not page_token or (max_rows and len(rows) >= max_rows):
            break
    return rows


VARIANT_RE = re.compile(r"shopify_us_(\d+)_(\d+)", re.IGNORECASE)


def split_offer(offer_id):
    m = VARIANT_RE.match(offer_id or "")
    return (m.group(1), m.group(2)) if m else (None, None)


def resolve_sku(offer_id, vmap):
    """shopify_us_<pid>_<vid> offers resolve via the variant map; any other offer_id
    is a bare SKU from a secondary feed — use it directly (UPPER/TRIM, dashboard rule)."""
    pid, vid = split_offer(offer_id)
    if vid:
        return vmap.get(vid)
    return offer_id.strip().upper() if offer_id else None


def micros(p):
    return round(int(p["amountMicros"]) / 1e6, 2) if p and "amountMicros" in p else None


def clean_num(x):
    """Google reports emit NaN/Infinity as JSON strings (proto3) — Snowflake rejects them."""
    if x is None:
        return None
    try:
        f = float(x)
    except (TypeError, ValueError):
        return None
    return f if math.isfinite(f) else None


def gdate(d):
    return date(d["year"], d["month"], d["day"]) if d else None


def main():
    do_load = "--load" in sys.argv
    skip_bs = "--skip-bestsellers" in sys.argv
    only_bs = "--only-bestsellers" in sys.argv
    env = parse_env(ENV_FILE)
    token = access_token(env)
    today = date.today()
    perf_start, perf_end = today - timedelta(days=PERF_DAYS), today - timedelta(days=1)
    # best sellers: latest complete week (weeks start Monday; data lags ~2 days)
    bs_week = today - timedelta(days=today.weekday()) - timedelta(days=7)

    perf, pc, bs_pet = [], [], []
    # ---- 1. product performance (daily, ads vs organic) ----
    if not only_bs:
        perf = search_all(token, f"""
        SELECT date, marketing_method, offer_id, title, brand,
               clicks, impressions, click_through_rate
        FROM product_performance_view
        WHERE date BETWEEN '{perf_start}' AND '{perf_end}'""", label="perf")
    print(f"product_performance: {len(perf)} rows ({perf_start} → {perf_end})", flush=True)

    # ---- 2. price competitiveness (snapshot) ----
    if not only_bs:
        pc = search_all(token, """
        SELECT id, offer_id, title, brand, price, benchmark_price, report_country_code
        FROM price_competitiveness_product_view
        WHERE report_country_code = 'US'""", label="price")
        print(f"price_competitiveness: {len(pc)} rows", flush=True)

    # ---- 3. best sellers (weekly clusters, pet category, with our-inventory flag) ----
    if not skip_bs:
        bs = search_all(token, f"""
        SELECT report_category_id, report_country_code, report_granularity, report_date,
               title, brand, category_l1, category_l2, category_l3,
               rank, previous_rank, relative_demand, previous_relative_demand,
               inventory_status, brand_inventory_status
        FROM best_sellers_product_cluster_view
        WHERE report_date = '{bs_week}' AND report_granularity = 'WEEKLY'
        AND report_country_code = 'US'""", max_rows=BEST_SELLERS_MAX_ROWS, label="bestsellers")
        bs_pet = [r for r in bs
                  if r["bestSellersProductClusterView"].get("categoryL1") == "Animals & Pet Supplies"]
        dropped = len(bs) - len(bs_pet)
        print(f"best_sellers (week of {bs_week}): {len(bs)} pulled, {len(bs_pet)} in Animals & Pet "
              f"Supplies ({dropped} other-category rows dropped)")
        if len(bs) >= BEST_SELLERS_MAX_ROWS:
            print(f"⚠️ best sellers hit the {BEST_SELLERS_MAX_ROWS} row cap — category may be truncated")

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

    # SKU resolution via the variant map loaded by google_ads_product_load.py
    cur.execute(f"SELECT VARIANT_ID, SKU FROM {DB}.SHOPIFY_VARIANT_MAP")
    vmap = dict(cur.fetchall())
    print(f"variant map: {len(vmap)} rows")

    # ---- GMC_PRODUCT_PERFORMANCE ----
    if perf:
        cur.execute(f"""
    CREATE TABLE IF NOT EXISTS {DB}.GMC_PRODUCT_PERFORMANCE (
      DATE DATE, MARKETING_METHOD VARCHAR,
      OFFER_ID VARCHAR, PRODUCT_ID VARCHAR, VARIANT_ID VARCHAR, SKU VARCHAR,
      TITLE VARCHAR, BRAND VARCHAR,
      CLICKS NUMBER, IMPRESSIONS NUMBER, CTR FLOAT,
      LOADED_AT TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP())""")
        cur.execute(f"DELETE FROM {DB}.GMC_PRODUCT_PERFORMANCE WHERE DATE BETWEEN %s AND %s",
                    (perf_start, perf_end))
        print(f"deleted {cur.rowcount} old performance rows")
        _load_perf(cur, perf, vmap)

    if pc:
        _load_pc(cur, pc, vmap, today)

    if bs_pet:
        _load_bs(cur, bs_pet, bs_week)
    conn.close()


def _load_perf(cur, perf, vmap):
    payload = []
    for r in perf:
        v = r["productPerformanceView"]
        pid, vid = split_offer(v.get("offerId"))
        payload.append((
            gdate(v.get("date")), v.get("marketingMethod"), v.get("offerId"), pid, vid,
            resolve_sku(v.get("offerId"), vmap), v.get("title"), v.get("brand"),
            int(v.get("clicks", 0)), int(v.get("impressions", 0)),
            clean_num(v.get("clickThroughRate"))))
    cur.executemany(f"""
    INSERT INTO {DB}.GMC_PRODUCT_PERFORMANCE
    (DATE, MARKETING_METHOD, OFFER_ID, PRODUCT_ID, VARIANT_ID, SKU, TITLE, BRAND,
     CLICKS, IMPRESSIONS, CTR) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""", payload)
    print(f"inserted {len(payload)} performance rows")


def _load_pc(cur, pc, vmap, today):
    # ---- GMC_PRICE_COMPETITIVENESS ----
    cur.execute(f"""
    CREATE TABLE IF NOT EXISTS {DB}.GMC_PRICE_COMPETITIVENESS (
      SNAPSHOT_DATE DATE,
      REPORT_ID VARCHAR, OFFER_ID VARCHAR, PRODUCT_ID VARCHAR, VARIANT_ID VARCHAR, SKU VARCHAR,
      TITLE VARCHAR, BRAND VARCHAR,
      OUR_PRICE NUMBER(10,2), BENCHMARK_PRICE NUMBER(10,2), PRICE_VS_BENCHMARK_PCT FLOAT,
      COUNTRY VARCHAR,
      LOADED_AT TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP())""")
    cur.execute(f"DELETE FROM {DB}.GMC_PRICE_COMPETITIVENESS WHERE SNAPSHOT_DATE = %s", (today,))
    print(f"deleted {cur.rowcount} old price rows for today")
    payload = []
    for r in pc:
        v = r["priceCompetitivenessProductView"]
        pid, vid = split_offer(v.get("offerId"))
        our, bench = micros(v.get("price")), micros(v.get("benchmarkPrice"))
        pct = round((our - bench) / bench * 100, 2) if our and bench else None
        payload.append((today, v.get("id"), v.get("offerId"), pid, vid,
                        resolve_sku(v.get("offerId"), vmap),
                        v.get("title"), v.get("brand"), our, bench, pct,
                        v.get("reportCountryCode")))
    cur.executemany(f"""
    INSERT INTO {DB}.GMC_PRICE_COMPETITIVENESS
    (SNAPSHOT_DATE, REPORT_ID, OFFER_ID, PRODUCT_ID, VARIANT_ID, SKU, TITLE, BRAND,
     OUR_PRICE, BENCHMARK_PRICE, PRICE_VS_BENCHMARK_PCT, COUNTRY)
    VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""", payload)
    print(f"inserted {len(payload)} price rows")


def _load_bs(cur, bs_pet, bs_week):
    # ---- GMC_BEST_SELLERS ----
    cur.execute(f"""
    CREATE TABLE IF NOT EXISTS {DB}.GMC_BEST_SELLERS (
      REPORT_DATE DATE, GRANULARITY VARCHAR, CATEGORY_ID VARCHAR,
      TITLE VARCHAR, BRAND VARCHAR,
      CATEGORY_L1 VARCHAR, CATEGORY_L2 VARCHAR, CATEGORY_L3 VARCHAR,
      RANK NUMBER, PREVIOUS_RANK NUMBER,
      RELATIVE_DEMAND VARCHAR, PREVIOUS_RELATIVE_DEMAND VARCHAR,
      INVENTORY_STATUS VARCHAR, BRAND_INVENTORY_STATUS VARCHAR,
      LOADED_AT TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP())""")
    cur.execute(f"ALTER TABLE {DB}.GMC_BEST_SELLERS ADD COLUMN IF NOT EXISTS INVENTORY_STATUS VARCHAR")
    cur.execute(f"ALTER TABLE {DB}.GMC_BEST_SELLERS ADD COLUMN IF NOT EXISTS BRAND_INVENTORY_STATUS VARCHAR")
    cur.execute(f"DELETE FROM {DB}.GMC_BEST_SELLERS WHERE REPORT_DATE = %s AND GRANULARITY = 'WEEKLY'",
                (bs_week,))
    print(f"deleted {cur.rowcount} old best-seller rows")
    payload = []
    for r in bs_pet:
        v = r["bestSellersProductClusterView"]
        payload.append((
            gdate(v.get("reportDate")), v.get("reportGranularity"), v.get("reportCategoryId"),
            v.get("title"), v.get("brand"),
            v.get("categoryL1"), v.get("categoryL2"), v.get("categoryL3"),
            int(v["rank"]) if v.get("rank") else None,
            int(v["previousRank"]) if v.get("previousRank") not in (None, "0") else None,
            v.get("relativeDemand"), v.get("previousRelativeDemand"),
            v.get("inventoryStatus"), v.get("brandInventoryStatus")))
    cur.executemany(f"""
    INSERT INTO {DB}.GMC_BEST_SELLERS
    (REPORT_DATE, GRANULARITY, CATEGORY_ID, TITLE, BRAND,
     CATEGORY_L1, CATEGORY_L2, CATEGORY_L3, RANK, PREVIOUS_RANK,
     RELATIVE_DEMAND, PREVIOUS_RELATIVE_DEMAND, INVENTORY_STATUS, BRAND_INVENTORY_STATUS)
    VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""", payload)
    print(f"inserted {len(payload)} best-seller rows")


if __name__ == "__main__":
    main()
