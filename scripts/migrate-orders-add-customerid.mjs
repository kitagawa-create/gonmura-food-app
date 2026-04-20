// 既存 orders ドキュメントに customerId フィールドをバックフィルするスクリプト。
// パス customers/{customerId}/orders/{orderId} から customerId を取り出して書き込む。
// 既に customerId フィールドがある場合はスキップ。
//
// 使い方:
//   gcloud auth login 済みの状態で
//   node scripts/migrate-orders-add-customerid.mjs

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

// 全 orders を collectionGroup で取得し、customerId が未設定のものを収集
console.log("→ 全 orders 取得中（collectionGroup）...");
const targets = []; // { name, customerId }
let offset = 0;
while (true) {
  const res = await rest("POST", "documents:runQuery", {
    structuredQuery: {
      from: [{ collectionId: "orders", allDescendants: true }],
      select: { fields: [{ fieldPath: "customerId" }] },
      limit: 300,
      offset,
    },
  });
  const docs = res.filter((d) => d.document);
  for (const d of docs) {
    // パス例: projects/.../databases/(default)/documents/customers/{cid}/orders/{oid}
    const seg = d.document.name.split("/documents/")[1].split("/");
    // seg = ["customers", cid, "orders", oid]
    if (seg[0] !== "customers" || seg[2] !== "orders") continue;
    const customerId = seg[1];
    const hasField = d.document.fields?.customerId?.stringValue;
    if (!hasField) {
      targets.push({ name: d.document.name, customerId });
    }
  }
  offset += docs.length;
  if (docs.length < 300) break;
}
console.log(`  未設定 orders: ${targets.length} 件`);

if (targets.length === 0) {
  console.log("バックフィル不要です。");
  process.exit(0);
}

// 500件ずつ batchWrite で customerId を書き込む
console.log("→ customerId バックフィル中...");
let done = 0;
for (let i = 0; i < targets.length; i += 500) {
  const chunk = targets.slice(i, i + 500);
  await rest("POST", "documents:commit", {
    writes: chunk.map(({ name, customerId }) => ({
      update: {
        name,
        fields: { customerId: { stringValue: customerId } },
      },
      updateMask: { fieldPaths: ["customerId"] },
    })),
  });
  done += chunk.length;
  console.log(`  ${done} / ${targets.length} 件完了`);
}

console.log(`✔ 完了: ${targets.length} 件の orders に customerId を書き込みました`);
