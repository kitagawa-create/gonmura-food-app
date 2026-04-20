// 削除済み customers に紐づく孤立 orders・items を削除するスクリプト
//
// 使い方:
//   gcloud auth login 済みの状態で
//   node scripts/cleanup-orphan-orders.mjs

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

async function batchDelete(names) {
  for (let i = 0; i < names.length; i += 500) {
    await rest("POST", "documents:commit", {
      writes: names.slice(i, i + 500).map((name) => ({ delete: name })),
    });
  }
}

// ============== 1) 現存 customers の ID セットを取得 ==============
console.log("→ 現存 customers 取得中...");
const existingCustomers = new Set();
let offset = 0;
while (true) {
  const res = await rest("POST", "documents:runQuery", {
    structuredQuery: {
      from: [{ collectionId: "customers" }],
      select: { fields: [] },
      limit: 300,
      offset,
    },
  });
  const docs = res.filter((d) => d.document);
  for (const d of docs) {
    existingCustomers.add(d.document.name.split("/").pop());
  }
  offset += docs.length;
  if (docs.length < 300) break;
}
console.log(`  現存: ${existingCustomers.size} 件`);

// ============== 2) 全 orders を collectionGroup で取得 ==============
console.log("→ 全 orders 取得中（collectionGroup）...");
const orphanOrderNames = [];
offset = 0;
while (true) {
  const res = await rest("POST", "documents:runQuery", {
    structuredQuery: {
      from: [{ collectionId: "orders", allDescendants: true }],
      select: { fields: [] },
      limit: 300,
      offset,
    },
  });
  const docs = res.filter((d) => d.document);
  for (const d of docs) {
    // パス例: .../documents/customers/{customerId}/orders/{orderId}
    const parts = d.document.name.split("/documents/")[1].split("/");
    const customerId = parts[1]; // customers/{customerId}
    if (parts[0] === "customers" && !existingCustomers.has(customerId)) {
      orphanOrderNames.push(d.document.name);
    }
  }
  offset += docs.length;
  if (docs.length < 300) break;
}
console.log(`  孤立 orders: ${orphanOrderNames.length} 件`);

if (orphanOrderNames.length === 0) {
  console.log("孤立データはありません");
  process.exit(0);
}

// ============== 3) 孤立 orders の items を取得・削除 ==============
console.log("→ items 取得・削除中...");
let totalItems = 0;
for (let i = 0; i < orphanOrderNames.length; i += 50) {
  const batch = orphanOrderNames.slice(i, i + 50);
  const itemNames = [];
  for (const orderName of batch) {
    const res = await rest("POST", "documents:runQuery", {
      structuredQuery: {
        from: [{ collectionId: "items" }],
        select: { fields: [] },
        limit: 100,
      },
      parent: orderName,
    }).catch(() => []);
    const docs = (Array.isArray(res) ? res : []).filter((d) => d.document);
    itemNames.push(...docs.map((d) => d.document.name));
  }
  if (itemNames.length > 0) {
    await batchDelete(itemNames);
    totalItems += itemNames.length;
  }
  if ((i + 50) % 500 === 0) console.log(`  items 処理済み: ${i + 50} orders`);
}
console.log(`  items 削除: ${totalItems} 件`);

// ============== 4) 孤立 orders を削除 ==============
console.log("→ orders 削除中...");
await batchDelete(orphanOrderNames);
console.log(`  orders 削除: ${orphanOrderNames.length} 件`);

console.log(`✔ 完了: orders ${orphanOrderNames.length} 件 / items ${totalItems} 件 削除`);
