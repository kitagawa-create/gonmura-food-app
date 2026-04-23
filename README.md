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
│   ├── name              : string
│   ├── sortOrder         : int
│   ├── sortOrderFeatured : int
│   ├── sortOrderSide     : int
│   ├── createdAt   : Timestamp
│   └── updatedAt   : Timestamp
│
├── menus/{menuId}
│   ├── name              : string
│   ├── description       : string
│   ├── price             : int        // 税抜・整数
│   ├── categoryIds       : array[string]
│   ├── imageUrl          : string
│   ├── status            : string     // "active" | "soldout" | "hidden" | "deleted"
│   ├── sortOrder         : int
│   ├── sortOrderFeatured : int
│   ├── sortOrderSide     : int
│   ├── createdAt   : Timestamp
│   └── updatedAt   : Timestamp
│
├── customers/{customerId}
│   ├── customerId  : string
│   ├── tableId     : string
│   ├── guestCount  : int
│   ├── isPaid      : boolean
│   ├── createdAt   : Timestamp
│   ├── updatedAt   : Timestamp
│   │
│   └── orders/{orderId}
│       ├── orderId     : string
│       ├── customerId : string        // customers/{customerId} の参照
│       ├── status     : string        // "pending" | "completed"
│       ├── createdAt  : Timestamp
│       ├── updatedAt  : Timestamp
│       │
│       └── items/{itemId}
│           ├── itemId     : string
│           ├── orderId    : string
│           ├── customerId : string
│           ├── menuId    : string
│           ├── name      : string     // menus.name 複製
│           ├── price     : int        // menus.price 複製（単品価格）
│           ├── quantity  : int
│           ├── setId     : string     // メインは自分の itemId、サイドは親メインの itemId
│           ├── note      : string
│           └── checked   : boolean
│
├── tables/{tableId}
│   ├── tableNumber : string
│   ├── deviceId    : string
│   ├── deleted     : boolean
│   ├── createdAt   : Timestamp
│   └── updatedAt   : Timestamp
│
└── admins/{uid}
    ├── email      : string
    ├── role       : string            // "owner" | "staff"（未設定は staff 扱い）
    ├── createdAt  : Timestamp
    └── updatedAt  : Timestamp
```

### 設計の要点

- **スナップショット複製**: `items` に name と price を複製。メニュー価格変更が過去注文に影響しない
- **ソフトデリート**: メニューは `status: "deleted"` で非表示。過去注文の参照が切れない
- **カテゴリ多対多**: `categoryIds` を配列にし、1メニューが複数カテゴリ所属可
- **支払い状態は customer 単位**: 精算済みかどうかは `customers.isPaid` で管理し、`orders.status` は進行状態だけ持つ
- **表示順は用途別に分離**: 通常カテゴリは `sortOrder`、おすすめは `sortOrderFeatured`、サイドは `sortOrderSide`
- **セット商品モデル**: `items` はフラットに保存し、`setId` でメインとサイドを関連付ける

---

## ページ構成

### お客様側（テーブルタブレット / スマホ）
| パス | 内容 |
|---|---|
| `/setup` | 初期設定（テーブル番号 + テーブル変更用PIN） |
| `/menu` | メニュー一覧（2カラム: カテゴリタブ+商品グリッド / サイドカート）。メインディッシュはサイド選択モーダル、サイドカートでそのまま注文確定 |
| `/order/history` | テーブルの注文履歴（カードグリッド） |
| `/bill` | お会計伝票（レシート風、レジに提示） |

### 管理側（iPad / PC）
| パス | 内容 |
|---|---|
| `/admin/login` | メール/パスワードログイン |
| `/admin/orders` | 注文管理（商品チェック、提供完了、取消、履歴表示） |
| `/admin/register` | 支払い履歴（日付・テーブル絞り込み） |
| `/admin/sales` | 売上分析（owner のみ。月次 KPI + 日別グラフ） |
| `/admin/menus` | メニュー管理（owner: 全機能 / staff: ステータス変更、並び替え） |
| `/admin/categories` | カテゴリ管理（owner のみ、通常カテゴリのみ表示） |
| `/admin/tables` | テーブル番号+PIN設定（サイドバー非表示、URL直打ち用） |

---

## 各機能の処理フロー

### 1. テーブル初期設定
```
スタッフが /setup にアクセス
  → テーブル番号入力
  → localStorage("gonmura-table") に保存
  → /menu にリダイレクト

/menu ヘッダーの「変更」ボタンで再設定可（未精算セッションがある間は非表示）
```

### 2. メニュー閲覧〜カート追加
```
客が /menu を開く
  → getDocs(menus where status in ["active","soldout"]) + getDocs(categories orderBy sortOrder)
  → カテゴリタブ（スワイプ/ドラッグ切替）で filter
  → メニュータップで詳細モーダル
     ├── メインディッシュ: サイド選択（1個あたりの個数を ± で調整）
     └── その他（単品メニュー）: 数量ステッパー
  → 「カートに追加」
  → CartContext.addItem / addSet
  → 単品は lineId=setId で保存、セットはメイン lineId を setId にしてサイドを紐付け
  → localStorage("gonmura-cart-{N}") に自動保存
```

### 3. 注文送信（`/menu` サイドカート内で完結）
```
客がサイドカート（CartPanel）で「注文を確定する」
  → 在庫検証: 注文対象 menuId を documentId() in chunks(max30) で取得
     いずれかが status != "active" →
       該当セットを removeItem(lineId)、品切れ通知ダイアログ表示
  → setDoc(orders/{自動ID}, {
       status: "pending",
       orderId,
       customerId,
       createdAt/updatedAt: serverTimestamp()
     })
  → setDoc(items/{自動ID}) を行ごとに保存（フラット、setId で親子表現）
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
  └── 支払い履歴: 日付フィルタ付き

客が /bill で支払い確定
  → customers/{customerId}.isPaid = true
  → customer セッションと localStorage をクリア
```

### 6. 売上分析
```
/admin/sales （owner のみ）
  ├── 表示月を選択
  ├── 月内の orders を collectionGroup で取得
  ├── 対応する customer の isPaid === true のものだけ集計
  └── KPIカード + 日別売上バーを表示
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
     │                         │◄── updateDoc(isPaid=true) ┤（会計）
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
| `menus` | 誰でも | create / delete: owner、update: owner、staff は `status` + `updatedAt` のみ可 |
| `customers` | 誰でも | create は誰でも、update は staff 以上。客側は `tableId` または `isPaid` と `updatedAt` のみ更新可 |
| `orders` | 誰でも | create は誰でも、update / delete は staff 以上。客側は精算時に `updatedAt` のみ更新可 |
| `admins` | 自分の uid のみ | — |
| storage `menus/` | 誰でも | 認証済ユーザーのみ |

管理者ロールは `admins/{uid}.role: "owner" | "staff"`。role 未設定は staff 扱い。

---

## ローカルストレージ

| キー | 内容 |
|---|---|
| `gonmura-table` | テーブル番号（/setup で設定、/menu の変更モーダルで更新可） |
| `gonmura-table-id` | `tables/{tableId}` のドキュメントID |
| `gonmura-device-id` | タブレット固有ID（初回アクセス時に生成して保持） |
| `gonmura-guest-count` | 人数（sessionStorage。精算後にクリア） |
| `gonmura-customer-id` | `customers/{customerId}` のドキュメントID（精算後にクリア） |
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
