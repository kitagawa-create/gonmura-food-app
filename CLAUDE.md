@AGENTS.md

# Gonmura Food - モバイルオーダーシステム

## プロジェクト概要
家系ラーメン店「権村家」のテーブル据え置きタブレット向けモバイルオーダー＆管理画面。
Next.js 16 + Firebase (Firestore / Auth / Storage / Analytics) + Sentry で構築。

## 技術スタック
- Next.js 16 App Router + TypeScript + Tailwind CSS
- Firebase: Firestore, Auth (メール/パスワード), Storage, Analytics
- Sentry: エラー監視
- Firebase App Hosting: デプロイ

## ディレクトリ構造
```
src/
├── app/
│   ├── (customer)/          # お客様側（テーブルタブレット）
│   │   ├── bill/            # お会計伝票
│   │   ├── cart/            # カート
│   │   ├── menu/            # メニュー一覧（カテゴリタブ）
│   │   ├── order/           # 注文送信
│   │   │   ├── [orderId]/   # 注文ステータス（リアルタイム）
│   │   │   └── history/     # テーブル注文履歴
│   │   ├── setup/           # テーブル初期設定（PIN認証）
│   │   └── layout.tsx       # CartProvider + AnalyticsProvider
│   ├── admin/               # 管理側（PCブラウザ）
│   │   ├── categories/      # カテゴリ管理
│   │   ├── login/           # 管理者ログイン
│   │   ├── menus/           # メニューCRUD（画像アップロード）
│   │   ├── orders/          # 注文管理（リアルタイム・通知音）
│   │   ├── register/        # レジ（精算・精算済み一覧）
│   │   ├── sales/           # 売上分析（日週月別・ABC・ピーク時間帯・カテゴリ別）
│   │   └── layout.tsx       # AdminAuthGuard + Sidebar
│   ├── global-error.tsx     # Sentry エラーページ
│   ├── layout.tsx           # ルートレイアウト（lang="ja"）
│   └── page.tsx             # / → /menu へリダイレクト
├── components/
│   ├── admin/
│   │   ├── AdminAuthGuard.tsx   # 管理者認証ガード
│   │   └── AdminSidebar.tsx     # サイドバーナビ
│   └── customer/
│       └── AnalyticsProvider.tsx # Analytics 初期化
├── lib/
│   ├── admin-auth.ts        # loginWithEmail, logout, isAdminUser, subscribeAuth
│   ├── analytics.ts         # trackEvent (logEvent wrapper)
│   ├── cart-context.tsx     # CartProvider (localStorage永続化、テーブルごと分離)
│   └── firebase.ts          # db, auth, storage をexport
└── types/
    └── index.ts             # Category, Menu, Order, OrderItem, Admin, CartItem
```

## Firestore コレクション
- `categories` - カテゴリ（name, sortOrder）
- `menus` - メニュー（name, description, price, categoryIds[], imageUrl, isAvailable）
- `orders` - 注文（items[{menuId, name, price, quantity}], status, tableNumber, customerNote）
- `admins` - 管理者（email, role）。Firebase Auth の uid がドキュメントID

## 重要な設計判断
- orders.items に name, price をスナップショットとして複製する（メニュー変更が過去注文に影響しない）
- メニューは物理削除しない。isAvailable: false で非表示にする（過去注文の参照が切れない）
- categoryIds は配列で複数カテゴリに所属可能
- カートは localStorage に保存。キーは `gonmura-cart-{tableNumber}` でテーブルごとに分離
- 支払い（status を "paid" に変更）は管理者のみ実行可能（Security Rules で制限）
- テーブル番号はPIN認証で設定、localStorage に保持

## Security Rules
- categories: 誰でも読める、管理者のみ書ける
- menus: 誰でも読める、管理者のみ書ける
- orders: 誰でも作成・読める、更新は管理者のみ
- admins: 自分の uid のドキュメントのみ読める
- storage menus/: 誰でも読める、認証済みユーザーのみ書ける

## コマンド
- `npm run dev` - 開発サーバー起動
- `npm run build` - ビルド
- `npx tsc --noEmit` - 型チェック
- `firebase deploy --only firestore:rules` - Firestore Rules デプロイ
- `firebase deploy --only storage` - Storage Rules デプロイ

## 注意事項
- .env.local は絶対にコミット・push しないこと
- Firebaseを使うページには必ず "use client" をつける
- 全ての Hooks は早期リターンより前に配置すること（Hooks順序エラー防止）
- Firestore ルールを一時的に緩和した場合は必ず元に戻すこと
- 画像は Firebase Storage に保存（外部URLは使わない）
- 数値フィールドは整数で管理（Math.trunc で正規化）

## デプロイ
- Firebase App Hosting（main ブランチ push で自動デプロイ）
- URL: https://gonmura-food-app--gonmura-food.asia-east1.hosted.app
- GitHub: https://github.com/kitagawa-create/gonmura-food-app
