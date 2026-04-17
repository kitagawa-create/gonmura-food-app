// guestCount がない全 orders に 1-4 のランダム値を付与する
// 使い方: node scripts/add-guest-count.mjs
import { execSync } from "node:child_process";

const PROJECT = "gonmura-food";
const token = execSync("gcloud auth print-access-token").toString().trim();
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)`;

async function listAllOrders() {
  let docs = [];
  let pageToken = null;
  do {
    const url = `${BASE}/documents/orders?pageSize=300${pageToken ? `&pageToken=${pageToken}` : ""}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const json = await res.json();
    if (json.documents) docs = docs.concat(json.documents);
    pageToken = json.nextPageToken ?? null;
  } while (pageToken);
  return docs;
}

function rand14() {
  return Math.floor(Math.random() * 4) + 1;
}

async function patchGuestCount(docName, value) {
  // docName is already the full resource path like "projects/.../documents/orders/ID"
  const url = `https://firestore.googleapis.com/v1/${docName}?updateMask.fieldPaths=guestCount`;
  const body = JSON.stringify({
    fields: { guestCount: { integerValue: String(value) } },
  });
  const res = await fetch(url, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body,
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`PATCH ${docName} failed: ${t}`);
  }
}

const docs = await listAllOrders();
console.log(`Total orders: ${docs.length}`);

const missing = docs.filter((d) => !d.fields?.guestCount);
console.log(`Missing guestCount: ${missing.length}`);

// 20件並列でバッチ処理
const BATCH = 20;
let done = 0;
for (let i = 0; i < missing.length; i += BATCH) {
  const chunk = missing.slice(i, i + BATCH);
  await Promise.all(
    chunk.map((d) => patchGuestCount(d.name, rand14()))
  );
  done += chunk.length;
  console.log(`Updated ${done}/${missing.length}`);
}

console.log("Done.");
