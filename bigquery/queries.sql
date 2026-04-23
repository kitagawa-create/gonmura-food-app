-- ============================================================
-- Gonmura Food BigQuery 分析クエリ集
-- 現行 Firestore スキーマ前提
--
-- 前提:
-- - customers.isPaid = true が精算済み
-- - orders.status は pending / completed
-- - items は orderId / customerId / setId を持つフラット明細
--
-- BigQuery 側のテーブル名はエクスポート設定に合わせて調整すること。
-- ここでは customers / orders / items に展開されている前提で記述する。
-- ============================================================


-- ============================================================
-- 1. 日別売上レポート（直近30日）
-- ============================================================
WITH paid_orders AS (
  SELECT
    o.orderId,
    o.customerId,
    TIMESTAMP_SECONDS(CAST(o.createdAt._seconds AS INT64)) AS ordered_at
  FROM `gonmura_food.orders` o
  JOIN `gonmura_food.customers` c
    ON c.customerId = o.customerId
  WHERE c.isPaid = TRUE
    AND TIMESTAMP_SECONDS(CAST(o.createdAt._seconds AS INT64))
        >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 30 DAY)
)
SELECT
  DATE(ordered_at, "Asia/Tokyo") AS 日付,
  COUNT(DISTINCT customerId) AS 精算組数,
  COUNT(DISTINCT orderId) AS 注文件数,
  SUM(CAST(i.price AS INT64) * CAST(i.quantity AS INT64)) AS 売上合計
FROM paid_orders po
JOIN `gonmura_food.items` i
  ON i.orderId = po.orderId
GROUP BY 日付
ORDER BY 日付 DESC;


-- ============================================================
-- 2. 月別売上レポート
-- ============================================================
WITH paid_orders AS (
  SELECT
    o.orderId,
    o.customerId,
    TIMESTAMP_SECONDS(CAST(o.createdAt._seconds AS INT64)) AS ordered_at
  FROM `gonmura_food.orders` o
  JOIN `gonmura_food.customers` c
    ON c.customerId = o.customerId
  WHERE c.isPaid = TRUE
)
SELECT
  FORMAT_TIMESTAMP('%Y-%m', ordered_at, 'Asia/Tokyo') AS 月,
  COUNT(DISTINCT customerId) AS 精算組数,
  COUNT(DISTINCT orderId) AS 注文件数,
  SUM(CAST(i.price AS INT64) * CAST(i.quantity AS INT64)) AS 売上合計
FROM paid_orders po
JOIN `gonmura_food.items` i
  ON i.orderId = po.orderId
GROUP BY 月
ORDER BY 月 DESC;


-- ============================================================
-- 3. 人気メニューランキング
-- ============================================================
SELECT
  i.name AS メニュー名,
  SUM(CAST(i.quantity AS INT64)) AS 注文数,
  SUM(CAST(i.price AS INT64) * CAST(i.quantity AS INT64)) AS 売上
FROM `gonmura_food.items` i
JOIN `gonmura_food.customers` c
  ON c.customerId = i.customerId
WHERE c.isPaid = TRUE
GROUP BY メニュー名
ORDER BY 売上 DESC, 注文数 DESC;


-- ============================================================
-- 4. サイド追加率
-- ============================================================
WITH paid_main_items AS (
  SELECT
    i.orderId,
    i.itemId,
    i.setId,
    i.name
  FROM `gonmura_food.items` i
  JOIN `gonmura_food.customers` c
    ON c.customerId = i.customerId
  WHERE c.isPaid = TRUE
    AND i.itemId = i.setId
),
paid_side_items AS (
  SELECT DISTINCT
    i.orderId,
    i.setId
  FROM `gonmura_food.items` i
  JOIN `gonmura_food.customers` c
    ON c.customerId = i.customerId
  WHERE c.isPaid = TRUE
    AND i.itemId != i.setId
)
SELECT
  m.name AS メイン商品,
  COUNT(*) AS セット数,
  COUNTIF(s.setId IS NOT NULL) AS サイド追加セット数,
  ROUND(COUNTIF(s.setId IS NOT NULL) / COUNT(*) * 100, 1) AS サイド追加率
FROM paid_main_items m
LEFT JOIN paid_side_items s
  ON s.orderId = m.orderId
 AND s.setId = m.setId
GROUP BY メイン商品
ORDER BY サイド追加率 DESC, セット数 DESC;
