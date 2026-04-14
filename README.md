# Gonmura Food - モバイルオーダーシステム

家系ラーメン店「権村家」のテーブル据え置きタブレット向けモバイルオーダー＆管理画面システム。

## 技術スタック

- Next.js 16 (App Router)
- TypeScript
- Tailwind CSS
- Firebase (Firestore / Auth / Storage / Analytics)
- Sentry (エラー監視)

---

## DB設計

```
firestore-root
│
├── categories/{categoryId}
│   ├── name        : string           // "ラーメン" "トッピング" 等
│   ├── sortOrder   : int              // 表示順（昇順）
│   ├── createdAt   : Timestamp
│   └── updatedAt   : Timestamp
│
├── menus/{menuId}
│   ├── name        : string           // "チャーシューメン"
│   ├── description : string           // "厚切りチャーシューがゴロゴロ"
│   ├── price       : int              // 1100（税込・整数）
│   ├── categoryIds : array[string]    // 複数カテゴリに所属可能
│   ├── imageUrl    : string           // Firebase Storage URL
│   ├── isAvailable : boolean          // false = 品切れ（非表示）
│   ├── createdAt   : Timestamp
│   └── updatedAt   : Timestamp
│
├── orders/{orderId}
│   ├── items       : array[map]       // 注文時のスナップショット
│   │   └── [0..n]
│   │       ├── menuId   : string      // 元メニューへの参照
│   │       ├── name     : string      // 注文時点のメニュー名
│   │       ├── price    : int         // 注文時点の価格
│   │       └── quantity : int
│   ├── status        : string         // "pending" → "preparing" → "completed" → "paid"
│   │                                  // "pending" → "cancelled"
│   ├── tableNumber   : int            // テーブル番号
│   ├── customerNote  : string         // 備考
│   ├── createdAt     : Timestamp
│   └── updatedAt     : Timestamp
│
└── admins/{uid}                       // Firebase Auth uid がドキュメントID
    ├── email     : string
    ├── role      : string             // "admin"
    └── createdAt : Timestamp
```

### 設計の要点

- **スナップショットパターン**: orders.items に name と price を複製。メニュー価格変更が過去注文に影響しない
- **物理削除しない**: メニューは isAvailable: false で非表示。過去注文の参照が切れない
- **カテゴリの多対多**: categoryIds を配列にし、1品が複数カテゴリに所属可能
- **支払いは管理者のみ**: Security Rules で status を "paid" に変更できるのは管理者のみ

---

## ページ構成

```
お客様側（テーブルタブレット）
─────────────────────────────
/setup              初期設定（PIN認証 → テーブル番号入力）
/menu               メニュー一覧（カテゴリタブ切替）
/cart               カート（数量変更・削除）
/order              注文確認・送信
/order/[orderId]    注文ステータス（リアルタイム）
/order/history      テーブルの注文履歴
/bill               お会計伝票（レジに提示）

管理側（PCブラウザ）
─────────────────────────────
/admin/login        メール/パスワードログイン
/admin/orders       注文管理（リアルタイム・ステータス更新・通知音）
/admin/register     レジ（テーブル別精算・精算済み一覧）
/admin/sales        売上分析（日別/週別/月別・ABC分析・ピーク時間帯・カテゴリ別）
/admin/menus        メニューCRUD（画像アップロード）
/admin/categories   カテゴリ管理
```

---

## 各機能の処理フロー

### 1. テーブル初期設定

```
スタッフがタブレットで /setup にアクセス
  ├── PIN入力（1234）→ 認証OK
  └── テーブル番号入力（例: 3）
        → localStorage に保存
        → /menu にリダイレクト
        → 以降このタブレットはテーブル3として動作
```

### 2. メニュー閲覧〜カート追加

```
お客様が /menu を開く
  ├── Firestore から取得
  │     categories: orderBy("sortOrder") で全件
  │     menus: where("isAvailable", "==", true) で全件
  ├── カテゴリタブで切り替え表示
  └── 「追加」ボタン
        → { menuId, name, price } を CartContext に追加
        → localStorage("gonmura-cart-3") に自動保存
        → リロードしても消えない
```

### 3. 注文送信

