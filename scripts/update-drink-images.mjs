#!/usr/bin/env node
/**
 * ドリンク商品画像を実際のブランド商品写真に差し替える追加スクリプト。
 * Wikimedia Commons の各メーカー商品写真 (CC) を使用。
 *
 * 実行: node scripts/update-drink-images.mjs
 */

import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { Buffer } from "node:buffer";

const PROJECT_ID = "gonmura-food";
const BUCKET = "gonmura-food.firebasestorage.app";

const TOKEN = execSync("gcloud auth print-access-token", {
  stdio: ["ignore", "pipe", "pipe"],
})
  .toString()
  .trim();

const MAPPING = {
  // 既存マップ済み: 適切なブランド画像に置換
  "6BVtPDoInnCl1bUjfdmw": {
    name: "瓶ビール (キリン一番搾り)",
    source:
      "https://upload.wikimedia.org/wikipedia/commons/2/22/%E3%82%AD%E3%83%AA%E3%83%B3%E4%B8%80%E7%95%AA%E6%90%BE%E3%82%8A_%2816049678263%29.jpg",
  },
  qZ6SpgKdZshrAq7J2r10: {
    name: "ジンジャーエール (Canada Dry)",
    source:
      "https://upload.wikimedia.org/wikipedia/commons/0/0b/Canada_Dry_ginger_ale_bottles.jpg",
  },
  "8AJnF0LNLTS7KDaQs5KS": {
    name: "烏龍茶 (Suntory)",
    source:
      "https://upload.wikimedia.org/wikipedia/commons/a/a8/SUNTORY_OOLONG_TEA_SMALL_BOTTLE_CHINA_VERSION_%284%29.jpg",
  },
  // 新規マップ (前回 UNMAPPED だったもの)
  f2Ayn4ItsEuS8dFWrI5r: {
    name: "コーラ (Coca-Cola)",
    source:
      "https://upload.wikimedia.org/wikipedia/commons/a/af/Coca-cola_bottle.jpg",
  },
  ZhsoWOOoBde8BJ0vbfZm: {
    name: "カルピス (Calpis)",
    source: "https://upload.wikimedia.org/wikipedia/commons/f/fd/Calpis_karupisu.JPG",
  },
};

function extFromCT(ct) {
  if (!ct) return "jpg";
  if (ct.includes("png")) return "png";
  if (ct.includes("webp")) return "webp";
  return "jpg";
}

async function processItem(id, { name, source }) {
  const dl = await fetch(source, {
    headers: {
      "User-Agent":
        "gonmura-food-admin/1.0 (https://github.com/kitagawa-create/gonmura-food-app)",
    },
  });
  if (!dl.ok) throw new Error(`download ${dl.status}`);
  const ct = dl.headers.get("content-type") || "image/jpeg";
  const buf = Buffer.from(await dl.arrayBuffer());
  const ext = extFromCT(ct);

  const filePath = `menus/${id}_${Date.now()}.${ext}`;
  const downloadToken = randomUUID();

  const upRes = await fetch(
    `https://storage.googleapis.com/upload/storage/v1/b/${BUCKET}/o?uploadType=media&name=${encodeURIComponent(filePath)}`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": ct },
      body: buf,
    }
  );
  if (!upRes.ok) throw new Error(`upload ${upRes.status}: ${(await upRes.text()).slice(0, 200)}`);

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
  if (!fsRes.ok) throw new Error(`firestore ${fsRes.status}: ${(await fsRes.text()).slice(0, 200)}`);

  return { size: buf.length };
}

async function main() {
  const entries = Object.entries(MAPPING);
  console.log(`\n${entries.length}件のドリンク画像を更新します...\n`);

  let ok = 0, fail = 0;
  for (const [id, info] of entries) {
    try {
      const { size } = await processItem(id, info);
      console.log(`  ✓ ${info.name}  (${(size / 1024).toFixed(0)}KB)`);
      ok++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`  ✗ ${info.name}: ${msg}`);
      fail++;
    }
  }
  console.log(`\n完了: ${ok}成功 / ${fail}失敗`);
  if (fail > 0) process.exit(1);
}

main();
