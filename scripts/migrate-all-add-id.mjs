// categories / menus / tables / customers の既存ドキュメントに id フィールドをバックフィルするスクリプト。
// ドキュメントIDを id フィールドに書き込む。既に正しい値がある場合はスキップ。
//
// 使い方:
//   gcloud auth login 済みの状態で
//   node scripts/migrate-all-add-id.mjs

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

async function backfillCollection(collectionId) {
  console.log(`\n→ ${collectionId} 取得中...`);
  const targets = [];
  let offset = 0;
  while (true) {
    const res = await rest("POST", "documents:runQuery", {
      structuredQuery: {
        from: [{ collectionId, allDescendants: false }],
        select: { fields: [{ fieldPath: "id" }] },
        limit: 300,
        offset,
      },
    });
    const docs = res.filter((d) => d.document);
    for (const d of docs) {
      const docId = d.document.name.split("/").pop();
      const hasId = d.document.fields?.id?.stringValue === docId;
      if (!hasId) {
        targets.push({ name: d.document.name, id: docId });
      }
    }
    offset += docs.length;
    if (docs.length < 300) break;
  }
  console.log(`  未設定/不一致: ${targets.length} 件`);

  if (targets.length === 0) return;

  let done = 0;
  for (let i = 0; i < targets.length; i += 500) {
    const chunk = targets.slice(i, i + 500);
    await rest("POST", "documents:commit", {
      writes: chunk.map(({ name, id }) => ({
        update: { name, fields: { id: { stringValue: id } } },
        updateMask: { fieldPaths: ["id"] },
      })),
    });
    done += chunk.length;
    console.log(`  ${done} / ${targets.length} 件完了`);
  }
  console.log(`✔ ${collectionId}: ${targets.length} 件に id を書き込みました`);
}

await backfillCollection("categories");
await backfillCollection("menus");
await backfillCollection("tables");
await backfillCollection("customers");

console.log("\n✔ 全コレクションのバックフィル完了");
