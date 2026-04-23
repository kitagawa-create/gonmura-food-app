/**
 * 現在のスキーマに合わない Firestore データを削除するスクリプト。
 *
 * 削除対象:
 * - customer が存在しない order
 * - items が 0 件の order
 * - メイン item が存在しない order
 * - setId が空の item
 * - menuId / name が空の item
 * - price / quantity が不正な item
 * - menus に存在しない menuId を持つ item
 *
 * 使い方:
 *   node scripts/cleanup-invalid-orders.mjs          # dry-run
 *   node scripts/cleanup-invalid-orders.mjs --apply   # 削除実行
 */

import { execSync } from "node:child_process";

const PROJECT = "gonmura-food";
const APPLY = process.argv.includes("--apply");
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

function docId(name) {
  return name.split("/").pop();
}

console.log("→ customers 取得中...");
const customers = new Set();
let offset = 0;
while (true) {
  const res = await rest("POST", "documents:runQuery", {
    structuredQuery: {
      from: [{ collectionId: "customers" }],
      limit: 300,
      offset,
    },
  });
  const docs = res.filter((d) => d.document);
  for (const d of docs) customers.add(docId(d.document.name));
  offset += docs.length;
  if (docs.length < 300) break;
}
console.log(`  customers: ${customers.size}`);

console.log("→ orders 取得中...");
const orders = [];
offset = 0;
while (true) {
  const res = await rest("POST", "documents:runQuery", {
    structuredQuery: {
      from: [{ collectionId: "orders", allDescendants: true }],
      limit: 300,
      offset,
    },
  });
  const docs = res.filter((d) => d.document);
  for (const d of docs) {
    const path = d.document.name.split("/documents/")[1];
    const parts = path.split("/");
    const customerId = parts[1];
    orders.push({ name: d.document.name, customerId, orderId: parts[3] });
  }
  offset += docs.length;
  if (docs.length < 300) break;
}
console.log(`  orders: ${orders.length}`);

console.log("→ items 取得中...");
const itemsByOrder = new Map();
offset = 0;
while (true) {
  const res = await rest("POST", "documents:runQuery", {
    structuredQuery: {
      from: [{ collectionId: "items", allDescendants: true }],
      limit: 300,
      offset,
    },
  });
  const docs = res.filter((d) => d.document);
  for (const d of docs) {
    const path = d.document.name.split("/documents/")[1];
    const parts = path.split("/");
    const customerId = parts[1];
    const orderId = parts[3];
    const arr = itemsByOrder.get(`${customerId}/${orderId}`) ?? [];
    arr.push({ name: d.document.name, id: parts[5], data: d.document.fields ?? {} });
    itemsByOrder.set(`${customerId}/${orderId}`, arr);
  }
  offset += docs.length;
  if (docs.length < 300) break;
}
console.log(`  items groups: ${itemsByOrder.size}`);

console.log("→ menus 取得中...");
const menus = new Set();
offset = 0;
while (true) {
  const res = await rest("POST", "documents:runQuery", {
    structuredQuery: {
      from: [{ collectionId: "menus" }],
      limit: 300,
      offset,
    },
  });
  const docs = res.filter((d) => d.document);
  for (const d of docs) menus.add(docId(d.document.name));
  offset += docs.length;
  if (docs.length < 300) break;
}
console.log(`  menus: ${menus.size}`);

const deleteOrders = [];
const deleteItems = [];

function parseIntValue(v) {
  const n = Number(v?.integerValue ?? v?.doubleValue ?? NaN);
  return Number.isFinite(n) ? n : NaN;
}

function getString(v) {
  return typeof v?.stringValue === "string" ? v.stringValue : "";
}

for (const order of orders) {
  const customerExists = customers.has(order.customerId);
  const items = itemsByOrder.get(`${order.customerId}/${order.orderId}`) ?? [];
  const validItems = [];
  const invalidItemNames = [];

  for (const item of items) {
    const setId = getString(item.data.setId);
    const menuId = getString(item.data.menuId);
    const name = getString(item.data.name);
    const price = parseIntValue(item.data.price);
    const quantity = parseIntValue(item.data.quantity);
    const checked = item.data.checked?.booleanValue;
    const isMain = setId && setId === item.id;

    const invalid =
      !setId ||
      !menuId ||
      !menus.has(menuId) ||
      !name ||
      !Number.isFinite(price) ||
      price < 0 ||
      !Number.isFinite(quantity) ||
      quantity <= 0 ||
      (checked !== undefined && typeof checked !== "boolean");

    if (invalid) {
      invalidItemNames.push(item.name);
      continue;
    }

    validItems.push(item);
  }

  const mainItems = validItems.filter((it) => getString(it.data.setId) === it.id);

  if (!customerExists || validItems.length === 0 || mainItems.length === 0) {
    deleteOrders.push(order.name);
    deleteItems.push(...items.map((it) => it.name));
    continue;
  }

  const validMainIds = new Set(mainItems.map((it) => it.id));
  for (const item of validItems) {
    const setId = getString(item.data.setId);
    if (setId === item.id) continue;
    if (!validMainIds.has(setId)) {
      deleteItems.push(item.name);
    }
  }

  deleteItems.push(...invalidItemNames);
}

const uniqueDeleteOrders = [...new Set(deleteOrders)];
const uniqueDeleteItems = [...new Set(deleteItems)].filter((name) => !uniqueDeleteOrders.some((orderName) => name.startsWith(orderName + "/")));

console.log(`  delete orders: ${uniqueDeleteOrders.length}`);
console.log(`  delete items: ${uniqueDeleteItems.length}`);

if (!APPLY) {
  console.log("dry-run です。反映するなら --apply を付けてください。");
  process.exit(0);
}

if (uniqueDeleteItems.length > 0) {
  await batchDelete(uniqueDeleteItems);
}
if (uniqueDeleteOrders.length > 0) {
  await batchDelete(uniqueDeleteOrders);
}

console.log("✔ cleanup complete");
