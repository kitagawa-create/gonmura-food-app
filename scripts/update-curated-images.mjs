#!/usr/bin/env node
/**
 * 手動キュレーション版: Wikipedia 各記事の代表画像など、慎重に選んだ画像のみで更新。
 * loremflickr ランダムは廃止。
 */

import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { Buffer } from "node:buffer";

const PROJECT_ID = "gonmura-food";
const BUCKET = "gonmura-food.firebasestorage.app";
const TOKEN = execSync("gcloud auth print-access-token", { stdio: ["ignore", "pipe", "pipe"] }).toString().trim();

const MAPPING = {
  // ===== ラーメン =====
  // ノーマル家系
  F2zoFM33eWfwECWUG7PN: { name: "ラーメン", source: "https://upload.wikimedia.org/wikipedia/commons/4/48/Nakajimaya.jpg" },
  // 味玉ラーメン
  INOvuctqwz2Ut7h0mJCH: { name: "味玉ラーメン", source: "https://upload.wikimedia.org/wikipedia/commons/4/4f/Ramen_with_eggs.jpg" },
  // チャーシューメン (Wikipedia ラーメン記事のチャーシュー麺写真)
  kYutrrRUh75etMp0lnTj: { name: "チャーシューメン", source: "https://upload.wikimedia.org/wikipedia/commons/f/fa/%E3%83%81%E3%83%A3%E3%83%BC%E3%82%B7%E3%83%A5%E3%83%BC%E9%BA%BA.jpg" },
  // ネギラーメン (ネギ&にんにくのせ)
  mdpR6UkQ9yFYuuri28e7: { name: "ネギラーメン", source: "https://upload.wikimedia.org/wikipedia/commons/1/11/NegitoNinniku.jpg" },
  // 野菜ラーメン
  "8rvuPjZM4959CMwOz1DQ": { name: "野菜ラーメン", source: "https://upload.wikimedia.org/wikipedia/commons/4/46/Yasai_Ramen_Set_20201027-03.jpg" },
  // にんにくラーメン (にんにくラーメンとして登録された写真)
  UfB59LNm8KfuWiOx5qn8: { name: "にんにくラーメン", source: "https://upload.wikimedia.org/wikipedia/commons/a/ac/Ninniku_ramen.jpg" },
  // 塩ラーメン (Wikipedia 塩ラーメン記事リード画像)
  paVoBuX86Twy7u164Qmo: { name: "塩ラーメン", source: "https://upload.wikimedia.org/wikipedia/commons/a/a1/Japanese_Salt_flavor_Sapporo_Ramen.JPG" },
  // 味噌ラーメン (Wikipedia 味噌ラーメン記事リード画像)
  "02zqBdnGtzAzkGrqrO4e": { name: "味噌ラーメン", source: "https://upload.wikimedia.org/wikipedia/commons/2/27/%E3%82%89%E3%83%BC%E3%82%81%E3%82%93%E5%91%B3%E5%99%8C%EF%BC%88%E5%A4%A7%E5%B3%B6%EF%BC%89.jpg" },
  // 辛味噌 (Do Miso 銀座の辛味噌)
  "0nnYYWsNmpX1z4i9D5bh": { name: "辛味噌ラーメン", source: "https://upload.wikimedia.org/wikipedia/commons/c/c8/Spicy_Miso_Ramen_%40_Do_Miso_%40_Ginza_%2810181581586%29.jpg" },
  // 激辛 (からみそラーメン - 真っ赤)
  RKu84R1GkTffQGGatbEQ: { name: "激辛ラーメン", source: "https://upload.wikimedia.org/wikipedia/commons/7/7d/%E3%81%8B%E3%82%89%E3%81%BF%E3%81%9D%E3%83%A9%E3%83%BC%E3%83%A1%E3%83%B3.jpg" },
  // 鶏白湯 (Wikipedia 鶏白湯ラーメン記事リード画像 - 鶏の穴)
  CSrdmcSQTObvQHmal5i8: { name: "鶏白湯ラーメン", source: "https://upload.wikimedia.org/wikipedia/commons/1/1d/Tori-baitang_ramen.jpg" },
  // 鶏白湯塩 (透明な塩スープ系)
  LJoEr5KWxRbfTnIPugck: { name: "鶏白湯塩ラーメン", source: "https://upload.wikimedia.org/wikipedia/commons/7/70/Santoka_ramen.jpg" },
  // 濃厚鶏白湯 (Shiro Tonkotsu - 白濁濃厚)
  BPrS25LoUsZWAHSiSBw1: { name: "濃厚鶏白湯ラーメン", source: "https://upload.wikimedia.org/wikipedia/commons/c/ca/Shiro_Tonkotsu_Ramen.jpg" },
  // Gonmuraスペシャル (家系の元祖 吉村家のラーメン+ライス、特別感)
  koY0hUl1hJbMjydT22TP: { name: "Gonmuraスペシャル", source: "https://upload.wikimedia.org/wikipedia/commons/2/25/%E3%83%A9%E3%83%BC%E3%83%A1%E3%83%B3%E3%81%A8%E3%83%A9%E3%82%A4%E3%82%B9_%E5%90%89%E6%9D%91%E5%AE%B6_2025%E5%B9%B42%E6%9C%8823%E6%97%A5%E3%81%AE%E6%A8%AA%E6%B5%9C_202502231704_IMG_9709.jpg" },

  // ===== トッピング =====
  "1l82tbhksuOgEduBvx6O": { name: "味玉", source: "https://upload.wikimedia.org/wikipedia/commons/1/11/Ajitama.jpg" },
  "6N32LzNt5m9zBVbHInRI": { name: "海苔増し(5枚)", source: "https://upload.wikimedia.org/wikipedia/commons/b/be/Nori.jpg" },
  Skj5cujaYOOT4wlSVzOK: { name: "チャーシュー増し", source: "https://upload.wikimedia.org/wikipedia/commons/4/48/Cha-syu.jpg" },

  // ===== サイドメニュー =====
  // 餃子 (Wikipedia 餃子記事の焼き餃子)
  e6kjLsFg4tqVDluV0XrE: { name: "餃子(5個)", source: "https://upload.wikimedia.org/wikipedia/commons/0/01/Potstickers_RTE.jpg" },
  // 揚げ餃子
  "6X0SqER3O3NVMgY6Sn53": { name: "揚げ餃子(5個)", source: "https://upload.wikimedia.org/wikipedia/commons/4/4c/Deep_fried_gyoza.jpg" },
  // 春巻き (餃子の王将の春巻き!)
  fm1oR7ZTtfYjfF2CKsna: { name: "春巻き(3本)", source: "https://upload.wikimedia.org/wikipedia/commons/a/a5/Spring_roll%2C_at_Gyoza-no-Ohsho_%282012.08.18%29.jpg" },
  // 唐揚げ (クラシック唐揚げ)
  jMtXqBeAmal9I2xzAatX: { name: "唐揚げ(3個)", source: "https://upload.wikimedia.org/wikipedia/commons/7/7b/Classic_Chicken_Karaage_-_Sunoso_2023-11-28.jpg" },
  // 半チャーハン (Wikipedia 炒飯記事の写真)
  XszUjVsqeCr5yytL4xKa: { name: "半チャーハン", source: "https://upload.wikimedia.org/wikipedia/commons/3/3f/Ramen_and_Chahan_002.jpg" },
  // ミニチャーシュー丼
  SU2O7fGiZyiEXBeYOMnb: { name: "ミニチャーシュー丼", source: "https://upload.wikimedia.org/wikipedia/commons/f/ff/Char_siu_don.jpg" },
};

