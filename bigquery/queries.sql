-- ============================================================
-- Gonmura Food BigQuery 分析クエリ集
-- Firestore → BigQuery エクスポート済みの前提
-- データセット: gonmura_food
-- テーブル: orders, menus, categories
-- ============================================================


-- ============================================================
-- 1-a. 日別売上レポート（直近30日）
-- 用途: 毎日の売上推移を確認
-- ============================================================
SELECT
  DATE(TIMESTAMP_SECONDS(CAST(createdAt._seconds AS INT64))) AS 日付,
  COUNT(DISTINCT CONCAT(CAST(tableNumber AS STRING), '-', CAST(DATE(TIMESTAMP_SECONDS(CAST(createdAt._seconds AS INT64))) AS STRING))) AS 来客テーブル数,
  COUNT(*) AS 注文件数,
  SUM(
    (SELECT SUM(CAST(item.price AS INT64) * CAST(item.quantity AS INT64))
     FROM UNNEST(items) AS item)
  ) AS 売上合計,
  ROUND(
    SUM(
      (SELECT SUM(CAST(item.price AS INT64) * CAST(item.quantity AS INT64))
       FROM UNNEST(items) AS item)
    ) / COUNT(DISTINCT CONCAT(CAST(tableNumber AS STRING), '-', CAST(DATE(TIMESTAMP_SECONDS(CAST(createdAt._seconds AS INT64))) AS STRING))),
    0
  ) AS テーブル単価平均
FROM `gonmura_food.orders`
WHERE status = 'paid'
  AND TIMESTAMP_SECONDS(CAST(createdAt._seconds AS INT64))
      >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 30 DAY)
GROUP BY 日付
ORDER BY 日付 DESC;


-- ============================================================
-- 1-b. 週別売上レポート（直近12週）
-- 用途: 週単位の売上トレンドを確認
-- ============================================================
SELECT
  DATE_TRUNC(DATE(TIMESTAMP_SECONDS(CAST(createdAt._seconds AS INT64))), WEEK(MONDAY)) AS 週начало,
  COUNT(DISTINCT CONCAT(CAST(tableNumber AS STRING), '-', CAST(DATE(TIMESTAMP_SECONDS(CAST(createdAt._seconds AS INT64))) AS STRING))) AS 来客テーブル数,
  COUNT(*) AS 注文件数,
  SUM(
    (SELECT SUM(CAST(item.price AS INT64) * CAST(item.quantity AS INT64))
     FROM UNNEST(items) AS item)
  ) AS 売上合計,
  ROUND(
    SUM(
      (SELECT SUM(CAST(item.price AS INT64) * CAST(item.quantity AS INT64))
       FROM UNNEST(items) AS item)
    ) / COUNT(DISTINCT CONCAT(CAST(tableNumber AS STRING), '-', CAST(DATE(TIMESTAMP_SECONDS(CAST(createdAt._seconds AS INT64))) AS STRING))),
    0
  ) AS テーブル単価平均
FROM `gonmura_food.orders`
WHERE status = 'paid'
  AND TIMESTAMP_SECONDS(CAST(createdAt._seconds AS INT64))
      >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 84 DAY)
GROUP BY 週начало
ORDER BY 週начало DESC;


-- ============================================================
-- 1-c. 月別売上レポート（全期間）
-- 用途: 月単位の売上推移。季節変動の把握
-- ============================================================
SELECT
  FORMAT_DATE('%Y-%m', DATE(TIMESTAMP_SECONDS(CAST(createdAt._seconds AS INT64)))) AS 月,
  COUNT(DISTINCT CONCAT(CAST(tableNumber AS STRING), '-', CAST(DATE(TIMESTAMP_SECONDS(CAST(createdAt._seconds AS INT64))) AS STRING))) AS 来客テーブル数,
  COUNT(*) AS 注文件数,
  SUM(
    (SELECT SUM(CAST(item.price AS INT64) * CAST(item.quantity AS INT64))
     FROM UNNEST(items) AS item)
  ) AS 売上合計,
  ROUND(
    SUM(
      (SELECT SUM(CAST(item.price AS INT64) * CAST(item.quantity AS INT64))
       FROM UNNEST(items) AS item)
    ) / COUNT(DISTINCT CONCAT(CAST(tableNumber AS STRING), '-', CAST(DATE(TIMESTAMP_SECONDS(CAST(createdAt._seconds AS INT64))) AS STRING))),
    0
  ) AS テーブル単価平均
