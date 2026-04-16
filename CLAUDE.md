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
├── app/
│   ├── (customer)/              # お客様側（テーブルタブレット）
│   │   ├── layout.tsx           # CartProvider + AnalyticsProvider
│   │   ├── setup/page.tsx       # テーブル番号入力
│   │   ├── menu/page.tsx        # メニュー一覧（カテゴリタブ、商品モーダル、テーブル番号変更モーダル）
│   │   ├── order/page.tsx       # 注文確認・数量編集・送信
│   │   ├── order/[orderId]/     # 注文ステータス（onSnapshotリアルタイム）
│   │   ├── order/history/       # テーブル注文履歴（paid除外）
│   │   └── bill/page.tsx        # お会計伝票（未精算注文をまとめ表示）
│   ├── admin/                   # 管理側（iPad / PC）
│   │   ├── layout.tsx           # AdminAuthGuard + AdminSidebar（loginは除外）
│   │   ├── login/page.tsx       # メール/パスワードログイン
│   │   ├── orders/page.tsx      # 注文カンバン（3カラム、通知音、経過時刻、5分超え赤ハイライト、逆行可、取消は deleteDoc）
│   │   ├── register/page.tsx    # レジ（未精算/精算済みタブ、売上ドーナツ円グラフ、目標達成率）
│   │   ├── sales/page.tsx       # 売上分析（owner のみ。KPI + 売上推移/メニュー別売数/価格変更前後比較）
│   │   ├── menus/page.tsx       # メニューCRUD（owner: 全機能 / staff: 公開トグルのみ）
│   │   └── categories/page.tsx  # カテゴリ管理（owner のみ）
│   ├── global-error.tsx         # Sentryエラーキャッチ画面
│   ├── layout.tsx               # ルートレイアウト（lang="ja"）
│   └── page.tsx                 # / → /menu クライアントリダイレクト
├── components/
│   ├── admin/
│   │   ├── AdminAuthGuard.tsx   # 認証ガード + role 取得 → AdminProvider で配下に提供
│   │   ├── AdminContext.tsx     # AdminProvider / useAdminRole フック
│   │   ├── AdminSidebar.tsx     # サイドバーナビ（staff は sales/categories を非表示）
│   │   └── ConfirmDialog.tsx    # 確認ダイアログ（画面中央モーダル、赤/緑ボタン）
│   ├── customer/
│   │   └── AnalyticsProvider.tsx # Firebase Analytics初期化（page_viewイベント）
│   └── ui/
│       ├── FadeImage.tsx        # 画像ローディング（スケルトン → フェードイン）
│       ├── FullScreenLoader.tsx # 全画面ローディング（お客様側用）
│       ├── PageLoader.tsx       # コンテンツ部分ローディングスピナー（管理側、サイドバー残す）
│       └── Skeleton.tsx         # 各種スケルトンコンポーネント
├── lib/
│   ├── firebase.ts              # Firebase初期化（db, auth, storage export、measurementId含む）
│   ├── cart-context.tsx          # CartProvider（localStorage永続化、テーブルごとカート分離、数量指定addItem）
│   ├── admin-auth.ts            # loginWithEmail, logout, getAdminRole, subscribeAuth
│   └── analytics.ts             # trackEvent（Firebase Analytics logEvent wrapper）
└── types/
    └── index.ts                 # Category, Menu, Order, OrderItem, OrderStatus, AdminRole, Admin, CartItem
