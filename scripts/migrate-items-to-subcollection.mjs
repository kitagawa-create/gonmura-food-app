// ordersドキュメントに埋め込まれた items 配列を
// orders/{orderId}/items/{itemId} サブコレクションに移行する。
// 移行後、orderドキュメントから items フィールドを削除する。
//
// 使い方:
//   gcloud auth login 済みの状態で
//   node scripts/migrate-items-to-subcollection.mjs
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";

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

// ============== 1) 全 orders 取得 ==============
console.log("→ orders 取得中...");
const ordersRes = await rest("POST", "documents:runQuery", {
  structuredQuery: { from: [{ collectionId: "orders" }] },
});

const allOrders = ordersRes
  .filter((d) => d.document)
  .map((d) => ({
    name: d.document.name,
    id: d.document.name.split("/").pop(),
    fields: d.document.fields,
  }));

// 埋め込み items (arrayValue) を持つドキュメントだけ対象
const toMigrate = allOrders.filter(
  (o) => (o.fields.items?.arrayValue?.values?.length ?? 0) > 0
);

console.log(`  全 ${allOrders.length} 件中、埋め込みitems あり: ${toMigrate.length} 件`);

if (toMigrate.length === 0) {
  console.log("✔ 移行不要（埋め込みitemsなし）");
  process.exit(0);
}

// ============== 2) 書き込みリスト構築 ==============
const writes = [];
let totalItems = 0;

for (const order of toMigrate) {
  const embeddedItems = order.fields.items.arrayValue.values;

  for (const itemValue of embeddedItems) {
    const itemFields = itemValue.mapValue?.fields ?? {};

    // 旧 CartPanel は id フィールドを書き込んでいた。seed スクリプトは書いていない。
    // どちらでも動くよう: あれば流用、なければ新規採番。
    const itemId = itemFields.id?.stringValue ?? randomUUID();

    // id フィールドはドキュメントIDで代替するため除去して書き込む
    const { id: _dropped, ...fieldsToWrite } = itemFields;

    writes.push({
      update: {
        name: `projects/${PROJECT}/databases/(default)/documents/orders/${order.id}/items/${itemId}`,
        fields: fieldsToWrite,
      },
    });
    totalItems++;
  }

  // items フィールドをorderドキュメントから削除
  // updateMask に含めて fields に含めないと Firestore がフィールドを削除する
  writes.push({
    update: {
      name: order.name,
      fields: { updatedAt: { timestampValue: new Date().toISOString() } },
    },
    updateMask: { fieldPaths: ["items", "updatedAt"] },
  });
}

console.log(`→ 書き込み予定: ${toMigrate.length} 注文 / ${totalItems} アイテム`);

// ============== 3) 500 件ずつコミット ==============
for (let i = 0; i < writes.length; i += 500) {
  await rest("POST", "documents:commit", { writes: writes.slice(i, i + 500) });
  console.log(`  ${Math.min(i + 500, writes.length)}/${writes.length} 件コミット済み`);
}

console.log(`✔ 移行完了: ${toMigrate.length} 注文 / ${totalItems} アイテム`);
