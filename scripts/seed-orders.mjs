// 既存 orders / customers を全削除し、過去1年分のテスト注文を生成する。
// 各 customer = 1テーブル来店セッション。1セッション1〜3注文。
//
// 使い方:
//   gcloud auth login 済みの状態で
//   node scripts/seed-orders.mjs
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";

const PROJECT = "gonmura-food";
const token = execSync("gcloud auth print-access-token").toString().trim();
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)`;

// ============== 設定 ==============
const END = new Date("2026-04-18T00:00:00+09:00"); // 今日
const START = new Date("2025-04-18T00:00:00+09:00"); // 1年前
const PRICE_CHANGE_DATE = new Date("2025-10-18T00:00:00+09:00"); // 半年地点

// 値上げするメニューと旧価格 (新価格は menus.price の現在値を使う)
const PRICE_CHANGES = [
  { menuId: "F2zoFM33eWfwECWUG7PN", oldPrice: 850 }, // ラーメン -> 900
  { menuId: "kYutrrRUh75etMp0lnTj", oldPrice: 1100 }, // チャーシューラーメン -> 1200
  { menuId: "e6kjLsFg4tqVDluV0XrE", oldPrice: 450 }, // 餃子(5個) -> 500
];
const NEW_PRICES = {
  F2zoFM33eWfwECWUG7PN: 900,
  kYutrrRUh75etMp0lnTj: 1200,
  e6kjLsFg4tqVDluV0XrE: 500,
};

// テーブル数
const TABLE_COUNT = 15;

// ============== Firestore REST helpers ==============
async function rest(method, path, body) {
  const res = await fetch(`${BASE}/${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`);
  return method === "DELETE" ? null : res.json();
}

async function deleteCollection(collectionId) {
  let deleted = 0;
  while (true) {
    const docs = await rest("POST", "documents:runQuery", {
      structuredQuery: { from: [{ collectionId }], limit: 300 },
    });
    const names = docs.filter((d) => d.document).map((d) => d.document.name);
    if (names.length === 0) break;
    for (let i = 0; i < names.length; i += 500) {
      await rest("POST", "documents:commit", {
        writes: names.slice(i, i + 500).map((name) => ({ delete: name })),
      });
    }
    deleted += names.length;
    if (deleted % 1500 === 0) console.log(`  削除済み: ${deleted}件`);
  }
  return deleted;
}

// ============== 1) menus 取得 ==============
console.log("→ メニュー取得中...");
const menusRes = await rest("POST", "documents:runQuery", {
  structuredQuery: { from: [{ collectionId: "menus" }] },
});
const menus = menusRes
  .filter((d) => d.document)
  .map((d) => {
    const f = d.document.fields;
    const id = d.document.name.split("/").pop();
    return {
      id,
      name: f.name?.stringValue,
      price: parseInt(f.price?.integerValue, 10),
      categoryIds: (f.categoryIds?.arrayValue?.values || []).map((v) => v.stringValue),
      status: f.status?.stringValue ?? "active",
    };
  });

const catsRes = await rest("GET", "documents/categories");
const catNameById = new Map(
  (catsRes.documents || []).map((d) => [
    d.name.split("/").pop(),
    d.fields?.name?.stringValue,
  ])
);
function hasCategory(menu, catName) {
  return menu.categoryIds.some((id) => catNameById.get(id) === catName);
}
const ramens = menus.filter((m) => hasCategory(m, "ラーメン") && m.status === "active");
const toppings = menus.filter((m) => hasCategory(m, "トッピング") && m.status === "active");
const sides = menus.filter((m) => hasCategory(m, "サイドメニュー") && m.status === "active");
const drinks = menus.filter((m) => hasCategory(m, "ドリンク") && m.status === "active");
console.log(`  ラーメン:${ramens.length} トッピング:${toppings.length} サイド:${sides.length} ドリンク:${drinks.length}`);

// ============== 2) 既存データ全削除 ==============
console.log("→ 既存 orders 削除中...");
console.log(`✔ 削除完了: ${await deleteCollection("orders")}件`);
console.log("→ 既存 customers 削除中...");
console.log(`✔ 削除完了: ${await deleteCollection("customers")}件`);

// ============== 3) 価格を新価格に更新 ==============
console.log("→ 価格更新中...");
for (const [id, newPrice] of Object.entries(NEW_PRICES)) {
  const url = `documents/menus/${id}?updateMask.fieldPaths=price&updateMask.fieldPaths=updatedAt`;
  await rest("PATCH", url, {
    fields: {
      price: { integerValue: String(newPrice) },
      updatedAt: { timestampValue: new Date().toISOString() },
    },
  });
  const m = menus.find((x) => x.id === id);
  console.log(`  ${m?.name} → ¥${newPrice}`);
}

// ============== 4) ヘルパー ==============
function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}
function pickWeighted(items) {
  const total = items.reduce((s, x) => s + x.weight, 0);
  let r = Math.random() * total;
  for (const x of items) {
    r -= x.weight;
    if (r <= 0) return x.value;
  }
  return items[items.length - 1].value;
}
function priceAt(menuId, date) {
  const ch = PRICE_CHANGES.find((c) => c.menuId === menuId);
  if (!ch) return menus.find((m) => m.id === menuId)?.price ?? 0;
  return date < PRICE_CHANGE_DATE ? ch.oldPrice : NEW_PRICES[menuId];
}

// 備考テンプレート (10%の確率で付く)
const NOTES = [
  "麺固め", "麺柔らかめ", "油多め", "油少なめ", "味濃いめ",
  "味薄め", "ネギ多め", "スープ多め", "辛さ控えめ", "にんにく抜き",
];

// 季節係数 (月 0-11)
const SEASON_FACTOR = [
  1.15, 1.15, 1.0, 0.95, 0.9, 0.9, // Jan-Jun
  0.9, 0.9, 0.95, 1.0, 1.15, 1.2,  // Jul-Dec
];
// 曜日別セッション数 (月-日)
const WEEKDAY_SESSIONS = [8, 8, 8, 9, 12, 16, 14];

// ============== 5) 注文・顧客生成 ==============
console.log("→ 注文・顧客生成中...");
const orderWrites = [];
const customerWrites = [];

let totalOrders = 0;
let totalCustomers = 0;

for (let day = new Date(START); day < END; day.setDate(day.getDate() + 1)) {
  const dow = (day.getDay() + 6) % 7; // 0=Mon
  const month = day.getMonth();
  const baseSessions = WEEKDAY_SESSIONS[dow];
  const seasonal = baseSessions * SEASON_FACTOR[month];
  const sessionCount = Math.max(1, Math.round(seasonal * (0.8 + Math.random() * 0.4)));

  // 使用中のテーブルを追跡（同日同テーブル重複を避ける）
  const usedTables = new Set();

  for (let s = 0; s < sessionCount; s++) {
    // テーブル番号: まだ使われていない番号から選ぶ
    let tableNumber;
    let attempts = 0;
    do {
      tableNumber = 1 + Math.floor(Math.random() * TABLE_COUNT);
      attempts++;
    } while (usedTables.has(tableNumber) && attempts < 30);
    usedTables.add(tableNumber);

    // 人数: 1〜5名 (ピーク時は大人数多め)
    const guestCount = pickWeighted([
      { value: 1, weight: 25 },
      { value: 2, weight: 35 },
      { value: 3, weight: 20 },
      { value: 4, weight: 15 },
      { value: 5, weight: 5 },
    ]);

    // 入店時間: ランチ or ディナー
    const isLunch = Math.random() < 0.4;
    const isWeekend = dow >= 5;
    const sessionHour = isLunch
      ? 11 + Math.floor(Math.random() * 3)
      : 17 + Math.floor(Math.random() * 5);
    const sessionMin = Math.floor(Math.random() * 60);

    const sessionDate = new Date(day);
    sessionDate.setHours(sessionHour, sessionMin, 0, 0);

    const customerId = `seed_c_${sessionDate.getTime().toString(36)}_${randomUUID().slice(0, 8)}`;

    // 顧客ドキュメント
    const isoSession = sessionDate.toISOString();
    customerWrites.push({
      update: {
        name: `projects/${PROJECT}/databases/(default)/documents/customers/${customerId}`,
        fields: {
          tableNumber: { integerValue: String(tableNumber) },
          guestCount: { integerValue: String(guestCount) },
          createdAt: { timestampValue: isoSession },
          updatedAt: { timestampValue: isoSession },
        },
      },
    });
    totalCustomers++;

    // このセッションの注文数 (1〜3回)
    const orderCount = pickWeighted([
      { value: 1, weight: 60 },
      { value: 2, weight: 30 },
      { value: 3, weight: 10 },
    ]);

    for (let oi = 0; oi < orderCount; oi++) {
      // 注文時刻: 入店から0〜40分後
      const orderTs = new Date(sessionDate.getTime() + oi * (10 + Math.floor(Math.random() * 15)) * 60 * 1000);
      const isoTs = orderTs.toISOString();

      // 人数分のラーメン (guestCountに合わせる、ただし追加注文は1〜2品)
      const items = [];
      const ramenCount = oi === 0
        ? guestCount  // 最初の注文はゲスト人数分
        : pickWeighted([{ value: 1, weight: 70 }, { value: 2, weight: 30 }]);

      for (let r = 0; r < ramenCount; r++) {
        const ramen = pick(ramens);
        const note = Math.random() < 0.1 ? pick(NOTES) : "";
        items.push({
          menuId: ramen.id,
          name: ramen.name,
          price: priceAt(ramen.id, orderTs),
          quantity: 1,
          note,
          toppings: [],
        });
        // トッピング (ラーメン1杯につき独立アイテムとして追加)
        const topCount = pickWeighted([
          { value: 0, weight: isWeekend ? 30 : 50 },
          { value: 1, weight: 45 },
          { value: 2, weight: isWeekend ? 25 : 5 },
        ]);
        const topPicked = new Set();
        for (let t = 0; t < topCount; t++) {
          const top = pick(toppings);
          if (topPicked.has(top.id)) continue;
          topPicked.add(top.id);
          items.push({
            menuId: top.id,
            name: top.name,
            price: priceAt(top.id, orderTs),
            quantity: 1,
            note: "",
            toppings: [],
          });
        }
      }

      // サイドメニュー (1回目か2回目注文で追加されやすい)
      const sideProb = isWeekend ? 0.6 : isLunch ? 0.25 : 0.45;
      if (Math.random() < sideProb) {
        const side = pick(sides);
        items.push({
          menuId: side.id,
          name: side.name,
          price: priceAt(side.id, orderTs),
          quantity: pickWeighted([{ value: 1, weight: 75 }, { value: 2, weight: 25 }]),
          note: "",
          toppings: [],
        });
      }

      // ドリンク (ディナーで高確率、人数分)
      const drinkProb = isLunch ? 0.15 : isWeekend ? 0.7 : 0.5;
      if (Math.random() < drinkProb) {
        const dr = pick(drinks);
        const qty = Math.min(guestCount, pickWeighted([
          { value: 1, weight: 50 },
          { value: 2, weight: 35 },
          { value: 3, weight: 15 },
        ]));
        items.push({
          menuId: dr.id,
          name: dr.name,
          price: priceAt(dr.id, orderTs),
          quantity: qty,
          note: "",
          toppings: [],
        });
      }

      const orderId = `seed_${orderTs.getTime().toString(36)}_${randomUUID().slice(0, 6)}`;
      orderWrites.push({
        update: {
          name: `projects/${PROJECT}/databases/(default)/documents/orders/${orderId}`,
          fields: {
            customerId: { stringValue: customerId },
            tableNumber: { integerValue: String(tableNumber) },
            guestCount: { integerValue: String(guestCount) },
            items: {
              arrayValue: {
                values: items.map((it) => ({
                  mapValue: {
                    fields: {
                      menuId: { stringValue: it.menuId },
                      name: { stringValue: it.name },
                      price: { integerValue: String(it.price) },
                      quantity: { integerValue: String(it.quantity) },
                      note: { stringValue: it.note },
                      checked: { booleanValue: true },
                      toppings: { arrayValue: { values: [] } },
                    },
                  },
                })),
              },
            },
            status: { stringValue: "paid" },
            customerNote: { stringValue: "" },
            createdAt: { timestampValue: isoTs },
            updatedAt: { timestampValue: isoTs },
          },
        },
      });
      totalOrders++;
    }
  }
}

console.log(`  顧客: ${totalCustomers}件 / 注文: ${totalOrders}件`);

// ============== 6) commit ==============
console.log("→ customers commit 中...");
for (let i = 0; i < customerWrites.length; i += 500) {
  await rest("POST", "documents:commit", { writes: customerWrites.slice(i, i + 500) });
  if ((i + 500) % 2500 === 0 || i + 500 >= customerWrites.length)
    console.log(`  ${Math.min(i + 500, customerWrites.length)}/${customerWrites.length}`);
}

console.log("→ orders commit 中...");
for (let i = 0; i < orderWrites.length; i += 500) {
  await rest("POST", "documents:commit", { writes: orderWrites.slice(i, i + 500) });
  if ((i + 500) % 2500 === 0 || i + 500 >= orderWrites.length)
    console.log(`  ${Math.min(i + 500, orderWrites.length)}/${orderWrites.length}`);
}

console.log(`✔ 完了: customers ${totalCustomers}件 / orders ${totalOrders}件`);