```

## 型定義 (src/types/index.ts)
```
Category    { id, name, sortOrder: number, createdAt, updatedAt }
Menu        { id, name, description, price: number, categoryIds: string[], imageUrl, isAvailable, sortOrder?: number, createdAt, updatedAt }
OrderItem   { menuId, name, price: number, quantity: number }  ← 注文時スナップショット
OrderStatus "pending" | "preparing" | "completed" | "paid"
AdminRole   "owner" | "staff"
Order       { id, items: OrderItem[], status: OrderStatus, tableNumber: number, customerNote, createdAt, updatedAt }
Admin       { uid, email, role, createdAt, updatedAt }
CartItem    { menuId, name, price: number, quantity: number }  ← localStorage保存、Firestore不使用
```

## Firestore コレクション
- `categories/{categoryId}` → Category型。name, sortOrder（DnDで変更）
- `menus/{menuId}` → Menu型。price整数, categoryIds配列, isAvailableで品切れ制御, sortOrder?でDnD並び替え
- `orders/{orderId}` → Order型。items配列にスナップショット, statusで遷移管理
- `admins/{uid}` → Admin型。Firebase Auth uidがドキュメントID

## ステータス遷移
```
pending → preparing → completed → paid（正常フロー）
preparing → pending（逆行可、誤操作対応）
completed → preparing（逆行可）
取消は deleteDoc でドキュメント削除（ConfirmDialogで確認）
paid への変更は管理者のみ（Security Rules）
```

## Security Rules (firestore.rules)
- categories: 誰でも読める、owner のみ書ける
- menus: 誰でも読める / create・delete は owner / update は owner、staff は isAvailable のみ可
- orders: 誰でも作成・読める、更新・削除は staff 以上（owner も可）
- admins: 自分のuidのドキュメントのみ読める
- storage menus/: 誰でも読める、認証済みユーザーのみ書ける
- 管理者ロールは admins/{uid}.role: "owner" | "staff"。role 未設定は staff 扱い

## localStorage キー
- `gonmura-table` — テーブル番号（/setup で設定）
- `gonmura-cart-{N}` — テーブルNのカート（精算時にクリア）
- `gonmura-sales-goal` — 本日売上目標（管理画面で編集、default ¥100,000）

## コマンド
- `npm run dev` — 開発サーバー起動
- `npm run build` — 本番ビルド
- `npx tsc --noEmit` — TypeScript型チェック
- `firebase deploy --only firestore:rules` — Firestore Rulesデプロイ
- `firebase deploy --only firestore:indexes` — 複合インデックスデプロイ
- `firebase deploy --only storage` — Storage Rulesデプロイ

## 命名規則

| 対象 | ルール | 例 |
|---|---|---|
| コンポーネントファイル | PascalCase `.tsx` | `FadeImage.tsx`, `AdminAuthGuard.tsx`, `ConfirmDialog.tsx` |
| ユーティリティファイル | kebab-case `.ts`/`.tsx` | `admin-auth.ts`, `cart-context.tsx`, `analytics.ts` |
| Reactコンポーネント | PascalCase function | `MenuPage`, `FadeImage`, `AdminSidebar` |
| 関数（ユーティリティ） | camelCase | `loginWithEmail()`, `getAdminRole()`, `trackEvent()` |
| カスタムHooks | camelCase `use`プレフィックス | `useCart()`, `useAdminRole()` |
| 定数 | SCREAMING_SNAKE_CASE | `TABLE_KEY`, `COLUMNS` |
| 型定義 | PascalCase 単数形 | `Category`, `Order`, `OrderItem`, `AdminRole` |
| Props型 | PascalCase + `Props` | `FadeImageProps` |
| Firestoreコレクション | lowercase複数形 | `orders`, `menus`, `categories`, `admins` |
| Firestoreフィールド | camelCase | `tableNumber`, `isAvailable`, `categoryIds`, `createdAt` |
| localStorageキー | kebab-case `gonmura-`プレフィックス | `gonmura-table`, `gonmura-cart-{N}` |

## 注意事項
- .env.local は絶対にコミット・pushしないこと
- Firebaseを使うページには必ず "use client" をつける
- 全てのHooksは早期リターンより前に配置すること（Hooks順序エラー防止）
- Firestoreルールを一時的に緩和した場合は必ず元に戻すこと
- 画像はFirebase Storageに保存（外部URLは使わない）
- 数値フィールドは整数で管理（Math.trunc で正規化）
- 複合クエリ（status + createdAt等）にはインデックスが必要（firestore.indexes.json）
- cartKeyはテーブル番号ごとに分離（gonmura-cart-{N}）
- ダークテーマ統一（neutral-900/950ベース + orange-500アクセント）

## デプロイ
- Firebase App Hosting（main push で自動デプロイ）
- URL: https://gonmura-food-app--gonmura-food.asia-east1.hosted.app
- GitHub: https://github.com/kitagawa-create/gonmura-food-app
