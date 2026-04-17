@AGENTS.md

# Gonmura Food - モバイルオーダーシステム

## プロジェクト概要
家系ラーメン店「権村家」のテーブル据え置きタブレット向けモバイルオーダー＆管理画面。
iPad横画面メイン、スマホ・PCまでレスポンシブ対応。

## 技術スタック
- Next.js 16 App Router + TypeScript + Tailwind CSS 4
- Firebase: Firestore, Auth (メール/パスワード), Storage, Analytics
- Sentry: エラー監視 (client / server / edge 3構成)
- Firebase App Hosting: CI/CD (main push で自動デプロイ)
- BigQuery: 分析クエリ

## ディレクトリ構造
```
src/
├── middleware.ts                 # Cache-Control 強制上書き (CDN no-store)
├── app/
│   ├── (customer)/              # お客様側（テーブルタブレット）
│   │   ├── layout.tsx           # CartProvider + AnalyticsProvider + force-dynamic
│   │   ├── setup/page.tsx       # テーブル番号 + PIN 初期設定
│   │   ├── menu/page.tsx        # メニュー一覧（カテゴリタブ+スワイプ切替、商品モーダル、ラーメン→トッピング追加、売り切れオーバーレイ、PIN認証テーブル変更）+ サイドカートで注文確定
│   │   ├── order/page.tsx       # /menu へのリダイレクトのみ（注文確定はCartPanelに移行済み）
│   │   ├── order/history/       # テーブル注文履歴
│   │   └── bill/page.tsx        # お会計伝票（未精算注文をまとめ表示）
│   ├── admin/                   # 管理側（iPad / PC）
│   │   ├── layout.tsx           # AdminAuthGuard + AdminSidebar + ToastProvider（loginは除外）
│   │   ├── login/page.tsx       # メール/パスワードログイン
│   │   ├── orders/page.tsx      # 注文管理（商品チェックリスト方式、全チェック→提供完了ボタン、履歴ビュー+日付検索）
│   │   ├── register/page.tsx    # レジ（未精算/精算済みタブ、売上ドーナツ円グラフ、目標達成率）
│   │   ├── sales/page.tsx       # 売上分析（owner のみ。年月日プルダウン期間指定、KPI4枚、売上推移/メニュー別売数/曜日・時間帯ヒートマップ）
│   │   ├── menus/page.tsx       # メニューCRUD（owner: 全機能 / staff: 公開+売り切れトグル）
│   │   └── categories/page.tsx  # カテゴリ管理（owner のみ、長押し→タップ並替え対応）
│   ├── global-error.tsx         # Sentryエラーキャッチ画面
│   ├── layout.tsx               # ルートレイアウト（lang="ja"）
│   └── page.tsx                 # / → /menu クライアントリダイレクト
├── components/
│   ├── admin/
│   │   ├── AdminAuthGuard.tsx   # 認証ガード + role 取得 → AdminProvider で配下に提供
│   │   ├── AdminContext.tsx     # AdminProvider / useAdminRole フック
│   │   ├── AdminPageHeader.tsx  # 管理画面共通ヘッダー（title, subtitle, rightSlot）
│   │   ├── AdminSidebar.tsx     # サイドバーナビ（h-full固定、staff は sales/categories を非表示）
│   │   └── ConfirmDialog.tsx    # 確認ダイアログ（画面中央モーダル、赤/緑ボタン）
│   ├── customer/
│   │   ├── AnalyticsProvider.tsx # Firebase Analytics初期化（page_viewイベント）
│   │   └── CartPanel.tsx        # サイドカート（注文確定・在庫チェック・完了ダイアログ、/menu内で使用）
│   └── ui/
│       ├── BackButton.tsx       # 戻るボタン（size="default"|"sm"、variant="light"|"dark"）
│       ├── FadeImage.tsx        # 画像ローディング（スケルトン → フェードイン）
│       ├── FullScreenLoader.tsx # 全画面ローディング（お客様側用）
│       ├── PageLoader.tsx       # コンテンツ部分ローディングスピナー（管理側、サイドバー残す）
│       └── Snackbar.tsx         # ToastProvider + useToast()（右下固定/3秒/最新1件）
├── lib/
│   ├── firebase.ts              # Firebase初期化（db, auth, storage export、measurementId含む）
│   ├── cart-context.tsx          # CartProvider（localStorage永続化、テーブルごとカート分離、数量指定addItem）
│   ├── admin-auth.ts            # loginWithEmail, logout, getAdminRole, subscribeAuth
│   ├── analytics.ts             # trackEvent（Firebase Analytics logEvent wrapper）
│   └── order-utils.ts           # comboUnitPrice, comboLineTotal, orderGrandTotal, flattenForReceipt, comboLineHash
└── types/
    └── index.ts                 # Category, Menu, Order, OrderItem, OrderStatus, AdminRole, Admin, CartItem
```

