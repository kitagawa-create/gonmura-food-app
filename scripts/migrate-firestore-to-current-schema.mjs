/**
 * Firestore の既存データを現在のコードに合わせる移行スクリプト
 *
 * 変更内容:
 * - customers.isPaid を必ず boolean にする（未設定は false）
 * - orders.status を "pending" / "completed" に正規化
 * - items の旧 toppings を side item docs に分解
 * - items.setId / checked / note / quantity を現在スキーマに正規化
 *
 * 使い方:
 *   node scripts/migrate-firestore-to-current-schema.mjs        # dry-run
 *   node scripts/migrate-firestore-to-current-schema.mjs --apply
 */

import { initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";
import { randomUUID } from "node:crypto";

initializeApp({ projectId: "gonmura-food" });
const db = getFirestore();
const APPLY = process.argv.includes("--apply");

function isTimestampLike(v) {
  return v && typeof v.toDate === "function";
}

function toTimestamp(v) {
  if (isTimestampLike(v)) return v;
  if (v instanceof Date) return Timestamp.fromDate(v);
  return Timestamp.now();
}

function normalizeStatus(status) {
  return status === "completed" ? "completed" : "pending";
}

function normalizeSetId(itemId, setId, toppings) {
  if (typeof setId === "string" && setId) return setId;
  if (Array.isArray(toppings) && toppings.length > 0) return itemId;
  return itemId;
}

function asDate(v) {
  if (v && typeof v.toDate === "function") return v.toDate();
  if (v instanceof Date) return v;
  return null;
}

async function main() {
  const customersSnap = await db.collection("customers").get();
  const customerUpdates = [];
  for (const doc of customersSnap.docs) {
    const data = doc.data();
    const ordersSnap = await doc.ref.collection("orders").get();
    let hasCompleted = false;
    let latestPaidAt = null;
    for (const orderDoc of ordersSnap.docs) {
      const order = orderDoc.data();
      const normalized = normalizeStatus(order.status);
      if (normalized === "completed" || order.status === "paid") {
        hasCompleted = true;
      }
      const candidates = [
        asDate(order.updatedAt),
        asDate(order.createdAt),
        ...((Array.isArray(order.items) ? order.items : [])
          .flatMap((it) => [asDate(it.updatedAt), asDate(it.createdAt)])
          .filter(Boolean)),
      ].filter(Boolean);
      for (const candidate of candidates) {
        if (!latestPaidAt || candidate > latestPaidAt) latestPaidAt = candidate;
      }
    }

    const updates = {};
    const nextIsPaid = hasCompleted;
    if (data.isPaid !== nextIsPaid) updates.isPaid = nextIsPaid;
    if (data.tableId === undefined || typeof data.tableId !== "string") updates.tableId = typeof data.tableId === "string" ? data.tableId : "";
    if (typeof data.guestCount !== "number" || !Number.isFinite(data.guestCount) || data.guestCount <= 0) updates.guestCount = 1;
    if (latestPaidAt) updates.updatedAt = Timestamp.fromDate(latestPaidAt);
    if (typeof data.createdAt !== "object" || !isTimestampLike(data.createdAt)) {
      updates.createdAt = latestPaidAt ? Timestamp.fromDate(latestPaidAt) : Timestamp.now();
    }
    if (Object.keys(updates).length > 0) customerUpdates.push({ ref: doc.ref, updates });
  }

  const ordersSnap = await db.collectionGroup("orders").get();
  const orderUpdates = [];
  const itemTasks = [];

  for (const orderDoc of ordersSnap.docs) {
    const orderData = orderDoc.data();
    const orderPath = orderDoc.ref.path;
    const status = normalizeStatus(orderData.status);
    const orderUpdatesEntry = {};
    if (orderData.status !== status) orderUpdatesEntry.status = status;
    if (Object.keys(orderUpdatesEntry).length > 0) orderUpdates.push({ ref: orderDoc.ref, updates: orderUpdatesEntry });

    itemTasks.push((async () => {
      const itemsSnap = await orderDoc.ref.collection("items").get();
      const itemUpdates = [];
      const sideDocs = [];
      for (const itemDoc of itemsSnap.docs) {
        const item = itemDoc.data();
        const toppings = Array.isArray(item.toppings) ? item.toppings : [];
        const setId = normalizeSetId(itemDoc.id, item.setId, toppings);
        const checked = item.checked === true;
        const quantity = Number.isFinite(item.quantity) && item.quantity > 0 ? Math.trunc(item.quantity) : 1;
        const note = typeof item.note === "string" ? item.note : "";

        const updates = {};
        if (item.setId !== setId) updates.setId = setId;
        if (item.checked !== true) updates.checked = checked;
        if (item.note !== note) updates.note = note;
        if (item.quantity !== quantity) updates.quantity = quantity;
        if (item.toppings !== undefined) updates.toppings = FieldValue.delete();
        if (Object.keys(updates).length > 0) itemUpdates.push({ ref: itemDoc.ref, updates });

        if (toppings.length > 0) {
          for (const top of toppings) {
            const t = top ?? {};
            sideDocs.push({
              ref: orderDoc.ref.collection("items").doc(randomUUID()),
              data: {
                orderId: orderDoc.id,
                customerId: orderDoc.ref.parent.parent?.id ?? "",
                menuId: typeof t.menuId === "string" ? t.menuId : "",
                name: typeof t.name === "string" ? t.name : "",
                price: Number.isFinite(t.price) ? Math.trunc(t.price) : 0,
                quantity: Number.isFinite(t.quantity) && t.quantity > 0 ? Math.trunc(t.quantity) : 1,
                setId: itemDoc.id,
                note: "",
                checked: true,
                createdAt: toTimestamp(item.createdAt),
                updatedAt: toTimestamp(item.updatedAt),
              },
            });
          }
        }
      }

      return { itemUpdates, sideDocs, orderPath };
    })());
  }

  const itemResults = await Promise.all(itemTasks);
  const allItemUpdates = itemResults.flatMap((r) => r.itemUpdates);
  const allSideDocs = itemResults.flatMap((r) => r.sideDocs);

  console.log(`customers: ${customerUpdates.length}`);
  console.log(`orders: ${orderUpdates.length}`);
  console.log(`items: ${allItemUpdates.length}`);
  console.log(`side docs to add: ${allSideDocs.length}`);

  if (!APPLY) {
    console.log("dry-run です。反映するなら --apply を付けてください。");
    return;
  }

  const batches = [];
  let batch = db.batch();
  let ops = 0;
  const MAX_OPS = 450;

  async function commitIfNeeded() {
    if (ops >= MAX_OPS) {
      await batch.commit();
      batches.push(true);
      batch = db.batch();
      ops = 0;
    }
  }

  for (const { ref, updates } of customerUpdates) {
    batch.update(ref, updates);
    ops += 1;
    await commitIfNeeded();
  }
  for (const { ref, updates } of orderUpdates) {
    batch.update(ref, updates);
    ops += 1;
    await commitIfNeeded();
  }
  for (const { ref, updates } of allItemUpdates) {
    batch.update(ref, updates);
    ops += 1;
    await commitIfNeeded();
  }
  for (const { ref, data } of allSideDocs) {
    batch.set(ref, data);
    ops += 1;
    await commitIfNeeded();
  }

  if (ops > 0) await batch.commit();
  console.log("✔ migration complete");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
