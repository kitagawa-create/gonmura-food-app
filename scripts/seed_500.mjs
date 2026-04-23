/**
 * 500件 × 過去1年分の customers+orders+items を生成
 *
 * 特徴:
 *   - 月曜定休
 *   - ランチ(11:30-14:00) / ディナー(17:30-21:00)
 *   - 冬季(11-2月) 1.4倍・金曜 1.5倍・土日 2.0倍
 *   - ランチはソロ多め・ディナーはグループ多め
 *   - 土日はファミリー(3-4名)多め
 *   - デザートはランチ・ディナー問わず注文あり
 *   - 8%のメインディッシュ注文に備考メモ(アレルギー等)
 *
 * スキーマ:
 *   Customer:  { customerId, tableId, guestCount, isPaid, createdAt, updatedAt }
 *   Order:     { orderId, customerId, status:"completed", createdAt, updatedAt }
 *   OrderItem: { itemId, orderId, customerId, menuId, name, price, quantity, setId,
 *                note, checked, createdAt, updatedAt }
 */

import { initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";

initializeApp({ projectId: "gonmura-food" });
const db = getFirestore();

// ---- テーブル (Firestore の実 ID) ----
const TABLES = [
  { tableId: "SSi7PwAUSas8StGS0sts", tableNumber: "1" },
  { tableId: "xrkaGmTUsHtAUSJVbGib", tableNumber: "2" },
  { tableId: "3lWx6cI5RTH28vGbyo3i", tableNumber: "3" },
  { tableId: "GPir6zGXlzbjqRpMleXA", tableNumber: "4" },
  { tableId: "jQT2BhmlGrzrf2be1ks0", tableNumber: "a-1" },
  { tableId: "Tv9VvyfMMDNP18zQL1sN", tableNumber: "a-2" },
  { tableId: "V1oZQY07lPe3hUsaFtcv", tableNumber: "b-1" },
  { tableId: "db6wVbCJOkwUwkGk9dWJ", tableNumber: "b-2" },
  { tableId: "Y0B3KY8YoApOUJlqLczQ", tableNumber: "c-1" },
];

// ---- メニュー (id, name, price, w=重み) ----
// ※ ID は seed-famires.mjs 実行後に Firestore に生成された実際の ID に差し替えること
const MAIN_DISHES = [
  { id: "F2zoFM33eWfwECWUG7PN", name: "和風おろしハンバーグ", price: 980,  w: 28 },
  { id: "INOvuctqwz2Ut7h0mJCH", name: "チーズハンバーグ",     price: 1080, w: 24 },
  { id: "kYutrrRUh75etMp0lnTj", name: "デミグラスハンバーグ", price: 1150, w: 14 },
  { id: "8rvuPjZM4959CMwOz1DQ", name: "カルボナーラ",         price: 950,  w: 18 },
  { id: "UfB59LNm8KfuWiOx5qn8", name: "ボロネーゼ",           price: 980,  w: 10 },
  { id: "RKu84R1GkTffQGGatbEQ", name: "アラビアータ",         price: 920,  w:  8 },
  { id: "0nnYYWsNmpX1z4i9D5bh", name: "マルゲリータ",         price: 1200, w: 12 },
  { id: "CSrdmcSQTObvQHmal5i8", name: "4種のチーズピザ",     price: 1380, w:  8 },
  { id: "LJoEr5KWxRbfTnIPugck", name: "ペパロニピザ",         price: 1280, w:  6 },
  { id: "BPrS25LoUsZWAHSiSBw1", name: "ダブルハンバーグ",     price: 1380, w:  6 },
];

const SIDES = [
  { id: "0s3HQqw08SX7stV7g6sJ", name: "ライス追加",     price: 165, w: 35 },
  { id: "5hBjrrPXK8ZpkXxs4QdB", name: "パン追加",       price: 165, w: 28 },
  { id: "6X0SqER3O3NVMgY6Sn53", name: "フライドポテト", price: 220, w: 20 },
  { id: "SU2O7fGiZyiEXBeYOMnb", name: "オニオンリング", price: 220, w: 12 },
  { id: "XszUjVsqeCr5yytL4xKa", name: "コーンスープ",   price: 220, w: 10 },
  { id: "e6kjLsFg4tqVDluV0XrE", name: "ミニサラダ",     price: 165, w: 15 },
];

const DESSERTS = [
  { id: "jMtXqBeAmal9I2xzAatX", name: "バニラアイス",       price: 380, w: 45 },
  { id: "fm1oR7ZTtfYjfF2CKsna", name: "チョコレートパフェ", price: 680, w: 25 },
  { id: "1l82tbhksuOgEduBvx6O", name: "チーズケーキ",       price: 520, w: 30 },
];

const DRINKS = [
  { id: "f2Ayn4ItsEuS8dFWrI5r", name: "コーラ",           price: 280, w: 30 },
  { id: "8AJnF0LNLTS7KDaQs5KS", name: "アイスティー",      price: 280, w: 25 },
  { id: "ZhsoWOOoBde8BJ0vbfZm", name: "アイスコーヒー",    price: 320, w: 20 },
  { id: "0xdO4mZ7lXLyT4dVoVQN", name: "オレンジジュース",  price: 280, w: 15 },
  { id: "6BVtPDoInnCl1bUjfdmw", name: "ホットコーヒー",    price: 320, w: 10 },
];

const NOTES = [
  "アレルギー: 乳製品なし", "ソースを別添えで", "辛さ控えめ",
  "チーズ抜きで", "パスタかために", "ソースを少なめで",
  "グルテンフリー対応でお願いします", "付け合わせ多めで", "塩分控えめ",
];

// ---- 線形合同法の疑似乱数 (再現性あり) ----
class Rng {
  constructor(seed = 42) { this.s = seed >>> 0; }
  next() {
    this.s = Math.imul(this.s, 1664525) + 1013904223 >>> 0;
    return this.s / 0x100000000;
  }
  int(min, max) { return Math.floor(this.next() * (max - min + 1)) + min; }
  pick(arr)     { return arr[this.int(0, arr.length - 1)]; }
  weighted(arr) {
    const total = arr.reduce((s, x) => s + x.w, 0);
    let r = this.next() * total;
    for (const x of arr) { r -= x.w; if (r <= 0) return x; }
    return arr[arr.length - 1];
  }
  sample(arr, n) {
    const c = [...arr];
    const res = [];
    for (let i = 0; i < Math.min(n, c.length); i++) {
      const idx = this.int(0, c.length - 1);
      res.push(c.splice(idx, 1)[0]);
    }
    return res;
  }
  weightedIdx(weights) {
    const total = weights.reduce((s, w) => s + w, 0);
    let r = this.next() * total;
    for (let i = 0; i < weights.length; i++) { r -= weights[i]; if (r <= 0) return i; }
    return weights.length - 1;
  }
}

const rng = new Rng(42);

function newId() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  return Array.from({ length: 20 }, () => chars[rng.int(0, chars.length - 1)]).join("");
}

