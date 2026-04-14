-- ============================================================
-- Gonmura Food BigQuery 分析クエリ集
-- Firestore を BigQuery にエクスポートした前提
-- テーブル名: gonmura_food.orders, gonmura_food.menus
-- ============================================================

-- 1. 日別売上
-- 日ごとの注文数と売上合計を集計
SELECT
  DATE(TIMESTAMP_SECONDS(CAST(createdAt._seconds AS INT64))) AS order_date,
  COUNT(*) AS order_count,
  SUM(
    (SELECT SUM(CAST(item.price AS INT64) * CAST(item.quantity AS INT64))
     FROM UNNEST(items) AS item)
  ) AS total_revenue
FROM `gonmura_food.orders`
WHERE status = 'paid'
GROUP BY order_date
ORDER BY order_date DESC;

-- 2. 人気メニューランキング
-- 注文回数が多いメニューのTOP10
SELECT
  item.name AS menu_name,
  SUM(CAST(item.quantity AS INT64)) AS total_quantity,
  SUM(CAST(item.price AS INT64) * CAST(item.quantity AS INT64)) AS total_revenue
FROM `gonmura_food.orders`,
  UNNEST(items) AS item
WHERE status = 'paid'
GROUP BY item.name
ORDER BY total_quantity DESC
LIMIT 10;

-- 3. 時間帯別注文数
-- どの時間帯に注文が集中しているか
SELECT
  EXTRACT(HOUR FROM TIMESTAMP_SECONDS(CAST(createdAt._seconds AS INT64))) AS order_hour,
  COUNT(*) AS order_count
FROM `gonmura_food.orders`
WHERE status IN ('paid', 'completed')
GROUP BY order_hour
ORDER BY order_hour;

-- 4. テーブル別売上
-- テーブルごとの利用回数と売上
SELECT
  tableNumber,
  COUNT(*) AS order_count,
  SUM(
    (SELECT SUM(CAST(item.price AS INT64) * CAST(item.quantity AS INT64))
     FROM UNNEST(items) AS item)
  ) AS total_revenue
FROM `gonmura_food.orders`
WHERE status = 'paid'
GROUP BY tableNumber
ORDER BY total_revenue DESC;

-- 5. カテゴリ別売上
-- メニューのカテゴリごとの売上集計（menusテーブルとJOIN）
SELECT
  c.name AS category_name,
  SUM(CAST(oi.quantity AS INT64)) AS total_quantity,
  SUM(CAST(oi.price AS INT64) * CAST(oi.quantity AS INT64)) AS total_revenue
FROM `gonmura_food.orders` o,
  UNNEST(o.items) AS oi
JOIN `gonmura_food.menus` m ON oi.menuId = m.id
JOIN `gonmura_food.categories` c ON c.id IN UNNEST(m.categoryIds)
WHERE o.status = 'paid'
GROUP BY c.name
ORDER BY total_revenue DESC;
