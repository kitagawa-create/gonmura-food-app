/**
 * ファミレスメニュー画像アップロードスクリプト
 *
 * - Firestore から name でメニューを検索
 * - 対応する画像を外部URLからダウンロードして Firebase Storage にアップロード
 * - メニューの imageUrl を更新
 *
 * 実行: node scripts/seed-famires-images.mjs
 */

import { initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import https from "node:https";
import http from "node:http";
import { randomUUID } from "node:crypto";

initializeApp({ projectId: "gonmura-food" });
const db = getFirestore();
const bucket = getStorage().bucket("gonmura-food.firebasestorage.app");

// ---- メニュー名 → 画像URL マッピング ----
const IMAGE_MAP = {
  // ハンバーグ（ハンバーガーサンドではなくハンバーグステーキの写真）
  "和風おろしハンバーグ": "https://images.unsplash.com/photo-1728188937336-ae8121742c06?w=800&q=80",
  "チーズハンバーグ":     "https://images.unsplash.com/photo-1628937535588-aceaad718fd4?w=800&q=80",
  "デミグラスハンバーグ": "https://images.unsplash.com/photo-1565511224383-89cedc5d8483?w=800&q=80",
  "ダブルハンバーグ":     "https://images.unsplash.com/photo-1629881857131-286833957e29?w=800&q=80",
  // パスタ
  "カルボナーラ":         "https://www.themealdb.com/images/media/meals/llcbn01574260722.jpg",
  "アラビアータ":         "https://www.themealdb.com/images/media/meals/ustsqw1468250014.jpg",
  "ボロネーゼ":           "https://www.themealdb.com/images/media/meals/sutysw1468247559.jpg",
  "ペペロンチーノ":       "https://images.unsplash.com/photo-1616866885582-ea3be3cf3aaa?w=800&q=80",
  "海老クリームパスタ":   "https://images.unsplash.com/photo-1739592773896-721756fc4d33?w=800&q=80",
  // ピザ
  "マルゲリータ":         "https://www.themealdb.com/images/media/meals/x0lk931587671540.jpg",
  "4種のチーズピザ":      "https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?w=800&q=80",
  "ペパロニピザ":         "https://images.unsplash.com/photo-1628840042765-356cda07504e?w=800&q=80",
  // サラダ・スープ
  "シーザーサラダ":       "https://images.unsplash.com/photo-1550304943-4f24f54ddde9?w=800&q=80",
  "グリーンサラダ":       "https://images.unsplash.com/photo-1540420773420-3366772f4999?w=800&q=80",
  "クラムチャウダー":     "https://www.themealdb.com/images/media/meals/rvtvuw1511190488.jpg",
  "ミネストローネ":       "https://images.unsplash.com/photo-1611068120813-eca5a8cbf793?w=800&q=80",
  // ドリンク
  "コーラ":               "https://images.unsplash.com/photo-1574706226623-e5cc0da928c6?w=800&q=80",
  "オレンジジュース":     "https://images.unsplash.com/photo-1621506289937-a8e4df240d0b?w=800&q=80",
  "アイスコーヒー":       "https://images.unsplash.com/photo-1461023058943-07fcbe16d735?w=800&q=80",
  "ホットコーヒー":       "https://images.unsplash.com/photo-1509042239860-f550ce710b93?w=800&q=80",
  "アイスティー":         "https://images.unsplash.com/photo-1556679343-c7306c1976bc?w=800&q=80",
  // デザート
  "バニラアイス":         "https://images.unsplash.com/photo-1561230101-2c841778f9ae?w=800&q=80",
  "チョコレートパフェ":   "https://images.unsplash.com/photo-1514849302-984523450cf4?w=800&q=80",
  "チーズケーキ":         "https://www.themealdb.com/images/media/meals/swttys1511385853.jpg",
  "ティラミス":           "https://images.unsplash.com/photo-1571877227200-a0d98ea607e9?w=800&q=80",
  // サイド
  "ライス":               "https://images.unsplash.com/photo-1680137248876-6ad53db8caef?w=800&q=80",
  "パン":                 "https://images.unsplash.com/photo-1509440159596-0249088772ff?w=800&q=80",
  "フライドポテト":       "https://images.unsplash.com/photo-1518013431117-eb1465fa5752?w=800&q=80",
  "オニオンリング":       "https://images.unsplash.com/photo-1639024471283-03518883512d?w=800&q=80",
  "コーンスープ":         "https://images.unsplash.com/photo-1612292699631-65af4d4a0be9?w=800&q=80",
  "ミニサラダ":           "https://images.unsplash.com/photo-1678007698853-c3b6dc24aa12?w=800&q=80",
};

// ---- 画像ダウンロード（リダイレクト追跡）----
function downloadImage(url) {
  return new Promise((resolve, reject) => {
    function get(u, redirects = 0) {
      if (redirects > 8) return reject(new Error("Too many redirects"));
      const mod = u.startsWith("https") ? https : http;
      const req = mod.get(u, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0",
          "Accept": "image/webp,image/apng,image/*,*/*",
          "Referer": "https://unsplash.com/",
        },
      }, (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
          const location = res.headers.location;
          if (!location) return reject(new Error("Redirect with no location"));
          res.resume();
          return get(location.startsWith("http") ? location : new URL(location, u).href, redirects + 1);
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode}`));
        }
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () =>
          resolve({
            buffer: Buffer.concat(chunks),
            contentType: res.headers["content-type"] ?? "image/jpeg",
          })
        );
        res.on("error", reject);
      });
      req.setTimeout(15000, () => { req.destroy(); reject(new Error("Timeout")); });
      req.on("error", reject);
    }
    get(url);
  });
}

// ---- Storage アップロード（Firebase ダウンロードトークン方式）----
async function uploadAndUpdate(menuId, menuName, imageUrl) {
  const { buffer, contentType } = await downloadImage(imageUrl);
  const ext = contentType.includes("png") ? "png" : "jpg";
  const filePath = `menus/${menuId}.${ext}`;
  const file = bucket.file(filePath);
  const token = randomUUID();
  await file.save(buffer, {
    contentType,
    metadata: {
      cacheControl: "public,max-age=31536000",
      metadata: { firebaseStorageDownloadTokens: token },
    },
  });
  const encodedPath = encodeURIComponent(filePath);
  const downloadUrl = `https://firebasestorage.googleapis.com/v0/b/gonmura-food.firebasestorage.app/o/${encodedPath}?alt=media&token=${token}`;
  await db.collection("menus").doc(menuId).update({
    imageUrl: downloadUrl,
    updatedAt: Timestamp.now(),
  });
  return downloadUrl;
}

// ---- メイン処理 ----
async function main() {
  console.log("📸  画像アップロード開始\n");

  // imageUrl が空のアクティブメニューを取得
  const snap = await db.collection("menus")
    .where("status", "!=", "deleted")
    .get();

  const RETRY_NAMES = new Set([
    "和風おろしハンバーグ", "チーズハンバーグ", "デミグラスハンバーグ", "ダブルハンバーグ",
    "アラビアータ", "ペペロンチーノ", "海老クリームパスタ",
    "シーザーサラダ", "ミネストローネ",
    "コーラ", "バニラアイス", "チョコレートパフェ",
    "ライス", "オニオンリング", "コーンスープ", "ミニサラダ",
  ]);
  const targets = snap.docs.filter((d) => {
    const data = d.data();
    return RETRY_NAMES.has(data.name) && IMAGE_MAP[data.name] !== undefined;
  });

  console.log(`対象: ${targets.length}件\n`);

  let ok = 0;
  let ng = 0;
  for (const d of targets) {
    const name = d.data().name;
    const srcUrl = IMAGE_MAP[name];
    process.stdout.write(`   ${name} ... `);
    try {
      await uploadAndUpdate(d.id, name, srcUrl);
      console.log("✅");
      ok++;
    } catch (e) {
      console.log(`⚠️  失敗 (${e.message})`);
      ng++;
    }
  }

  console.log(`\n完了: ✅ ${ok}件  ⚠️ ${ng}件`);
}

main().catch((e) => {
  console.error("❌ エラー:", e);
  process.exit(1);
});
