/**
 * ファミレスメニュー投入スクリプト
 *
 * - 既存カテゴリーを全削除
 * - 既存メニューを status:"deleted" に設定
 * - ファミレス用カテゴリー・メニューを新規投入
 * - 写真を loremflickr.com から取得して Firebase Storage にアップロード
 *
 * 実行: node scripts/seed-famires.mjs
 */

import { initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import https from "node:https";
import http from "node:http";

initializeApp({ projectId: "gonmura-food" });
const db = getFirestore();
const bucket = getStorage().bucket("gonmura-food.firebasestorage.app");

// ---- カテゴリー定義 ----
const CATEGORIES = [
  { name: "おすすめ",       sortOrder: 0 },
  { name: "ハンバーグ",     sortOrder: 1 },
  { name: "パスタ",         sortOrder: 2 },
  { name: "ピザ",           sortOrder: 3 },
  { name: "サラダ・スープ", sortOrder: 4 },
  { name: "ドリンク",       sortOrder: 5 },
  { name: "デザート",       sortOrder: 6 },
  { name: "サイド",         sortOrder: 7 },
];

// ---- メニュー定義 ----
// categoryNames: 所属カテゴリ名（"おすすめ" に入れるものは両方列挙）
// imageKeyword: loremflickr 検索キーワード（英語）
const MENUS = [
  // ── ハンバーグ ──────────────────────────────────────────────
  {
    name: "和風おろしハンバーグ",
    description: "大根おろしとポン酢の和風ソースで仕上げたさっぱりハンバーグ",
    price: 980,
    categoryNames: ["ハンバーグ", "おすすめ"],
    sortOrder: 0, sortOrderFeatured: 0,
    imageKeyword: "hamburger steak",
  },
  {
    name: "チーズハンバーグ",
    description: "とろけるチーズをたっぷりのせた定番の人気メニュー",
    price: 1080,
    categoryNames: ["ハンバーグ", "おすすめ"],
    sortOrder: 1, sortOrderFeatured: 1,
    imageKeyword: "cheese hamburger",
  },
  {
    name: "デミグラスハンバーグ",
    description: "じっくり煮込んだ濃厚デミグラスソースが自慢の一品",
    price: 1150,
    categoryNames: ["ハンバーグ"],
    sortOrder: 2, sortOrderFeatured: 99,
    imageKeyword: "hamburger plate sauce",
  },
  {
    name: "ダブルハンバーグ",
    description: "ハンバーグ2個のボリューム満点プレート",
    price: 1380,
    categoryNames: ["ハンバーグ"],
    sortOrder: 3, sortOrderFeatured: 99,
    imageKeyword: "hamburger steak beef",
  },

  // ── パスタ ──────────────────────────────────────────────────
  {
    name: "カルボナーラ",
    description: "濃厚クリームソースと卵黄のコクが絶妙なローマの定番",
    price: 950,
    categoryNames: ["パスタ", "おすすめ"],
    sortOrder: 0, sortOrderFeatured: 2,
    imageKeyword: "carbonara pasta",
  },
  {
    name: "アラビアータ",
    description: "唐辛子の辛味を効かせたトマトソースのピリ辛パスタ",
    price: 920,
    categoryNames: ["パスタ"],
    sortOrder: 1, sortOrderFeatured: 99,
    imageKeyword: "tomato pasta spicy",
  },
  {
    name: "ボロネーゼ",
    description: "牛肉をたっぷり使ったミートソースを絡めた食べ応えある一皿",
    price: 980,
    categoryNames: ["パスタ"],
    sortOrder: 2, sortOrderFeatured: 99,
    imageKeyword: "bolognese meat pasta",
  },
  {
    name: "ペペロンチーノ",
    description: "にんにくと唐辛子のシンプルなオイルソース",
    price: 880,
    categoryNames: ["パスタ"],
    sortOrder: 3, sortOrderFeatured: 99,
    imageKeyword: "aglio olio pasta",
  },
  {
    name: "海老クリームパスタ",
    description: "プリプリの海老と濃厚クリームソースの贅沢な組み合わせ",
    price: 1080,
    categoryNames: ["パスタ"],
    sortOrder: 4, sortOrderFeatured: 99,
    imageKeyword: "shrimp cream pasta",
  },

  // ── ピザ ────────────────────────────────────────────────────
  {
    name: "マルゲリータ",
    description: "トマト・モッツァレラ・バジルのシンプルで本格的なナポリピザ",
    price: 1200,
    categoryNames: ["ピザ", "おすすめ"],
    sortOrder: 0, sortOrderFeatured: 3,
    imageKeyword: "margherita pizza",
  },
  {
    name: "4種のチーズピザ",
    description: "4種のチーズのハーモニーが楽しめる濃厚ピザ",
    price: 1380,
    categoryNames: ["ピザ"],
    sortOrder: 1, sortOrderFeatured: 99,
    imageKeyword: "cheese pizza",
  },
  {
    name: "ペパロニピザ",
    description: "スパイシーなペパロニをたっぷりのせたアメリカンスタイル",
    price: 1280,
    categoryNames: ["ピザ"],
    sortOrder: 2, sortOrderFeatured: 99,
    imageKeyword: "pepperoni pizza",
  },

  // ── サラダ・スープ ──────────────────────────────────────────
  {
    name: "シーザーサラダ",
    description: "パルメザンチーズとクルトンをのせたクリーミーシーザードレッシング",
    price: 580,
    categoryNames: ["サラダ・スープ"],
    sortOrder: 0, sortOrderFeatured: 99,
    imageKeyword: "caesar salad",
  },
  {
    name: "グリーンサラダ",
    description: "新鮮な旬の野菜をふんだんに使ったさっぱりサラダ",
    price: 480,
    categoryNames: ["サラダ・スープ"],
    sortOrder: 1, sortOrderFeatured: 99,
    imageKeyword: "green salad bowl",
  },
  {
    name: "クラムチャウダー",
    description: "あさりの旨みがたっぷり詰まったクリーミーなスープ",
    price: 380,
    categoryNames: ["サラダ・スープ"],
    sortOrder: 2, sortOrderFeatured: 99,
    imageKeyword: "clam chowder soup",
  },
  {
    name: "ミネストローネ",
    description: "たっぷりの野菜を煮込んだイタリア風トマトスープ",
    price: 350,
    categoryNames: ["サラダ・スープ"],
    sortOrder: 3, sortOrderFeatured: 99,
    imageKeyword: "minestrone soup vegetables",
  },

  // ── ドリンク ─────────────────────────────────────────────────
  {
    name: "コーラ",
    description: "",
    price: 280,
    categoryNames: ["ドリンク"],
    sortOrder: 0, sortOrderFeatured: 99,
    imageKeyword: "cola drink glass",
  },
  {
    name: "オレンジジュース",
    description: "",
    price: 280,
    categoryNames: ["ドリンク"],
    sortOrder: 1, sortOrderFeatured: 99,
    imageKeyword: "orange juice glass",
  },
  {
    name: "アイスコーヒー",
    description: "",
    price: 320,
    categoryNames: ["ドリンク"],
    sortOrder: 2, sortOrderFeatured: 99,
    imageKeyword: "iced coffee",
  },
  {
    name: "ホットコーヒー",
    description: "",
    price: 320,
    categoryNames: ["ドリンク"],
    sortOrder: 3, sortOrderFeatured: 99,
    imageKeyword: "hot coffee cup",
  },
  {
    name: "アイスティー",
    description: "",
    price: 280,
    categoryNames: ["ドリンク"],
    sortOrder: 4, sortOrderFeatured: 99,
    imageKeyword: "iced tea lemon",
  },

  // ── デザート ─────────────────────────────────────────────────
  {
    name: "バニラアイス",
    description: "なめらかな口当たりのバニラアイスクリーム",
    price: 380,
    categoryNames: ["デザート", "おすすめ"],
    sortOrder: 0, sortOrderFeatured: 4,
    imageKeyword: "vanilla ice cream",
  },
  {
    name: "チョコレートパフェ",
    description: "チョコアイス・生クリーム・チョコソースの贅沢パフェ",
    price: 680,
    categoryNames: ["デザート"],
    sortOrder: 1, sortOrderFeatured: 99,
    imageKeyword: "chocolate parfait",
  },
  {
    name: "チーズケーキ",
    description: "濃厚なクリームチーズと爽やかな酸味のバランスが絶妙",
    price: 520,
    categoryNames: ["デザート"],
    sortOrder: 2, sortOrderFeatured: 99,
    imageKeyword: "cheesecake slice",
  },
  {
    name: "ティラミス",
    description: "マスカルポーネとエスプレッソの本格イタリアンデザート",
    price: 580,
    categoryNames: ["デザート"],
    sortOrder: 3, sortOrderFeatured: 99,
    imageKeyword: "tiramisu dessert",
  },

  // ── サイド（メインディッシュへの追加オプション） ────────────
  {
    name: "ライス追加",
    description: "",
    price: 165,
    categoryNames: ["サイド"],
    sortOrder: 0, sortOrderFeatured: 99,
    imageKeyword: "steamed white rice bowl",
  },
  {
    name: "パン追加",
    description: "",
    price: 165,
    categoryNames: ["サイド"],
    sortOrder: 1, sortOrderFeatured: 99,
    imageKeyword: "bread basket",
  },
  {
    name: "フライドポテト",
    description: "",
    price: 220,
    categoryNames: ["サイド"],
    sortOrder: 2, sortOrderFeatured: 99,
    imageKeyword: "french fries",
  },
  {
    name: "オニオンリング",
    description: "",
    price: 220,
    categoryNames: ["サイド"],
    sortOrder: 3, sortOrderFeatured: 99,
    imageKeyword: "onion rings",
  },
  {
    name: "コーンスープ",
    description: "",
    price: 220,
    categoryNames: ["サイド"],
    sortOrder: 4, sortOrderFeatured: 99,
    imageKeyword: "corn soup cream",
  },
  {
    name: "ミニサラダ",
    description: "",
    price: 165,
    categoryNames: ["サイド"],
    sortOrder: 5, sortOrderFeatured: 99,
    imageKeyword: "mini salad bowl",
  },
];

// ---- 画像ダウンロード（リダイレクト追跡） ----
function downloadImage(keyword) {
  const url = `https://loremflickr.com/800/600/${encodeURIComponent(keyword)}`;
  return new Promise((resolve, reject) => {
    function get(u, redirects = 0) {
      if (redirects > 8) return reject(new Error("Too many redirects"));
      const mod = u.startsWith("https") ? https : http;
      const req = mod.get(u, { headers: { "User-Agent": "Mozilla/5.0" } }, (res) => {
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
      req.on("error", reject);
    }
    get(url);
  });
}

// ---- Storage アップロード ----
async function uploadImage(menuId, keyword) {
  const { buffer, contentType } = await downloadImage(keyword);
  const ext = contentType.includes("png") ? "png" : "jpg";
  const filePath = `menus/${menuId}.${ext}`;
  const file = bucket.file(filePath);
  await file.save(buffer, {
    contentType,
    metadata: { cacheControl: "public,max-age=31536000" },
  });
  await file.makePublic();
  return `https://storage.googleapis.com/gonmura-food.firebasestorage.app/${filePath}`;
}

// ---- メイン処理 ----
async function main() {
  console.log("🍽️  ファミレスメニュー投入開始\n");

  // 1. 既存メニューを deleted に
  console.log("🗑️  既存メニューをクリア中...");
  const existingMenus = await db.collection("menus").get();
  if (existingMenus.size > 0) {
    const batch = db.batch();
    for (const d of existingMenus.docs) {
      batch.update(d.ref, { status: "deleted", updatedAt: Timestamp.now() });
    }
    await batch.commit();
  }
  console.log(`   ${existingMenus.size}件 → deleted\n`);

  // 2. 既存カテゴリーを削除
  console.log("🗑️  既存カテゴリーをクリア中...");
  const existingCats = await db.collection("categories").get();
  if (existingCats.size > 0) {
    const batch = db.batch();
    for (const d of existingCats.docs) batch.delete(d.ref);
    await batch.commit();
  }
  console.log(`   ${existingCats.size}件 削除\n`);

  // 3. 新カテゴリー作成
  console.log("📂 カテゴリー作成中...");
  const categoryIdMap = new Map(); // name → id
  for (const cat of CATEGORIES) {
    const ref = db.collection("categories").doc();
    await ref.set({
      id: ref.id,
      name: cat.name,
      sortOrder: cat.sortOrder,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });
    categoryIdMap.set(cat.name, ref.id);
    console.log(`   ✅ ${cat.name}`);
  }
  console.log();

  // 4. メニュー作成
  console.log(`🍔 メニュー作成中... (${MENUS.length}品)\n`);
  for (let i = 0; i < MENUS.length; i++) {
    const menu = MENUS[i];
    const ref = db.collection("menus").doc();

    // 画像アップロード
    let imageUrl = "";
    try {
      process.stdout.write(`   [${String(i + 1).padStart(2)}/${MENUS.length}] ${menu.name} ... `);
      imageUrl = await uploadImage(ref.id, menu.imageKeyword);
      console.log("✅");
    } catch (e) {
      console.log(`⚠️  画像失敗 (${e.message})`);
    }

    const categoryIds = menu.categoryNames
      .map((n) => categoryIdMap.get(n))
      .filter(Boolean);

    await ref.set({
      id: ref.id,
      name: menu.name,
      description: menu.description,
      price: menu.price,
      categoryIds,
      imageUrl,
      status: "active",
      sortOrder: menu.sortOrder,
      sortOrderFeatured: menu.sortOrderFeatured,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });
  }

  console.log("\n🎉 完了！");
  console.log(`   カテゴリー: ${CATEGORIES.length}件`);
  console.log(`   メニュー:   ${MENUS.length}件`);
}

main().catch((e) => {
  console.error("❌ エラー:", e);
  process.exit(1);
});
