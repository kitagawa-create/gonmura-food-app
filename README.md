# Gonmura Food - モバイルオーダーシステム

ファミリーレストラン「Gonmura Food」のテーブル据え置きタブレット向けモバイルオーダー＆管理画面システム。
iPad 横画面メインで、スマホ・PCまでレスポンシブ対応。

## 技術スタック

- Next.js 16 (App Router)
- TypeScript
- Tailwind CSS 4
- Firebase (Firestore / Auth / Storage / Analytics)
- Sentry (エラー監視: client/edge/server 3構成)
- Firebase App Hosting (CI/CD)
- BigQuery (分析クエリ)

---

## DB設計

```
firestore-root
│
├── categories/{categoryId}
│   ├── name        : string           // "ハンバーグ" "パスタ" 等
│   ├── sortOrder   : int              // 表示順（昇順、DnDで変更）
│   ├── createdAt   : Timestamp
│   └── updatedAt   : Timestamp
│
├── menus/{menuId}
│   ├── name        : string           // "チャーシューメン"
│   ├── description : string
│   ├── price       : int              // 税込・整数
│   ├── categoryIds : array[string]    // 複数カテゴリに所属可能
│   ├── imageUrl    : string           // Firebase Storage URL
│   ├── isAvailable : boolean          // false = 非表示（物理削除しない）
│   ├── isSoldOut?  : boolean          // true = 売り切れ（顧客側で薄表示+「売り切れ」オーバーレイ）
│   ├── sortOrder?  : int              // 表示順（長押し→タップで変更、未設定は末尾）
│   ├── createdAt   : Timestamp
│   └── updatedAt   : Timestamp
│
├── orders/{orderId}
│   ├── items       : array[map]       // 注文時のスナップショット（コンボ単位）
│   │   └── [0..n]
│   │       ├── menuId   : string
│   │       ├── name     : string      // menus.name 複製
│   │       ├── price    : int         // menus.price 複製（単品価格、サイドメニュー分は含まない）
│   │       ├── quantity : int         // コンボなら数量
│   │       └── toppings?: array[map]  // メインディッシュのみ。{ menuId, name, price, quantity }
│   │                                  //   quantity は「1個あたり」の個数
│   ├── status       : string          // "pending" → "completed" → "paid"
│   │                                  // 取消は deleteDoc でドキュメント削除
│   ├── tableNumber  : int
│   ├── customerNote : string
│   ├── checkedItems?: array[int]      // チェック済み商品のインデックス（0-based）
│   ├── createdAt    : Timestamp
│   └── updatedAt    : Timestamp
│
└── admins/{uid}                       // Firebase Auth uid がドキュメントID
    ├── email     : string
    ├── role      : string             // "owner" | "staff"（未設定は staff 扱い）
    ├── createdAt : Timestamp
    └── updatedAt : Timestamp
```

### 設計の要点

- **スナップショット複製**: `orders.items` に name と price を複製。メニュー価格変更が過去注文に影響しない
- **物理削除しない**: メニューは `isAvailable: false` で非表示。過去注文の参照が切れない
- **カテゴリ多対多**: `categoryIds` を配列にし、1メニューが複数カテゴリ所属可
- **支払いは管理者のみ**: Security Rules で status を "paid" に変更できるのは管理者のみ
- **表示順は長押し→タップ並替えで制御**: `sortOrder` フィールドを `writeBatch` で原子的に更新
- **コンボ（メインディッシュ+サイドメニュー）モデル**: `items[i].toppings` にサイドメニューをネスト。`quantity` は「1個あたり」の個数（実消費 = コンボ quantity × side.quantity）

---

## ページ構成

### お客様側（テーブルタブレット / スマホ）
| パス | 内容 |
|---|---|
| `/setup` | 初期設定（テーブル番号 + テーブル変更用PIN） |
| `/menu` | メニュー一覧（2カラム: カテゴリタブ+商品グリッド / サイドカート）。メインディッシュはサイド選択モーダル、サイドカートで**そのまま注文確定**（完了ダイアログ3秒オートクローズ） |
| `/order/history` | テーブルの注文履歴（カードグリッド） |
| `/bill` | お会計伝票（レシート風、レジに提示） |

