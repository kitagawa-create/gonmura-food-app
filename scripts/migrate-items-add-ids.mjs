// 既存 items ドキュメントに id / orderId / customerId フィールドをバックフィルするスクリプト。
// パス customers/{cid}/orders/{oid}/items/{iid} から各 ID を取り出して書き込む。
// 既に全フィールドがある場合はスキップ。
//
// 使い方:
//   gcloud auth login 済みの状態で
//   node scripts/migrate-items-add-ids.mjs

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

// 全 items を collectionGroup で取得
console.log("→ 全 items 取得中（collectionGroup）...");
const targets = []; // { name, id, orderId, customerId, missing }
let offset = 0;
while (true) {
  const res = await rest("POST", "documents:runQuery", {
    structuredQuery: {
      from: [{ collectionId: "items", allDescendants: true }],
      select: { fields: [{ fieldPath: "id" }, { fieldPath: "orderId" }, { fieldPath: "customerId" }] },
      limit: 300,
      offset,
    },
  });
  const docs = res.filter((d) => d.document);
  for (const d of docs) {
    // パス例: projects/.../databases/(default)/documents/customers/{cid}/orders/{oid}/items/{iid}
    const seg = d.document.name.split("/documents/")[1].split("/");
    // seg = ["customers", cid, "orders", oid, "items", iid]
    if (seg[0] !== "customers" || seg[2] !== "orders" || seg[4] !== "items") continue;
    const customerId = seg[1];
    const orderId = seg[3];
    const id = seg[5];

    const fields = d.document.fields ?? {};
    const hasId = fields.id?.stringValue === id;
    const hasOrderId = fields.orderId?.stringValue === orderId;
    const hasCustomerId = fields.customerId?.stringValue === customerId;

    if (!hasId || !hasOrderId || !hasCustomerId) {
      targets.push({ name: d.document.name, id, orderId, customerId });
    }
  }
  offset += docs.length;
  if (docs.length < 300) break;
}
console.log(`  未設定/不一致 items: ${targets.length} 件`);

if (targets.length === 0) {
  console.log("バックフィル不要です。");
  process.exit(0);
}

// 500件ずつ batchWrite で書き込む
console.log("→ id / orderId / customerId バックフィル中...");
let done = 0;
for (let i = 0; i < targets.length; i += 500) {
  const chunk = targets.slice(i, i + 500);
  await rest("POST", "documents:commit", {
    writes: chunk.map(({ name, id, orderId, customerId }) => ({
      update: {
        name,
        fields: {
          id: { stringValue: id },
          orderId: { stringValue: orderId },
          customerId: { stringValue: customerId },
        },
      },
      updateMask: { fieldPaths: ["id", "orderId", "customerId"] },
    })),
  });
  done += chunk.length;
  console.log(`  ${done} / ${targets.length} 件完了`);
}

console.log(`✔ 完了: ${targets.length} 件の items に id/orderId/customerId を書き込みました`);