// ---- 日付ユーティリティ ----
function openDates(start, end) {
  const dates = [];
  const cur = new Date(start);
  while (cur <= end) {
    if (cur.getDay() !== 1) dates.push(new Date(cur)); // 月曜定休
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
}

function seasonWeight(d) {
  const m = d.getMonth() + 1;
  if (m >= 11 || m <= 2) return 1.40; // 冬
  if (m === 3 || m === 4) return 1.10; // 春
  if (m >= 5 && m <= 9)  return 0.85; // 夏
  return 1.00;
}

function dowWeight(d) {
  const w = d.getDay();
  if (w === 0 || w === 6) return 2.00; // 土日
  if (w === 5)            return 1.50; // 金
  if (w === 2 || w === 4) return 0.90; // 火・木
  return 1.00;
}

function orderTime(date, session) {
  let h, m;
  if (session === "lunch") {
    h = rng.int(11, 13);
    m = h === 11 ? rng.int(30, 59) : rng.int(0, 59);
  } else {
    h = rng.int(17, 20);
    m = h === 17 ? rng.int(30, 59) : rng.int(0, 59);
  }
  return new Date(Date.UTC(
    date.getFullYear(), date.getMonth(), date.getDate(),
    h - 9, m, rng.int(0, 59)  // JST→UTC
  ));
}

// ---- 注文アイテム生成 ----
function genItems(guests, isDinner, customerId, orderId) {
  const items = [];

  // 人数分のメインディッシュ (1人1品)
  for (let i = 0; i < guests; i++) {
    const main = rng.weighted(MAIN_DISHES);
    const mainItemId = newId();

    if (rng.next() < 0.45) {
      const s = rng.weighted(SIDES);
      items.push({
        itemId: newId(), orderId, customerId,
        menuId: s.id, name: s.name, price: s.price,
        quantity: 1, setId: mainItemId, note: "", checked: true,
      });
    }

    const note = rng.next() < 0.08 ? rng.pick(NOTES) : "";

    items.push({
      itemId: mainItemId, orderId, customerId,
      menuId: main.id, name: main.name, price: main.price,
      quantity: 1, setId: mainItemId, note, checked: true,
    });
  }

  // デザート (35%)
  if (rng.next() < 0.35) {
    const d = rng.weighted(DESSERTS);
    const itemId = newId();
    items.push({
      itemId, orderId, customerId,
      menuId: d.id, name: d.name, price: d.price,
      quantity: 1, setId: itemId, note: "", checked: true,
    });
  }

  // ドリンク (ゲスト1人あたり45%)
  for (let i = 0; i < guests; i++) {
    if (rng.next() < 0.45) {
      const d = rng.weighted(DRINKS);
      const itemId = newId();
      items.push({
        itemId, orderId, customerId,
        menuId: d.id, name: d.name, price: d.price,
        quantity: 1, setId: itemId, note: "", checked: true,
      });
    }
  }

  return items;
}

// ---- メイン ----
async function seed() {
  const TARGET = 500;
  const start = new Date("2025-04-22T00:00:00+09:00");
  const end   = new Date("2026-04-21T23:59:59+09:00");

  const dates = openDates(start, end);
  const weights = dates.map(d => dowWeight(d) * seasonWeight(d));
  const totalW  = weights.reduce((s, w) => s + w, 0);

  // 各日付への割り当て数を計算 (小数部分の大きい順に残りを配分)
  const base = weights.map(w => Math.floor(TARGET * w / totalW));
  let remaining = TARGET - base.reduce((s, v) => s + v, 0);
  const fracs = weights.map((w, i) => ({ i, f: (TARGET * w / totalW) - base[i] }))
    .sort((a, b) => b.f - a.f);
  for (let i = 0; i < remaining; i++) base[fracs[i].i]++;

  console.log(`対象日数: ${dates.length}  総顧客数: ${base.reduce((s, v) => s + v, 0)}`);

  let total = 0;

  for (let di = 0; di < dates.length; di++) {
    const date  = dates[di];
    const count = base[di];
    if (count === 0) continue;

    const isWeekend = date.getDay() === 0 || date.getDay() === 6;

    for (let ci = 0; ci < count; ci++) {
      const session  = rng.next() < 0.48 ? "lunch" : "dinner";
      const isDinner = session === "dinner";

      // 人数分布 (ランチ/ディナー × 平日/土日 で差をつける)
      const guestW = isDinner
        ? (isWeekend ? [10, 35, 32, 23] : [20, 45, 25, 10])
        : (isWeekend ? [25, 40, 22, 13] : [35, 42, 15, 8]);
      const guestCount = rng.weightedIdx(guestW) + 1;

      const table = rng.pick(TABLES);
      const dt    = orderTime(date, session);
      const ts    = Timestamp.fromDate(dt);

      const customerId = newId();
      const orderId    = newId();
      const items      = genItems(guestCount, isDinner, customerId, orderId);

      const batch = db.batch();

      // Customer
      batch.set(db.collection("customers").doc(customerId), {
        customerId,
        tableId: table.tableId,
        guestCount,
        isPaid: true,
        createdAt: ts,
        updatedAt: ts,
      });

      // Order
      batch.set(
        db.collection("customers").doc(customerId)
          .collection("orders").doc(orderId),
        { orderId, customerId, status: "completed", createdAt: ts, updatedAt: ts }
      );

      // Items
      for (const item of items) {
        const { itemId, ...rest } = item;
        batch.set(
          db.collection("customers").doc(customerId)
            .collection("orders").doc(orderId)
            .collection("items").doc(itemId),
          { ...rest, itemId, createdAt: ts, updatedAt: ts }
        );
      }

      await batch.commit();
      total++;
      if (total % 50 === 0) console.log(`  ${total}/${TARGET} 完了...`);
    }
  }

  console.log(`Done! ${total} customers 作成完了。`);
}

seed().catch(console.error);