### 管理側（iPad / PC）
| パス | 内容 |
|---|---|
| `/admin/login` | メール/パスワードログイン |
| `/admin/orders` | 注文管理（商品チェックリスト方式、全チェック→「提供完了」ボタンで completed へ、履歴ビュー+日付検索） |
| `/admin/register` | レジ（未精算/精算済タブ + **本日売上ドーナツ円グラフ + 目標達成率**） |
| `/admin/sales` | 売上分析（owner のみ。KPIカード + 売上推移/メニュー別売数/価格変更前後比較を切替、コンボ集計は flattenForReceipt で分解） |
| `/admin/menus` | メニュー管理（owner: 全機能 / staff: 公開+売り切れトグル、長押し→タップ並替え） |
| `/admin/categories` | カテゴリ管理（owner のみ、長押し→タップ並替え） |
| `/admin/tables` | テーブル番号+PIN設定（サイドバー非表示、URL直打ち用） |

---

## 各機能の処理フロー

### 1. テーブル初期設定
```
スタッフが /setup にアクセス
  → テーブル番号入力
  → localStorage("gonmura-table") に保存
  → /menu にリダイレクト

/menu ヘッダーの「変更」ボタンで再設定可（未 paid 注文がある間は非表示）
```

### 2. メニュー閲覧〜カート追加
```
客が /menu を開く
  → getDocs(menus where isAvailable==true) + getDocs(categories orderBy sortOrder)
  → カテゴリタブ（スワイプ/ドラッグ切替）で filter
  → メニュータップで詳細モーダル
     ├── メインディッシュ: サイド選択（1個あたりの個数を ± で調整）
     └── その他（単品メニュー）: 数量ステッパー
  → 「カートに追加」
  → CartContext.addItem → comboLineHash(menuId, toppings) で同構成コンボへ merge、
     新規なら lineId を発行して追加、localStorage("gonmura-cart-{N}") に自動保存
```

### 3. 注文送信（`/menu` サイドカート内で完結）
```
客がサイドカート（CartPanel）で「注文を確定する」
  → 在庫検証: コンボ本体+全サイドの menuId を documentId() in chunks(max30) で取得
     いずれかが isAvailable=false または isSoldOut=true →
       該当コンボを removeItem(lineId)、品切れ通知ダイアログ表示
  → setDoc(orders/{自動ID}, {
       items,        // OrderItem[]（コンボ単位、toppings ネスト）
       status: "pending",
       tableNumber,
       customerNote,
       createdAt/updatedAt: serverTimestamp()
     })
  → trackEvent("purchase", { table_number, items_count, total_amount })
  → clearCart() → 完了ダイアログ（3秒オートクローズ、画面遷移なし）
```

### 4. 管理側：注文受付〜提供
```
/admin/orders
  ├── onSnapshot で orders を購読（createdAt asc = 古い順）
  ├── 新規注文検知 → Web Audio API で通知音
  ├── 日付自動ロールオーバー（autoFollowToday フラグ）
  ├── 商品チェックリスト方式
  │    各 item を 1つずつタップしてチェック → checkedItems 配列に index 追加
  └── 全チェック後「提供完了」ボタン → status を "completed" に更新
       （取消は deleteDoc + ConfirmDialog 確認。履歴ビューから日付検索可）
```

### 5. お会計〜精算
```
客がメニュー画面で「お会計」をタップ
  → /bill ページ
     → 未精算注文をまとめて伝票表示（税込逆算で消費税分離）

管理側 /admin/register
  ├── 本日の売上ドーナツ円グラフ（達成率%、目標は localStorage で編集可）
  ├── 未精算タブ: テーブル別注文一覧 + 「精算完了」ボタン
  └── 精算済タブ: 日付フィルタ付き
     → 「精算完了」→ 全注文の status を "paid" に writeBatch で更新
```

### 6. 売上分析
```
/admin/sales （owner のみ）
  ├── KPIカード: 合計売上 / 注文数 / 客単価 / 平均品数
  ├── 期間切替 <select>: 日別(直近90日) / 週別(52週) / 月別(36ヶ月)
  └── 分析切替 <select>:
       ├── 売上推移: バー or 折れ線。バータップで期間詳細(注文数/客単価/メニュー別内訳)
       ├── メニュー別売数: 折れ線（最大5メニュー重ね描き、同一スケール）
       └── 価格変更前後比較: 価格帯別の売数推移を折れ線で比較
```