function extFromCT(ct) {
  if (!ct) return "jpg";
  if (ct.includes("png")) return "png";
  if (ct.includes("webp")) return "webp";
  return "jpg";
}

async function processItem(id, { name, source }) {
  const dl = await fetch(source, {
    headers: { "User-Agent": "gonmura-food-admin/1.0 (https://github.com/kitagawa-create/gonmura-food-app)" },
    redirect: "follow",
  });
  if (!dl.ok) throw new Error(`download ${dl.status}`);
  const ct = dl.headers.get("content-type") || "image/jpeg";
  const buf = Buffer.from(await dl.arrayBuffer());
  const ext = extFromCT(ct);

  const filePath = `menus/${id}_${Date.now()}.${ext}`;
  const downloadToken = randomUUID();

  const upRes = await fetch(
    `https://storage.googleapis.com/upload/storage/v1/b/${BUCKET}/o?uploadType=media&name=${encodeURIComponent(filePath)}`,
    { method: "POST", headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": ct }, body: buf }
  );
  if (!upRes.ok) throw new Error(`upload ${upRes.status}`);

  const patchRes = await fetch(
    `https://storage.googleapis.com/storage/v1/b/${BUCKET}/o/${encodeURIComponent(filePath)}`,
    {
      method: "PATCH",
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ metadata: { firebaseStorageDownloadTokens: downloadToken } }),
    }
  );
  if (!patchRes.ok) throw new Error(`metadata ${patchRes.status}`);

  const imageUrl = `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/${encodeURIComponent(filePath)}?alt=media&token=${downloadToken}`;

  const fsRes = await fetch(
    `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/menus/${id}?updateMask.fieldPaths=imageUrl&updateMask.fieldPaths=updatedAt`,
    {
      method: "PATCH",
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        fields: {
          imageUrl: { stringValue: imageUrl },
          updatedAt: { timestampValue: new Date().toISOString() },
        },
      }),
    }
  );
  if (!fsRes.ok) throw new Error(`firestore ${fsRes.status}`);

  return { size: buf.length };
}

async function main() {
  const entries = Object.entries(MAPPING);
  console.log(`\n${entries.length}件の画像を慎重キュレーション版で更新します...\n`);
  let ok = 0, fail = 0;
  for (const [id, info] of entries) {
    try {
      const { size } = await processItem(id, info);
      console.log(`  ✓ ${info.name}  (${(size / 1024).toFixed(0)}KB)`);
      ok++;
    } catch (e) {
      console.error(`  ✗ ${info.name}: ${e.message}`);
      fail++;
    }
  }
  console.log(`\n完了: ${ok}成功 / ${fail}失敗`);
}

main();
