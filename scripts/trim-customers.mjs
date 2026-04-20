// 既存 customers を 1/4 に削減するスクリプト。
// 関連する top-level orders（seed-orders.mjs 生成分）も合わせて削除する。
//
// 使い方:
//   gcloud auth login 済みの状態で
//   node scripts/trim-customers.mjs

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

// ============== 1) 全 customers 取得 ==============
console.log("→ customers 取得中...");
let allCustomers = [];
let nextPageToken;
do {
  const body = {
    structuredQuery: {
      from: [{ collectionId: "customers" }],
      limit: 300,
    },
  };
  if (nextPageToken) body.structuredQuery.offset = allCustomers.length;
  const res = await rest("POST", "documents:runQuery", body);
  const docs = res.filter((d) => d.document);
  allCustomers = allCustomers.concat(docs.map((d) => d.document.name.split("/").pop()));
  nextPageToken = docs.length === 300 ? true : null;
  if (docs.length < 300) break;
} while (nextPageToken);

console.log(`  取得: ${allCustomers.length} 件`);

// ============== 2) 削除対象を選定（3/4 を削除） ==============
const shuffled = allCustomers.sort(() => Math.random() - 0.5);
const keepCount = 500;
const toKeep = new Set(shuffled.slice(0, keepCount));
const toDelete = shuffled.slice(keepCount);

console.log(`  残す: ${keepCount} 件 / 削除: ${toDelete.length} 件`);

if (toDelete.length === 0) {
  console.log("削除対象がありません");
  process.exit(0);
}

// ============== 3) 削除対象の top-level orders 取得・削除 ==============
console.log("→ 関連 orders 取得中...");
const deleteSet = new Set(toDelete);
let orderNames = [];
let orderOffset = 0;

while (true) {
  const res = await rest("POST", "documents:runQuery", {
    structuredQuery: {
      from: [{ collectionId: "orders" }],
      limit: 300,
      offset: orderOffset,
    },
  });
  const docs = res.filter((d) => d.document);
  if (docs.length === 0) break;

  for (const d of docs) {
    const customerId = d.document.fields?.customerId?.stringValue;
    if (customerId && deleteSet.has(customerId)) {
      orderNames.push(d.document.name);
    }
  }

  orderOffset += docs.length;
  if (docs.length < 300) break;
}

console.log(`  削除対象 orders: ${orderNames.length} 件`);

// orders の items サブコレクションを削除
if (orderNames.length > 0) {
  console.log("→ orders/items 削除中...");
  let itemNames = [];
  for (const orderName of orderNames) {
    const orderId = orderName.split("/").pop();
    const res = await rest("POST", "documents:runQuery", {
      structuredQuery: {
        from: [{ collectionId: "items", allDescendants: false }],
        parent: orderName,
        limit: 100,
      },
    }).catch(() => []);
    const docs = (Array.isArray(res) ? res : []).filter((d) => d.document);
    itemNames = itemNames.concat(docs.map((d) => d.document.name));
  }
  if (itemNames.length > 0) {
    await batchDelete(itemNames);
    console.log(`  items 削除: ${itemNames.length} 件`);
  }

  console.log("→ orders 削除中...");
  await batchDelete(orderNames);
  console.log(`  orders 削除: ${orderNames.length} 件`);
}

// ============== 4) customers 削除 ==============
console.log("→ customers 削除中...");
const customerDocNames = toDelete.map(
  (id) => `projects/${PROJECT}/databases/(default)/documents/customers/${id}`
);
await batchDelete(customerDocNames);
console.log(`  customers 削除: ${customerDocNames.length} 件`);

console.log(`✔ 完了: ${keepCount} 件残存 / ${toDelete.length} 件削除`);