## 型定義 (src/types/index.ts)
```
Category          { id, name, sortOrder: number, createdAt, updatedAt }
Menu              { id, name, description, price: number, categoryIds: string[], imageUrl, isAvailable, isSoldOut?: boolean, sortOrder?: number, createdAt, updatedAt }
OrderItemTopping  { menuId, name, price: number, quantity: number }  ← quantity は「1杯あたり」
OrderItem         { menuId, name, price: number, quantity: number, toppings?: OrderItemTopping[] }  ← 注文時スナップショット。price は単品価格（トッピング分は含まない）、quantity はコンボなら「杯数」
OrderStatus       "pending" | "completed" | "paid"
AdminRole         "owner" | "staff"
Order             { id, items: OrderItem[], status: OrderStatus, tableNumber: number, customerNote, guestCount?: number, checkedItems?: number[], createdAt, updatedAt }
Admin             { uid, email, role, createdAt, updatedAt }
CartItemTopping   { menuId, name, price: number, quantity: number }  ← quantity は「1杯あたり」
CartItem          { lineId, menuId, name, price: number, quantity: number, toppings?: CartItemTopping[] }  ← localStorage保存、Firestore不使用。lineId でコンボを識別（同 menuId でも構成が違えば別 line）
```

## Firestore コレクション
- `categories/{categoryId}` → Category型。name, sortOrder（長押し→タップ or DnD で変更）
- `menus/{menuId}` → Menu型。price整数, categoryIds配列, isAvailable で非公開制御, isSoldOut で売り切れ制御, sortOrder? で並び替え
- `orders/{orderId}` → Order型。items配列にスナップショット, statusで遷移管理, checkedItems で商品チェック状態。guestCount は注文時にlocalStorageから付与
- `admins/{uid}` → Admin型。Firebase Auth uidがドキュメントID

## ステータス遷移
```
pending → completed → paid（正常フロー）
注文管理画面で商品を1つずつチェック → 全チェック後「提供完了」ボタンで completed に遷移
取消は deleteDoc でドキュメント削除（ConfirmDialogで確認）
paid への変更は管理者のみ（レジ画面から）
```

## Security Rules (firestore.rules)
- categories: 誰でも読める、owner のみ書ける
- menus: 誰でも読める / create・delete は owner / update は owner、staff は isAvailable + isSoldOut + updatedAt のみ可
- orders: 誰でも作成・読める（tableNumber バリデーション 1-50）、更新・削除は staff 以上（owner も可）
- admins: 自分のuidのドキュメントのみ読める
- storage menus/: 誰でも読める、認証済みユーザーのみ書ける
- 管理者ロールは admins/{uid}.role: "owner" | "staff"。role 未設定は staff 扱い

