@AGENTS.md

# Gonmura Food - モバイルオーダーシステム

## プロジェクト概要
家系ラーメン店のテーブル据え置きタブレット向けモバイルオーダー＆管理画面。
Next.js 16 + Firebase (Firestore / Auth / Storage) で構築。

## 技術スタック
- Next.js 16 App Router + TypeScript + Tailwind CSS
- Firebase: Firestore, Auth (メール/パスワード), Storage
- Sentry: エラー監視
- Firebase Analytics: ユーザー行動計測

## ディレクトリ構造
- `src/app/(customer)/` - お客様側ページ（menu, cart, order, bill, setup）
- `src/app/admin/` - 管理画面（orders, menus, categories, register, login）
- `src/lib/firebase.ts` - Firebase初期化（db, auth, storage をexport）
- `src/lib/cart-context.tsx` - カート状態管理（localStorage永続化、テーブルごとに分離）
- `src/lib/analytics.ts` - Firebase Analytics ヘルパー
- `src/lib/admin-auth.ts` - 管理者認証ヘルパー
- `src/types/index.ts` - 全型定義

## Firestore コレクション
- `categories` - カテゴリ（name, sortOrder）
- `menus` - メニュー（name, price, categoryIds[], isAvailable, imageUrl）
- `orders` - 注文（items[], status, tableNumber, customerNote）
- `admins` - 管理者（email, role）。uidがドキュメントID

## 重要な設計判断
- orders.items に name, price をスナップショットとして複製する（メニュー変更の影響を防ぐ）
- メニューは物理削除しない。isAvailable: false で非表示にする
- カートは localStorage に保存。キーは `gonmura-cart-{tableNumber}` でテーブルごとに分離
- 支払い（status を "paid" に変更）は管理者のみ実行可能（Security Rules で制限）

## コマンド
- `npm run dev` - 開発サーバー起動
- `npm run build` - ビルド
- `npx tsc --noEmit` - 型チェック
- `firebase deploy --only firestore:rules` - Security Rules デプロイ
- `firebase deploy --only storage` - Storage Rules デプロイ

## 注意事項
- .env.local は絶対にコミット・pushしないこと
- firebase.ts はサーバーコンポーネントから直接importしない（SSRエラーの原因）
- Firebaseを使うページには必ず "use client" をつける
- 全てのHooksは早期リターンより前に配置すること（Hooks順序エラー防止）