FROM `gonmura_food.orders`
WHERE status = 'paid'
GROUP BY 月
ORDER BY 月 DESC;


-- ============================================================
-- 2. メニュー別ABC分析
-- 用途: 売上貢献度が高いメニューを把握。下位メニューの入替検討
-- ============================================================
WITH menu_sales AS (
  SELECT
    item.name AS メニュー名,
    SUM(CAST(item.quantity AS INT64)) AS 注文数,
    SUM(CAST(item.price AS INT64) * CAST(item.quantity AS INT64)) AS 売上,
  FROM `gonmura_food.orders`,
    UNNEST(items) AS item
  WHERE status = 'paid'
  GROUP BY item.name
),
ranked AS (
  SELECT
    *,
    SUM(売上) OVER (ORDER BY 売上 DESC) AS 累積売上,
    SUM(売上) OVER () AS 総売上
  FROM menu_sales
)
SELECT
  メニュー名,
  注文数,
  売上,
  ROUND(売上 / 総売上 * 100, 1) AS 売上構成比,
  ROUND(累積売上 / 総売上 * 100, 1) AS 累積構成比,
  CASE
    WHEN 累積売上 / 総売上 <= 0.7 THEN 'A（主力）'
    WHEN 累積売上 / 総売上 <= 0.9 THEN 'B（準主力）'
    ELSE 'C（検討）'
  END AS ランク
FROM ranked
ORDER BY 売上 DESC;


-- ============================================================
-- 3. ピーク時間帯分析
-- 用途: スタッフのシフト配置に活用。曜日×時間帯で忙しさを可視化
-- ============================================================
SELECT
  FORMAT_TIMESTAMP('%A', TIMESTAMP_SECONDS(CAST(createdAt._seconds AS INT64)), 'Asia/Tokyo') AS 曜日,
  EXTRACT(HOUR FROM TIMESTAMP_SECONDS(CAST(createdAt._seconds AS INT64)) AT TIME ZONE 'Asia/Tokyo') AS 時間帯,
  COUNT(*) AS 注文件数,
  SUM(
    (SELECT SUM(CAST(item.price AS INT64) * CAST(item.quantity AS INT64))
     FROM UNNEST(items) AS item)
  ) AS 売上
FROM `gonmura_food.orders`
WHERE status IN ('paid', 'completed')
GROUP BY 曜日, 時間帯
ORDER BY 時間帯, 曜日;


-- ============================================================
-- 4. カテゴリ別売上と注文率
-- 用途: トッピングやドリンクの追加注文率を把握。セット提案の参考に
-- ============================================================
WITH total AS (
  SELECT COUNT(DISTINCT id) AS 総注文数
  FROM `gonmura_food.orders`
  WHERE status = 'paid'
),
category_stats AS (
  SELECT
    c.name AS カテゴリ,
    COUNT(DISTINCT o.id) AS 注文に含まれた件数,
    SUM(CAST(oi.quantity AS INT64)) AS 注文数量,
    SUM(CAST(oi.price AS INT64) * CAST(oi.quantity AS INT64)) AS 売上
  FROM `gonmura_food.orders` o,
    UNNEST(o.items) AS oi
  JOIN `gonmura_food.menus` m ON oi.menuId = m.id
  JOIN `gonmura_food.categories` c ON c.id IN UNNEST(m.categoryIds)
  WHERE o.status = 'paid'
  GROUP BY c.name
)
SELECT
  cs.カテゴリ,
  cs.注文数量,
  cs.売上,
  ROUND(cs.注文に含まれた件数 / t.総注文数 * 100, 1) AS 注文率,
  -- 注文率 = この カテゴリが含まれる注文の割合
  -- 例: トッピング注文率40% → 10件中4件がトッピングを追加
FROM category_stats cs
CROSS JOIN total t
ORDER BY cs.売上 DESC;