```
お客様が /cart → /order に進む
  └── 「注文を確定する」ボタン
        ├── Firestore に書き込み
        │     orders/{自動ID} = {
        │       items: [{ menuId, name, price, quantity }],  ← スナップショット
        │       status: "pending",
        │       tableNumber: 3,
        │       customerNote: "...",
        │       createdAt: serverTimestamp()
        │     }
        ├── Analytics カスタムイベント送信（purchase）
        ├── カートをクリア
        └── /order/{orderId} にリダイレクト
              → onSnapshot でステータスをリアルタイム監視
```

### 4. 管理側：注文受付〜提供

```
管理画面 /admin/orders
  ├── onSnapshot で注文をリアルタイム取得
  ├── 新規注文検知 → ピンポン通知音（Web Audio API）
  ├── ステータスタブ（未対応 / 調理中 / 完了）
  └── ステータス更新ボタン
        「調理開始」→ "preparing"
        「提供完了」→ "completed"
        「キャンセル」→ "cancelled"
        → お客様側の onSnapshot に即反映
```

### 5. お会計〜精算

```
お客様がメニュー画面で「お会計」をタップ
  └── /bill ページ
        → テーブルの全注文をまとめて伝票表示
        → 「この画面をレジにてご提示ください」

管理側 /admin/register
  ├── 未精算タブ: テーブル別の注文一覧 + 「精算完了」ボタン
  └── 精算済みタブ: 日付フィルタ付き精算済み一覧
        → 「精算完了」→ 全注文の status を "paid" に更新
```

### 6. 売上分析

```
管理側 /admin/sales
  ├── サマリー（総売上・注文数・平均単価）
  ├── 売上レポート（日別/週別/月別切替）
  ├── メニューABC分析（A主力/B準主力/C検討）
  ├── ピーク時間帯ヒートマップ（曜日×時間）
  └── カテゴリ別注文率
```

### 7. データの流れ全体図

```
[お客様タブレット]                [Firestore]                [管理PC]
     │                                │                          │
     │  メニュー取得                    │                          │
     ├── getDocs(menus) ────────────►│                          │
     │◄── メニュー一覧 ────────────────┤                          │
     │                                │                          │
     │  カート操作                     │                          │
     ├── localStorage のみ            │                          │
     │                                │                          │
     │  注文送信                       │                          │
     ├── setDoc(orders) ─────────────►│                          │
     │                                ├── onSnapshot ───────────►│
     │                                │   通知音♪                 │
     │                                │                          │
     │  ステータス監視                 │     ステータス更新         │
     │◄── onSnapshot ────────────────┤◄── updateDoc ────────────┤
     │   「調理中」「完成」            │                          │
     │                                │                          │
     │  お会計                         │                          │
     ├── getDocs(orders) ────────────►│                          │
     │◄── テーブルの全注文 ────────────┤                          │
     │                                │        レジで精算         │
     │                                │◄── updateDoc("paid") ───┤
```

---

## Security Rules

```
categories  → 誰でも読める、管理者のみ書ける
menus       → 誰でも読める、管理者のみ書ける
orders      → 誰でも作成・読める、更新は管理者のみ
admins      → 自分のuidのドキュメントのみ読める
storage     → menus/ は誰でも読める、認証済みユーザーのみ書ける
```

---

## ローカルストレージ

```
gonmura-table       : number      テーブル番号（スタッフがPIN認証で設定）
gonmura-cart-{N}    : CartItem[]  テーブルNのカート（精算時にクリア）
```

---

## セットアップ

```bash
npm install
cp .env.local.example .env.local  # Firebase設定値を記入
npm run dev
```

### Firebase で必要な設定

1. Authentication → メール/パスワードを有効化
2. Firestore Database → 作成（asia-northeast1）
3. Storage → 作成
4. admins コレクションに管理者の uid を登録

### 管理者の初回登録

1. Firebase コンソール > Authentication > ユーザーを追加
2. Firestore > admins コレクション > ドキュメント追加
   - ドキュメントID: ユーザーの uid
   - email: メールアドレス
   - role: "admin"
   - createdAt: 現在時刻

---

## デプロイ

Firebase App Hosting で自動デプロイ。`main` ブランチへのpushで自動ビルド・デプロイ。

```
本番URL: https://gonmura-food-app--gonmura-food.asia-east1.hosted.app
GitHub:  https://github.com/kitagawa-create/gonmura-food-app
```
