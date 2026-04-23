/**
 * ファミレス注文シードスクリプト (seed-orders.mjs)
 *
 * 実行内容:
 * 1. status:"deleted" のメニューを物理削除
 * 2. 全 items (collectionGroup) 削除
 * 3. 全 orders (collectionGroup) 削除
 * 4. 全 customers 削除
 * 5. ファミレス仕様の1年分テスト注文を生成・投入
 *    構造: customers/{customerId}/orders/{orderId}/items/{itemId}
 *
 * 実行: node scripts/seed-orders.mjs
 */

import { initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { randomUUID } from "node:crypto";

initializeApp({ projectId: "gonmura-food" });
const db = getFirestore();

// ============================================================
// 設定
// ============================================================
const END   = new Date("2026-04-23T00:00:00+09:00");
const START = new Date("2025-04-23T00:00:00+09:00");

const NOTES = [
  "辛さ控えめ", "ソース別添え", "アレルギー注意", "量少なめ",
  "よく焼きで", "ドレッシング別", "チーズ抜き", "塩分控えめ",
  "大盛りで", "スープ多め",
];

// 季節係数 (月 0-11)
const SEASON_FACTOR = [
  1.1, 1.1, 1.0, 0.95, 1.0, 1.1,
  1.2, 1.2, 1.0, 1.0, 1.1, 1.2,
];
// 曜日別ベースセッション数 (月=0)
const WEEKDAY_SESSIONS = [3, 3, 3, 3, 4, 6, 6];

// ============================================================
// ヘルパー
// ============================================================
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

// バッチ書き込みヘルパー（500件制限を自動管理）
let _batch = db.batch();
let _batchOps = 0;
const MAX_OPS = 490;

async function batchSet(ref, data) {
  _batch.set(ref, data);
  _batchOps++;
  if (_batchOps >= MAX_OPS) await flushBatch();
}
async function batchDelete(ref) {
  _batch.delete(ref);
  _batchOps++;
  if (_batchOps >= MAX_OPS) await flushBatch();
}
async function flushBatch() {
  if (_batchOps > 0) {
    await _batch.commit();
    _batch = db.batch();
    _batchOps = 0;
  }
}

// collectionGroup を全件削除
async function deleteCollectionGroup(name) {
  let total = 0;
  while (true) {
    const snap = await db.collectionGroup(name).limit(400).get();
    if (snap.empty) break;
    for (const d of snap.docs) await batchDelete(d.ref);
    await flushBatch();
    total += snap.size;
    process.stdout.write(`\r  ${name}: ${total}件削除中...`);
  }
  console.log(`\r  ${name}: ${total}件 削除済み         `);
}

// ============================================================
// 1. メニュー・カテゴリ・テーブル取得
// ============================================================
console.log("→ データ取得中...");
const [menusSnap, catsSnap, tablesSnap] = await Promise.all([
  db.collection("menus").get(),
  db.collection("categories").get(),
  db.collection("tables").get(),
]);

const catNameById  = new Map(catsSnap.docs.map((d) => [d.id, d.data().name]));
const allMenus     = menusSnap.docs.map((d) => ({ id: d.id, ref: d.ref, ...d.data() }));
const activeMenus  = allMenus.filter((m) => m.status === "active");
const deletedMenus = allMenus.filter((m) => m.status === "deleted");

function inCategory(menu, catName) {
  return (menu.categoryIds ?? []).some((id) => catNameById.get(id) === catName);
}

const MAIN_CATS = ["ハンバーグ", "パスタ", "ピザ"];
const mains      = activeMenus.filter((m) => MAIN_CATS.some((c) => inCategory(m, c)));
const sides      = activeMenus.filter((m) => inCategory(m, "サイド"));
const saladSoups = activeMenus.filter((m) => inCategory(m, "サラダ・スープ"));
const desserts   = activeMenus.filter((m) => inCategory(m, "デザート"));
const drinks     = activeMenus.filter((m) => inCategory(m, "ドリンク"));

console.log(`  メイン:${mains.length} サイド:${sides.length} サラダ/スープ:${saladSoups.length} デザート:${desserts.length} ドリンク:${drinks.length}`);

const tableIds = tablesSnap.docs.filter((d) => !d.data().deleted).map((d) => d.id);
console.log(`  テーブル: ${tableIds.length}件`);

if (mains.length === 0) throw new Error("メインディッシュが0件です");
if (tableIds.length === 0) throw new Error("テーブルが0件です");

// ============================================================
// 2. deleted メニューを物理削除
// ============================================================
console.log(`\n→ deleted メニューを物理削除中... (${deletedMenus.length}件)`);
for (const m of deletedMenus) await batchDelete(m.ref);
await flushBatch();
console.log(`  ${deletedMenus.length}件 削除済み`);

// ============================================================
// 3. 既存 customers / orders / items を全削除
// ============================================================
console.log("\n→ 既存データを削除中...");
await deleteCollectionGroup("items");
await deleteCollectionGroup("orders");

let custDeleted = 0;
while (true) {
  const snap = await db.collection("customers").limit(400).get();
  if (snap.empty) break;
  for (const d of snap.docs) await batchDelete(d.ref);
  await flushBatch();
  custDeleted += snap.size;
}
console.log(`  customers: ${custDeleted}件 削除済み`);

// ============================================================
// 4. 新データ生成・投入
// ============================================================
console.log("\n→ 注文・顧客生成中...");
let totalCustomers = 0;
let totalOrders    = 0;
let totalItems     = 0;

for (let day = new Date(START); day < END; day.setDate(day.getDate() + 1)) {
  const dow       = (day.getDay() + 6) % 7; // 0=月
  const month     = day.getMonth();
  const isWeekend = dow >= 5;
  const base      = WEEKDAY_SESSIONS[dow] * SEASON_FACTOR[month];
  const sessionCount = Math.max(1, Math.round(base * (0.7 + Math.random() * 0.6)));

  const usedTableIds = new Set();

  for (let s = 0; s < sessionCount; s++) {
    // テーブル選択（同日同テーブル重複を避ける）
    let tableId;
    let attempts = 0;
    do {
      tableId = tableIds[Math.floor(Math.random() * tableIds.length)];
      attempts++;
    } while (usedTableIds.has(tableId) && attempts < 30);
    usedTableIds.add(tableId);

    const guestCount = pickWeighted([
      { value: 1, weight: 20 },
      { value: 2, weight: 35 },
      { value: 3, weight: 25 },
      { value: 4, weight: 15 },
      { value: 5, weight: 5 },
    ]);

    const isLunch     = Math.random() < 0.45;
    const sessionHour = isLunch
      ? 11 + Math.floor(Math.random() * 3)
      : 17 + Math.floor(Math.random() * 5);
    const sessionMin  = Math.floor(Math.random() * 60);
    const sessionDate = new Date(day);
    sessionDate.setHours(sessionHour, sessionMin, 0, 0);

    const customerId  = randomUUID();
    const customerRef = db.collection("customers").doc(customerId);

    await batchSet(customerRef, {
      customerId,
      tableId,
      guestCount,
      isPaid: true,
      createdAt: Timestamp.fromDate(sessionDate),
      updatedAt: Timestamp.fromDate(sessionDate),
    });
    totalCustomers++;

    const orderCount = pickWeighted([
      { value: 1, weight: 60 },
      { value: 2, weight: 30 },
      { value: 3, weight: 10 },
    ]);

    for (let oi = 0; oi < orderCount; oi++) {
      const orderTs  = new Date(sessionDate.getTime() + oi * (10 + Math.floor(Math.random() * 15)) * 60_000);
      const orderId  = randomUUID();
      const orderRef = customerRef.collection("orders").doc(orderId);

      await batchSet(orderRef, {
        orderId,
        customerId,
        status: "completed",
        createdAt: Timestamp.fromDate(orderTs),
        updatedAt: Timestamp.fromDate(orderTs),
      });
      totalOrders++;

      const itemList = [];

      // メインディッシュ（最初の注文はゲスト人数分、追加注文は1〜2品）
      const mainCount = oi === 0
        ? guestCount
        : pickWeighted([{ value: 1, weight: 70 }, { value: 2, weight: 30 }]);

      for (let r = 0; r < mainCount; r++) {
        const main = pick(mains);
        const note = Math.random() < 0.1 ? pick(NOTES) : "";
        const mainItemId = randomUUID();
        itemList.push({
          itemId: mainItemId,
          orderId,
          customerId,
          menuId: main.id,
          name: main.name,
          price: main.price,
          quantity: 1,
          setId: mainItemId,
          note,
          checked: true,
        });

        // サイド（メインに付ける、50%）
        if (sides.length > 0 && Math.random() < 0.5) {
          const side = pick(sides);
          itemList.push({
            itemId: randomUUID(),
            orderId,
            customerId,
            menuId: side.id,
            name: side.name,
            price: side.price,
            quantity: 1,
            setId: mainItemId,
            note: "",
            checked: true,
          });
        }
      }

      // サラダ・スープ（35%）
      if (saladSoups.length > 0 && Math.random() < 0.35) {
        const item = pick(saladSoups);
        const itemId = randomUUID();
        itemList.push({ itemId, orderId, customerId, menuId: item.id, name: item.name, price: item.price, quantity: 1, setId: itemId, note: "", checked: true });
      }

      // ドリンク（ランチ25%、ウィークデーディナー55%、週末70%）
      const drinkProb = isLunch ? 0.25 : isWeekend ? 0.7 : 0.55;
      if (drinks.length > 0 && Math.random() < drinkProb) {
        const dr  = pick(drinks);
        const qty = Math.min(guestCount, pickWeighted([
          { value: 1, weight: 50 },
          { value: 2, weight: 35 },
          { value: 3, weight: 15 },
        ]));
        const itemId = randomUUID();
        itemList.push({ itemId, orderId, customerId, menuId: dr.id, name: dr.name, price: dr.price, quantity: qty, setId: itemId, note: "", checked: true });
      }

      // デザート（最終注文で35%、それ以外10%）
      const dessertProb = oi === orderCount - 1 ? 0.35 : 0.1;
      if (desserts.length > 0 && Math.random() < dessertProb) {
        const des = pick(desserts);
        const itemId = randomUUID();
        itemList.push({ itemId, orderId, customerId, menuId: des.id, name: des.name, price: des.price, quantity: 1, setId: itemId, note: "", checked: true });
      }

      for (const item of itemList) {
        const itemRef = orderRef.collection("items").doc(item.itemId);
        await batchSet(itemRef, {
          ...item,
          createdAt: Timestamp.fromDate(orderTs),
          updatedAt: Timestamp.fromDate(orderTs),
        });
        totalItems++;
      }
    }
  }

  if (totalCustomers % 50 === 0) {
    process.stdout.write(`\r  顧客: ${totalCustomers} / 注文: ${totalOrders} / アイテム: ${totalItems}`);
  }
}

await flushBatch();
console.log(`\n\n✔ 完了: customers ${totalCustomers}件 / orders ${totalOrders}件 / items ${totalItems}件`);
