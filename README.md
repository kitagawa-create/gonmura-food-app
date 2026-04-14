# Gonmura Food - モバイルオーダーシステム

家系ラーメン店「権村家」のテーブル据え置きタブレット向けモバイルオーダー＆管理画面システム。

## 技術スタック

- Next.js 16 (App Router)
- TypeScript
- Tailwind CSS
- Firebase (Firestore / Auth / Storage)

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
│   ├── imageUrl    : string           // Firebase Storage or 外部URL
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
│   ├── customerNote  : string         // 備考（アレルギー等）
│   ├── createdAt     : Timestamp
│   └── updatedAt     : Timestamp
│
└── admins/{uid}                       // Firebase Auth の uid がドキュメントID
    ├── email     : string
    ├── role      : string             // "admin"
    └── createdAt : Timestamp
```

### 設計の要点

**スナップショットパターン**
orders.items に name と price を複製保存する。menus の価格が後から変わっても、過去の注文金額は変わらない。

**物理削除しない**
メニューは isAvailable: false で非表示にする。削除すると過去注文の menuId 参照が切れるため。

**カテゴリの多対多**
menus.categoryIds を配列にすることで、1品が「おすすめ」と「ラーメン」の両方に所属できる。
カテゴリ名の変更は categories の1件更新で済む。

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
/bill               お会計（伝票表示 → 支払い完了）

管理側（PCブラウザ）
─────────────────────────────
/admin/login        メール/パスワードログイン
/admin/orders       注文管理（リアルタイム・ステータス更新・通知音）
/admin/menus        メニューCRUD（画像アップロード）
/admin/categories   カテゴリ管理
```

---

## 各機能の処理フロー

### 1. テーブル初期設定

```
スタッフがタブレットで /setup にアクセス
  │
  ├── PIN入力（1234）
  │     → 認証OK
  │
  └── テーブル番号入力（例: 3）
        → localStorage に保存
        → /menu にリダイレクト
        → 以降、このタブレットはテーブル3として動作
```

### 2. メニュー閲覧〜カート追加

```
お客様が /menu を開く
  │
  ├── Firestore から取得
  │     categories: orderBy("sortOrder") で全件取得
  │     menus: where("isAvailable", "==", true) で全件取得
  │
  ├── カテゴリタブで切り替え表示
  │     menus.categoryIds に該当カテゴリIDを含むものをフィルタ
  │
  └── 「追加」ボタン
        → { menuId, name, price } を CartContext に追加
        → localStorage("gonmura-cart-3") に自動保存
        → リロードしても消えない
```

### 3. 注文送信

```
お客様が /cart → /order に進む
  │
  ├── 注文内容の確認（items, 合計金額, テーブル番号）
  │
  └── 「注文を確定する」ボタン
        │
        ├── Firestore に書き込み
        │     orders/{自動生成ID} = {
        │       items: [{ menuId, name, price, quantity }, ...],  ← スナップショット
        │       status: "pending",
        │       tableNumber: 3,
        │       customerNote: "...",
        │       createdAt: serverTimestamp(),
        │       updatedAt: serverTimestamp()
        │     }
        │
        ├── カートをクリア
        │
        └── /order/{orderId} にリダイレクト
              → onSnapshot でステータスをリアルタイム監視
```

### 4. 管理側：注文受付〜提供

```
管理画面 /admin/orders
  │
  ├── onSnapshot で注文をリアルタイム取得
  │     where("createdAt", ">=", 今日) + orderBy("createdAt", "desc")
  │
  ├── 新規注文検知 → ピンポン通知音（Web Audio API）
  │
  ├── ステータスタブ（未対応 / 調理中 / 完了）
  │
  └── ステータス更新ボタン
        「調理開始」: status → "preparing"
        「提供完了」: status → "completed"
        「キャンセル」: status → "cancelled"
        │
        └── updateDoc(orders/{id}, { status, updatedAt })
              → お客様側の onSnapshot に即反映
```

### 5. お会計

```
お客様が /menu の「お会計」ボタンをタップ
  │
  ├── /bill ページ
  │     Firestore クエリ:
  │       where("tableNumber", "==", 3)
  │       where("status", "in", ["pending", "preparing", "completed"])
  │
  ├── 同じ品名・価格のアイテムをまとめて伝票表示
  │     小計 / 消費税(10%) / 合計
  │
  ├── 「この画面をレジにてご提示ください」
  │
  └── 「支払い完了」ボタン
        │
        ├── 全注文の status → "paid" に更新
        ├── カートをクリア（localStorage も削除）
        ├── 完了画面表示
        └── 3秒後に /menu へ自動遷移
              → 次のお客様は白紙の状態から開始
```

### 6. データの流れ全体図

```
[お客様タブレット]                    [Firestore]                    [管理PC]
     │                                    │                              │
     │  メニュー取得                       │                              │
     ├──── getDocs(menus) ──────────────►│                              │
     │◄──── メニュー一覧 ─────────────────┤                              │
     │                                    │                              │
     │  カート操作                         │                              │
     ├──── localStorage のみ              │                              │
     │     (Firestore不使用)              │                              │
     │                                    │                              │
     │  注文送信                           │                              │
     ├──── setDoc(orders) ─────────────►│                              │
     │                                    ├──── onSnapshot ─────────────►│
     │                                    │     新規注文通知音♪            │
     │                                    │                              │
     │  ステータス監視                     │         ステータス更新        │
     │◄──── onSnapshot ──────────────────┤◄──── updateDoc ──────────────┤
     │     「調理中です」                  │     "preparing"              │
     │     「完成しました！」              │     "completed"              │
     │                                    │                              │
     │  お会計                             │                              │
     ├──── getDocs(orders) ─────────────►│                              │
     │◄──── テーブルの全注文 ─────────────┤                              │
     │                                    │                              │
     │  支払い完了                         │                              │
     ├──── updateDoc(status:"paid") ───►│                              │
     │     カート・履歴リセット            │                              │
```

---

## Security Rules

```
categories  → 誰でも読める、管理者のみ書ける
menus       → 誰でも読める、管理者のみ書ける
orders      → 誰でも作成・読める
              status を "paid" に変更 → 誰でも可
              その他の更新 → 管理者のみ
admins      → 自分の uid のドキュメントのみ読める
```

---

## ローカルストレージ

```
gonmura-table       : number    テーブル番号（タブレット固定）
gonmura-cart-{N}    : CartItem[] テーブルNのカート内容
```

テーブルごとにカートが分離されている。支払い完了時にクリアされる。

---

## セットアップ

```bash
# 依存インストール
npm install

# 環境変数設定
cp .env.local.example .env.local
# Firebase の設定値を記入

# 開発サーバー起動
npm run dev
```

### Firebase で必要な設定

1. Authentication → メール/パスワード を有効化
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
