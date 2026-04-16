// 既存 orders を全削除し、過去1年分のテスト注文を生成する。
// 半年地点 (PRICE_CHANGE_DATE) で対象3メニューの実 price も更新する。
//
// 使い方:
//   gcloud auth login 済みの状態で
//   node scripts/seed-orders.mjs
import { execSync } from "node:child_process";

const PROJECT = "gonmura-food";
const token = execSync("gcloud auth print-access-token").toString().trim();
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)`;

// ============== 設定 ==============
const END = new Date("2026-04-15T00:00:00+09:00"); // 今日
const START = new Date("2025-04-15T00:00:00+09:00"); // 1年前
const PRICE_CHANGE_DATE = new Date("2025-10-15T00:00:00+09:00"); // 半年地点

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
      isAvailable: f.isAvailable?.booleanValue,
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
const ramens = menus.filter((m) => hasCategory(m, "ラーメン") && m.isAvailable);
const toppings = menus.filter((m) => hasCategory(m, "トッピング") && m.isAvailable);
const sides = menus.filter((m) => hasCategory(m, "サイドメニュー") && m.isAvailable);
const drinks = menus.filter((m) => hasCategory(m, "ドリンク") && m.isAvailable);
console.log(`  ラーメン:${ramens.length} トッピング:${toppings.length} サイド:${sides.length} ドリンク:${drinks.length}`);

// ============== 2) 既存 orders 全削除 ==============
console.log("→ 既存 orders 削除中...");
let deletedCount = 0;
let pageToken;
while (true) {
  const body = {
    structuredQuery: { from: [{ collectionId: "orders" }], limit: 300 },
  };
  // runQuery は pageToken が無いので、毎回先頭300件を取って削除する。最終的に空になる。
  const docs = await rest("POST", "documents:runQuery", body);
  const ids = docs.filter((d) => d.document).map((d) => d.document.name);
  if (ids.length === 0) break;
  // バッチ削除 (commit endpoint)
  const writes = ids.map((name) => ({ delete: name }));
  // commit は最大500件
  for (let i = 0; i < writes.length; i += 500) {
    await rest("POST", "documents:commit", { writes: writes.slice(i, i + 500) });
  }
  deletedCount += ids.length;
  if (deletedCount % 1500 === 0) console.log(`  削除済み: ${deletedCount}件`);
}
console.log(`✔ 削除完了: ${deletedCount}件`);

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

// ============== 4) 注文生成 ==============
function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}
function pickWeighted(items) {
  // items: [{value, weight}]
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
  if (!ch) return menus.find((m) => m.id === menuId).price;
  return date < PRICE_CHANGE_DATE ? ch.oldPrice : NEW_PRICES[menuId];
}

// 季節係数 (月 0-11)
const SEASON_FACTOR = [
  1.15, 1.15, 1.0, 0.95, 0.9, 0.9, // Jan-Jun
  0.9, 0.9, 0.95, 1.0, 1.15, 1.2,  // Jul-Dec
];

// 曜日別件数 (月-日)
const WEEKDAY_COUNT = [10, 10, 10, 10, 14, 18, 16];

console.log("→ 注文生成中...");
const writes = [];
let totalGen = 0;
for (let day = new Date(START); day < END; day.setDate(day.getDate() + 1)) {
  const dow = (day.getDay() + 6) % 7; // 0=Mon
  const month = day.getMonth();
  const base = WEEKDAY_COUNT[dow];
  const seasonal = base * SEASON_FACTOR[month];
  // ±20% jitter
  const count = Math.max(1, Math.round(seasonal * (0.8 + Math.random() * 0.4)));

  for (let i = 0; i < count; i++) {
    // 時間帯: ランチ(11-14) 40% / ディナー(17-22) 60%
    const isLunch = Math.random() < 0.4;
    const hour = isLunch
      ? 11 + Math.floor(Math.random() * 3)
      : 17 + Math.floor(Math.random() * 5);
    const minute = Math.floor(Math.random() * 60);
    const second = Math.floor(Math.random() * 60);
    const ts = new Date(day);
    ts.setHours(hour, minute, second, 0);

    // 1注文の構成: ラーメン1〜2品 + トッピング(0-2) + サイド(0-1) + ドリンク(0-1)
    const items = [];
    // 主菜
    const ramenCount = pickWeighted([
      { value: 1, weight: 75 },
      { value: 2, weight: 25 },
    ]);
    for (let r = 0; r < ramenCount; r++) {
      const ramen = pick(ramens);
      items.push({
        menuId: ramen.id,
        name: ramen.name,
        price: priceAt(ramen.id, ts),
        quantity: 1,
      });
    }
    // トッピング (土日は確率高め)
    const isWeekend = dow >= 5;
    const topCount = pickWeighted([
      { value: 0, weight: isWeekend ? 25 : 45 },
      { value: 1, weight: 45 },
      { value: 2, weight: isWeekend ? 30 : 10 },
    ]);
    const topPicked = new Set();
    for (let t = 0; t < topCount; t++) {
      const top = pick(toppings);
      if (topPicked.has(top.id)) continue;
      topPicked.add(top.id);
      items.push({
        menuId: top.id,
        name: top.name,
        price: priceAt(top.id, ts),
        quantity: 1,
      });
    }
    // サイド (週末・ディナーで高め)
    const sideProb = isWeekend ? 0.55 : isLunch ? 0.25 : 0.4;
    if (Math.random() < sideProb) {
      const side = pick(sides);
      items.push({
        menuId: side.id,
        name: side.name,
        price: priceAt(side.id, ts),
        quantity: 1,
      });
    }
    // ドリンク (ディナー時間帯で高確率、ランチは低)
    const drinkProb = isLunch ? 0.2 : 0.55;
    if (Math.random() < drinkProb) {
      const dr = pick(drinks);
      items.push({
        menuId: dr.id,
        name: dr.name,
        price: priceAt(dr.id, ts),
        quantity: pickWeighted([
          { value: 1, weight: 80 },
          { value: 2, weight: 20 },
        ]),
      });
    }

    const tableNumber = 1 + Math.floor(Math.random() * 12);
    const orderId = `seed_${ts.getTime().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const isoTs = ts.toISOString();
    writes.push({
      update: {
        name: `projects/${PROJECT}/databases/(default)/documents/orders/${orderId}`,
        fields: {
          items: {
            arrayValue: {
              values: items.map((it) => ({
                mapValue: {
                  fields: {
                    menuId: { stringValue: it.menuId },
                    name: { stringValue: it.name },
                    price: { integerValue: String(it.price) },
                    quantity: { integerValue: String(it.quantity) },
                  },
                },
              })),
            },
          },
          status: { stringValue: "paid" },
          tableNumber: { integerValue: String(tableNumber) },
          customerNote: { stringValue: "" },
          createdAt: { timestampValue: isoTs },
          updatedAt: { timestampValue: isoTs },
        },
      },
    });
    totalGen++;
  }
}
console.log(`  生成件数: ${totalGen}件 / commit 中...`);

// 500件ずつ commit
for (let i = 0; i < writes.length; i += 500) {
  const chunk = writes.slice(i, i + 500);
  await rest("POST", "documents:commit", { writes: chunk });
  if ((i + 500) % 2500 === 0) console.log(`  ${i + chunk.length}/${writes.length}`);
}

console.log(`✔ 完了: ${totalGen}件投入`);
