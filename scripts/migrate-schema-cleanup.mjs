// 現在の型定義に合わせてFirestoreデータを整理する。
//
// 1. menus: status フィールドを追加（isAvailable/isSoldOut/isDeleted から変換）、旧フィールド削除
// 2. orders: stale フィールド（tableNumber, guestCount, customerNote, checkedItems, items）を削除
//
// 使い方:
//   gcloud auth login 済みの状態で
//   node scripts/migrate-schema-cleanup.mjs
import { execSync } from "node:child_process";

const PROJECT = "gonmura-food";
const token = execSync("gcloud auth print-access-token").toString().trim();
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)`;

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

// ============== 1) menus ==============
console.log("=== menus 移行 ===");
const menusRes = await rest("GET", "documents/menus");
const menus = menusRes.documents ?? [];
console.log(`  menus: ${menus.length} 件`);

const VALID_STATUSES = ["active", "soldout", "hidden", "deleted"];
const menuWrites = [];

for (const doc of menus) {
  const f = doc.fields;
  const hasValidStatus = typeof f.status?.stringValue === "string" && VALID_STATUSES.includes(f.status.stringValue);
  const hasOldFields = f.isAvailable !== undefined || f.isSoldOut !== undefined || f.isDeleted !== undefined;

  if (hasValidStatus && !hasOldFields) continue; // 何もしない

  const fieldsToWrite = {};
  const maskPaths = ["isAvailable", "isSoldOut", "isDeleted"];

  if (!hasValidStatus) {
    // 旧フィールドから status を導出
    let status;
    if (f.isDeleted?.booleanValue === true) status = "deleted";
    else if (f.isAvailable?.booleanValue === false) status = "hidden";
    else if (f.isSoldOut?.booleanValue === true) status = "soldout";
    else status = "active";
    fieldsToWrite.status = { stringValue: status };
    fieldsToWrite.updatedAt = { timestampValue: new Date().toISOString() };
    maskPaths.push("status", "updatedAt");
    console.log(`  [menu] ${f.name?.stringValue ?? doc.name.split("/").pop()}: isAvailable=${f.isAvailable?.booleanValue} → status="${status}"`);
  }

  menuWrites.push({
    update: { name: doc.name, fields: fieldsToWrite },
    updateMask: { fieldPaths: maskPaths },
  });
}

console.log(`  更新対象: ${menuWrites.length} 件`);
if (menuWrites.length > 0) {
  await rest("POST", "documents:commit", { writes: menuWrites });
  console.log("✔ menus 完了");
} else {
  console.log("✔ menus は更新不要");
}

// ============== 2) orders ==============
console.log("\n=== orders 移行 ===");
const ordersRes = await rest("POST", "documents:runQuery", {
  structuredQuery: { from: [{ collectionId: "orders" }] },
});
const orders = ordersRes.filter((d) => d.document);
console.log(`  orders: ${orders.length} 件`);

const STALE_ORDER_FIELDS = ["tableNumber", "guestCount", "customerNote", "checkedItems", "items"];
const orderWrites = [];

for (const d of orders) {
  const stale = STALE_ORDER_FIELDS.filter((field) => d.document.fields[field] !== undefined);
  if (stale.length === 0) continue;
  orderWrites.push({
    update: { name: d.document.name, fields: {} },
    updateMask: { fieldPaths: stale },
  });
}

console.log(`  stale フィールドあり: ${orderWrites.length} 件`);
if (orderWrites.length > 0) {
  for (let i = 0; i < orderWrites.length; i += 500) {
    await rest("POST", "documents:commit", { writes: orderWrites.slice(i, i + 500) });
    console.log(`  ${Math.min(i + 500, orderWrites.length)}/${orderWrites.length} 件完了`);
  }
  console.log("✔ orders 完了");
} else {
  console.log("✔ orders は更新不要");
}

console.log("\n✔ 全移行完了");
