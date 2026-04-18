// orders/{orderId}/items/{itemId} に createdAt / updatedAt がない場合、
// 親 order の createdAt を流用してタイムスタンプを付与する。
//
// 使い方:
//   gcloud auth login 済みの状態で
//   node scripts/migrate-items-add-timestamps.mjs
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

// ============== 1) 全 orders 取得 (createdAt マップを作る) ==============
console.log("→ orders 取得中...");
const ordersRes = await rest("POST", "documents:runQuery", {
  structuredQuery: { from: [{ collectionId: "orders" }] },
});
const orderCreatedAt = new Map(
  ordersRes
    .filter((d) => d.document)
    .map((d) => [
      d.document.name.split("/").pop(),
      d.document.fields.createdAt?.timestampValue ?? new Date().toISOString(),
    ])
);
console.log(`  orders: ${orderCreatedAt.size} 件`);

// ============== 2) 全 items (collectionGroup) 取得 ==============
console.log("→ items 取得中 (collectionGroup)...");
const itemsRes = await rest("POST", "documents:runQuery", {
  structuredQuery: {
    from: [{ collectionId: "items", allDescendants: true }],
  },
});
const allItems = itemsRes.filter((d) => d.document);
console.log(`  items: ${allItems.length} 件`);

// createdAt がないアイテムのみ対象
const toUpdate = allItems.filter(
  (d) => !d.document.fields.createdAt
);
console.log(`  タイムスタンプなし: ${toUpdate.length} 件`);

if (toUpdate.length === 0) {
  console.log("✔ 移行不要");
  process.exit(0);
}

// ============== 3) 書き込みリスト構築 ==============
const writes = [];
for (const d of toUpdate) {
  // name 例: projects/.../documents/orders/ORDER_ID/items/ITEM_ID
  const parts = d.document.name.split("/");
  const orderId = parts[parts.length - 3];
  const ts = orderCreatedAt.get(orderId) ?? new Date().toISOString();

  writes.push({
    update: {
      name: d.document.name,
      fields: {
        createdAt: { timestampValue: ts },
        updatedAt: { timestampValue: ts },
      },
    },
    updateMask: { fieldPaths: ["createdAt", "updatedAt"] },
  });
}

// ============== 4) 500 件ずつコミット ==============
console.log(`→ ${writes.length} 件を更新中...`);
for (let i = 0; i < writes.length; i += 500) {
  await rest("POST", "documents:commit", { writes: writes.slice(i, i + 500) });
  console.log(`  ${Math.min(i + 500, writes.length)}/${writes.length} 件完了`);
}

console.log(`✔ 完了: ${writes.length} アイテムにタイムスタンプを付与`);