## localStorage キー
- `gonmura-table` — テーブル番号（/setup で設定）
- `gonmura-table-pin` — テーブル変更用PIN（4桁、デフォルト "1234"）
- `gonmura-cart-{N}` — テーブルNのカート（精算時にクリア）
- `gonmura-sales-goal` — 本日売上目標（管理画面で編集、default ¥100,000）

## コマンド
- `npm run dev` — 開発サーバー起動
- `npm run build` — 本番ビルド（.next を全削除してからビルド）
- `npx tsc --noEmit` — TypeScript型チェック
- `firebase deploy --only firestore:rules` — Firestore Rulesデプロイ
- `firebase deploy --only firestore:indexes` — 複合インデックスデプロイ
- `firebase deploy --only storage` — Storage Rulesデプロイ

## デザインテーマ
- 白基調 + ブルーアクセント（CSS variables で一元管理、globals.css :root）
- bg-base: #f5f7fa / bg-card: #ffffff / bg-elevated: #1e3a5f（ネイビー）
- accent-char: #3b82f6（CTA） / accent-negi: #22c55e（成功） / accent-warn: #ef4444（警告）
- Tailwind では `bg-[color:var(--color-bg-base)]` 形式で参照

## 命名規則

| 対象 | ルール | 例 |
|---|---|---|
| コンポーネントファイル | PascalCase `.tsx` | `FadeImage.tsx`, `AdminAuthGuard.tsx`, `BackButton.tsx` |
| ユーティリティファイル | kebab-case `.ts`/`.tsx` | `admin-auth.ts`, `cart-context.tsx`, `analytics.ts` |
| Reactコンポーネント | PascalCase function | `MenuPage`, `FadeImage`, `AdminSidebar` |
| 関数（ユーティリティ） | camelCase | `loginWithEmail()`, `getAdminRole()`, `trackEvent()` |
| カスタムHooks | camelCase `use`プレフィックス | `useCart()`, `useAdminRole()`, `useToast()` |
| 定数 | SCREAMING_SNAKE_CASE | `TABLE_KEY`, `PIN_KEY` |
| 型定義 | PascalCase 単数形 | `Category`, `Order`, `OrderItem`, `AdminRole` |
| Props型 | PascalCase + `Props` | `FadeImageProps`, `BackButtonProps` |
| Firestoreコレクション | lowercase複数形 | `orders`, `menus`, `categories`, `admins` |
| Firestoreフィールド | camelCase | `tableNumber`, `isAvailable`, `isSoldOut`, `checkedItems` |
| localStorageキー | kebab-case `gonmura-`プレフィックス | `gonmura-table`, `gonmura-table-pin`, `gonmura-cart-{N}` |

## 注意事項
- .env.local は絶対にコミット・pushしないこと
- Firebaseを使うページには必ず "use client" をつける
- 全てのHooksは早期リターンより前に配置すること（Hooks順序エラー防止）
- Firestoreルールを一時的に緩和した場合は必ず元に戻すこと
- 画像はFirebase Storageに保存（外部URLは使わない）
- 数値フィールドは整数で管理（Math.trunc で正規化）
- 複合クエリ（status + createdAt等）にはインデックスが必要（firestore.indexes.json）
- cartKeyはテーブル番号ごとに分離（gonmura-cart-{N}）
- ラーメン/トッピングの判定はカテゴリ名ベース（「ラーメン」「トッピング」カテゴリ）
- 管理画面のサイドバーは h-[100dvh] + overflow-y-auto で固定
- middleware.ts で全ページの Cache-Control を no-store に設定（CDN キャッシュ問題対策）
- 顧客レイアウトに force-dynamic を設定（静的プリレンダリング防止）

## デプロイ
- Firebase App Hosting（main push で自動デプロイ）
- URL: https://gonmura-food-app--gonmura-food.asia-east1.hosted.app
- GitHub: https://github.com/kitagawa-create/gonmura-food-app
- ビルド後に `gcloud run services update-traffic --to-latest` でトラフィック切替が必要な場合あり
