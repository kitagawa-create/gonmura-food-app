// 既存 orders ドキュメントに id フィールドをバックフィルするスクリプト。
// パス ... /orders/{orderId} からドキュメントIDを取り出して id フィールドに書き込む。
// 既に id フィールドがある場合はスキップ。
//
// 使い方:
//   gcloud auth login 済みの状態で
//   node scripts/migrate-orders-add-id.mjs

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

console.log("→ 全 orders 取得中（collectionGroup）...");
const targets = [];
let offset = 0;
while (true) {
  const res = await rest("POST", "documents:runQuery", {
    structuredQuery: {
      from: [{ collectionId: "orders", allDescendants: true }],
      select: { fields: [{ fieldPath: "id" }] },
      limit: 300,
      offset,
    },
  });
  const docs = res.filter((d) => d.document);
  for (const d of docs) {
    const seg = d.document.name.split("/documents/")[1].split("/");
    if (seg[0] !== "customers" || seg[2] !== "orders") continue;
    const orderId = seg[3];
    const hasId = d.document.fields?.id?.stringValue === orderId;
    if (!hasId) {
      targets.push({ name: d.document.name, id: orderId });
    }
  }
  offset += docs.length;
  if (docs.length < 300) break;
}
console.log(`  未設定/不一致 orders: ${targets.length} 件`);

if (targets.length === 0) {
  console.log("バックフィル不要です。");
  process.exit(0);
}

console.log("→ id バックフィル中...");
let done = 0;
for (let i = 0; i < targets.length; i += 500) {
  const chunk = targets.slice(i, i + 500);
  await rest("POST", "documents:commit", {
    writes: chunk.map(({ name, id }) => ({
      update: {
        name,
        fields: { id: { stringValue: id } },
      },
      updateMask: { fieldPaths: ["id"] },
    })),
  });
  done += chunk.length;
  console.log(`  ${done} / ${targets.length} 件完了`);
}

console.log(`✔ 完了: ${targets.length} 件の orders に id を書き込みました`);
