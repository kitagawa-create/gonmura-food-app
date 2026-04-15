# Gonmura Food - モバイルオーダーシステム

家系ラーメン店「権村家」のテーブル据え置きタブレット向けモバイルオーダー＆管理画面システム。
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
│   ├── name        : string           // "ラーメン" "トッピング" 等
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
│   ├── sortOrder?  : int              // 表示順（DnDで変更、未設定は末尾）
│   ├── createdAt   : Timestamp
│   └── updatedAt   : Timestamp
│
├── orders/{orderId}
│   ├── items       : array[map]       // 注文時のスナップショット
│   │   └── [0..n]
│   │       ├── menuId   : string
│   │       ├── name     : string      // menus.name 複製
│   │       ├── price    : int         // menus.price 複製
│   │       └── quantity : int
│   ├── status       : string          // "pending" → "preparing" → "completed" → "paid"
│   │                                  // 取消は deleteDoc でドキュメント削除
│   ├── tableNumber  : int
│   ├── customerNote : string
│   ├── createdAt    : Timestamp
│   └── updatedAt    : Timestamp
│
└── admins/{uid}                       // Firebase Auth uid がドキュメントID
    ├── email     : string
    ├── role      : string             // "admin"
    ├── createdAt : Timestamp
    └── updatedAt : Timestamp
```

### 設計の要点

- **スナップショット複製**: `orders.items` に name と price を複製。メニュー価格変更が過去注文に影響しない
- **物理削除しない**: メニューは `isAvailable: false` で非表示。過去注文の参照が切れない
- **カテゴリ多対多**: `categoryIds` を配列にし、1メニューが複数カテゴリ所属可
- **支払いは管理者のみ**: Security Rules で status を "paid" に変更できるのは管理者のみ
- **表示順はDnDで制御**: `sortOrder` フィールドを `writeBatch` で原子的に更新

---

## ページ構成

### お客様側（テーブルタブレット / スマホ）
| パス | 内容 |
|---|---|
| `/setup` | 初期設定（PIN認証 → テーブル番号入力） |
| `/menu` | メニュー一覧（カテゴリタブ、画像モーダルに**数量ステッパー**） |
| `/order` | 注文確認・数量編集・送信（旧 `/cart` を統合） |
| `/order/[orderId]` | 注文ステータス（リアルタイム更新） |
| `/order/history` | テーブルの注文履歴（カードグリッド） |
| `/bill` | お会計伝票（レシート風、レジに提示） |

### 管理側（iPad / PC）
| パス | 内容 |
|---|---|
| `/admin/login` | メール/パスワードログイン |
| `/admin/orders` | 注文カンバン（古い順、自動日付ロール、通知音、逆行可） |
| `/admin/register` | レジ（未精算/精算済タブ + **本日売上ドーナツ円グラフ + 目標達成率**） |
| `/admin/sales` | 売上分析（売上レポート + 人気メニューTop10、共通期間切替） |
| `/admin/menus` | メニューCRUD（画像アップロード、**DnD並び替え**、複数カテゴリ重複表示） |
| `/admin/categories` | カテゴリ管理（**DnD並び替え** + ▲▼ボタン） |

---

## 各機能の処理フロー

### 1. テーブル初期設定
```
スタッフが /setup にアクセス
  → PIN入力（1234）
  → テーブル番号入力
  → localStorage("gonmura-table") に保存
  → /menu にリダイレクト
```

### 2. メニュー閲覧〜カート追加
```
客が /menu を開く
  → getDocs(menus where isAvailable==true) + getDocs(categories orderBy sortOrder)
  → カテゴリタブで filter
  → メニュータップで詳細モーダル
  → 数量ステッパー（±ボタン、1〜99）
  → 「カートに追加 ¥合計」ボタン
  → CartContext に追加、localStorage("gonmura-cart-{N}") に自動保存
```

### 3. 注文送信
```
客が /order に進む
  → カート内容を表示、数量編集可能
  → 備考入力（任意）
  → 「注文を確定する」
     ├── setDoc(orders/{自動ID}, { items, status:"pending", tableNumber, customerNote, serverTimestamp() })
     ├── trackEvent("purchase", { table_number, items_count, total_amount })
     ├── clearCart()
     └── /order/{orderId} にリダイレクト → onSnapshot でリアルタイム監視
```

### 4. 管理側：注文受付〜提供
```
/admin/orders
  ├── onSnapshot で orders を購読（createdAt asc = 古い順）
  ├── 新規注文検知 → Web Audio API で通知音（2音）
  ├── 日付自動ロールオーバー（30秒おき、autoFollowTodayフラグ）
  ├── 5分以上未対応 pending は赤ハイライト
  └── ステータス遷移ボタン
       pending → preparing（調理開始）
       preparing → completed（提供完了）
       completed → preparing（戻す、誤操作対応）
       取消は deleteDoc でドキュメント削除（ConfirmDialog確認）
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
/admin/sales
  ├── 共通の期間切替 <select>（日別 / 週別 / 月別）
  ├── 売上レポート: 横棒グラフ（直近30日 / 20週 / 月別無制限）
  └── 人気メニュー: 当該期間内の Top 10 横棒グラフ
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
| `categories` | 誰でも | 管理者のみ |
| `menus` | 誰でも | 管理者のみ |
| `orders` | 誰でも | 作成は誰でも / 更新は管理者のみ |
| `admins` | 自分の uid のみ | — |
| storage `menus/` | 誰でも | 認証済ユーザーのみ |

---

## ローカルストレージ

| キー | 内容 |
|---|---|
| `gonmura-table` | テーブル番号（PIN認証で設定） |
| `gonmura-cart-{N}` | テーブルNのカート（精算時にクリア） |
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
   - `email`, `role: "admin"`, `createdAt: serverTimestamp()`

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