### 7. データの流れ
```
[客タブレット]              [Firestore]               [管理PC / iPad]
     │                         │                           │
     │ getDocs(menus) ────────►│                           │
     │◄── メニュー一覧 ─────────┤                           │
     │                         │                           │
     │ localStorage でカート    │                           │
     │                         │                           │
     │ setDoc(orders) ────────►│                           │
     │                         ├── onSnapshot ────────────►│
     │                         │   通知音♪                  │
     │                         │                           │
     │                         │◄── updateDoc(status) ─────┤
     │◄── onSnapshot ──────────┤                           │
     │                         │                           │
     │ getDocs(orders) ───────►│                           │
     │◄── 未精算注文 ───────────┤                           │
     │                         │◄── updateDoc("paid") ─────┤（レジ精算）
```

---

## 分析 (BigQuery)

`bigquery/queries.sql` に以下のクエリ集を用意:
- 日別/週別/月別 売上レポート
- 人気メニューランキング
- 時間帯別注文数 など

Firestore → BigQuery エクスポート拡張を前提。

---

## Security Rules

| コレクション | 読み | 書き |
|---|---|---|
| `categories` | 誰でも | owner のみ |
| `menus` | 誰でも | create / delete: owner、update: owner、staff は `isAvailable` + `isSoldOut` + `updatedAt` のみ可 |
| `orders` | 誰でも | 作成は誰でも（tableNumber 1-30 バリデーション）/ 更新・削除は staff 以上 |
| `admins` | 自分の uid のみ | — |
| storage `menus/` | 誰でも | 認証済ユーザーのみ |

管理者ロールは `admins/{uid}.role: "owner" | "staff"`。role 未設定は staff 扱い。

---

## ローカルストレージ

| キー | 内容 |
|---|---|
| `gonmura-table` | テーブル番号（/setup で設定、/menu の変更モーダルで更新可） |
| `gonmura-table-pin` | テーブル変更用PIN（4桁、デフォルト "1234"） |
| `gonmura-cart-{N}` | テーブルNのカート（精算時にクリア、lineId 付きコンボ単位で保存） |
| `gonmura-sales-goal` | 本日売上目標（管理画面で編集、default ¥100,000） |

---

## セットアップ

```bash
npm install
cp .env.local.example .env.local  # Firebase設定値を記入
npm run dev
```

### 必要な環境変数 (`.env.local`)
```
NEXT_PUBLIC_FIREBASE_API_KEY=...
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=...
NEXT_PUBLIC_FIREBASE_PROJECT_ID=...
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=...
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=...
NEXT_PUBLIC_FIREBASE_APP_ID=...
NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID=...  # 未設定だと Analytics のコンソールエラー発生
SENTRY_DSN=...
```

### Firebase で必要な設定
1. Authentication → メール/パスワードを有効化
2. Firestore Database → 作成（`asia-northeast1`）
3. Storage → 作成
4. `admins` コレクションに管理者ドキュメントを追加

### 管理者の初回登録
1. Firebase コンソール > Authentication > ユーザーを追加
2. Firestore > `admins` コレクション > ドキュメント追加
   - ドキュメントID: ユーザーの uid
   - `email`, `role: "owner"` または `"staff"`, `createdAt: serverTimestamp()`, `updatedAt: serverTimestamp()`

---

## コマンド

| コマンド | 内容 |
|---|---|
| `npm run dev` | 開発サーバー起動 |
| `npm run build` | 本番ビルド |
| `npx tsc --noEmit` | TypeScript 型チェック |
| `npm run lint` | ESLint |
| `firebase deploy --only firestore:rules` | Firestore Rules デプロイ |
| `firebase deploy --only storage` | Storage Rules デプロイ |
| `node scripts/update-menu-images.mjs` | メニュー画像一括更新（要 ADC） |

---

## アーキテクチャ要点

- **サーバーレス**: Firestore / Auth / Storage のみ、Next.js API Routes 不使用
- **リアルタイム**: `onSnapshot` で注文ステータスを両画面で同期
- **オフライン耐性**: カート状態のみ localStorage（注文送信は要ネット）
- **型安全**: Menu / Order / Category 等を `src/types/index.ts` に集約
- **UIライブラリ非依存**: DnD/円グラフ/棒グラフは純SVG + HTML5で自作（Next.js 16独自版との互換性維持）

---

## デプロイ

Firebase App Hosting で自動デプロイ。`main` ブランチへの push で自動ビルド。

```
本番URL: https://gonmura-food-app--gonmura-food.asia-east1.hosted.app
GitHub:  https://github.com/kitagawa-create/gonmura-food-app
```
