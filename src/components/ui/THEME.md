# 家系ラーメンテーマ ガイド (Window A 提供)

Window B (顧客側) と Window C (管理側) は、既存の `bg-black` / `text-white` /
`bg-neutral-900` 等の直書きクラスを以下のトークンに置換すること。

## CSS variables (src/app/globals.css の :root に定義)

| 用途 | variable | 値 |
| --- | --- | --- |
| ページ背景 (顧客側ベース) | `--color-bg-base` | `#faf6ed` 生成り |
| カード/モーダル背景 | `--color-bg-card` | `#ffffff` |
| ヘッダー/サイドバー背景 | `--color-bg-elevated` | `#2e1a0f` 濃醤油 (白文字想定) |
| 控えめ区画背景 | `--color-bg-subtle` | `#f3ece0` |
| 本文 | `--color-text-primary` | `#2e1a0f` |
| 補助文 | `--color-text-muted` | `#6b5648` |
| elevated 上の文字 | `--color-text-on-dark` | `#faf6ed` |
| 醤油 (主要アクション) | `--color-accent-soy` | `#5a3a28` |
| チャーシュー (CTA) | `--color-accent-char` | `#c8633a` |
| チャーシュー hover | `--color-accent-char-hover` | `#b15630` |
| ネギ緑 (成功・在庫) | `--color-accent-negi` | `#7b9d3a` |
| 唐辛子赤 (警告) | `--color-accent-warn` | `#c8311e` |
| 境界線 | `--color-border` | `#e5dace` |
| 強い境界線 | `--color-border-strong` | `#c9b8a3` |

## 使い方 (推奨は Tailwind arbitrary value 形式)

```tsx
<div className="bg-[color:var(--color-bg-base)] text-[color:var(--color-text-primary)]">
<button className="bg-[color:var(--color-accent-char)] hover:bg-[color:var(--color-accent-char-hover)] text-white">
<aside className="bg-[color:var(--color-bg-elevated)] text-[color:var(--color-text-on-dark)]">
```

Tailwind 4 の `@theme inline` で alias 済みのため、短縮形でも書けるが**読みづらい**ので
arbitrary value 形式 (例: `bg-[color:var(--color-bg-base)]`) を統一推奨。

## 旧クラス → 新クラス対応表

| 旧 (削除対象) | 新 (推奨) | コメント |
| --- | --- | --- |
| `bg-black` / `bg-neutral-900` / `bg-neutral-950` | `bg-[color:var(--color-bg-base)]` (顧客側) または `bg-[color:var(--color-bg-elevated)]` (サイドバー等) | 用途で使い分け |
| `bg-neutral-800` (カード) | `bg-[color:var(--color-bg-card)]` | |
| `text-white` (本文) | `text-[color:var(--color-text-primary)]` (ライト背景上) または `text-[color:var(--color-text-on-dark)]` (elevated 上) | |
| `text-neutral-400` / `text-gray-400` | `text-[color:var(--color-text-muted)]` | |
| `border-orange-500` | `border-[color:var(--color-accent-char)]` | |
| `bg-orange-500` (CTA) | `bg-[color:var(--color-accent-char)]` | |
| `text-orange-500` | `text-[color:var(--color-accent-char)]` | |
| `border-neutral-700` / `border-neutral-800` | `border-[color:var(--color-border)]` | |
| `bg-red-500` (警告) | `bg-[color:var(--color-accent-warn)]` | |
| `bg-green-500` (成功) | `bg-[color:var(--color-accent-negi)]` | |

## 共通コンポーネント

- `<BackButton href="..." label="..." variant?="light"|"dark" />`
  - 最小タップ領域 44x44px、href 必須 (router.back() は禁止)
  - `variant="dark"` は elevated 背景上で使う (例: 管理画面ヘッダー)
- `<Card variant?="default"|"subtle"|"elevated" padding?="none"|"sm"|"md"|"lg" />`
  - 既存の手書きカード div を順次これに置換可能 (任意、必須ではない)
- `<ToastProvider>` + `useToast()` (Snackbar)
  - 管理画面の保存/更新/削除通知専用 (顧客側では使わない方針)
  - 右下固定、3 秒自動消去、最新 1 件のみ (同時表示なし)
  - 配色: `bg-[color:var(--color-bg-elevated)]` + `text-[color:var(--color-text-on-dark)]` 固定
  - 配線手順:
    1. 管理レイアウト (例: `src/app/admin/layout.tsx`) を `<ToastProvider>` で囲む
    2. 通知を出したいページで `const { show } = useToast()` → `show("保存しました")` 等
  - ※ `<ToastProvider>` は必ず `"use client"` 境界の内側に置く (`AdminAuthGuard` 配下でも OK)

## 既存コンポーネントの色追従について

`FullScreenLoader` / `PageLoader` / `FadeImage` / `Skeleton` は Window A の責務外。
必要に応じて Window B/C 側で利用箇所単位に呼び出し側でラップするか、別途課題として
切り出す。Window A はファイルを編集しない。

## 確認事項

- WCAG AA: text-primary on bg-base ≒ 14:1 (AAA)、text-muted on bg-base ≒ 5.5:1 (AA)
- ダークモード非対応: `prefers-color-scheme: dark` メディアクエリは無視するため、
  該当 CSS は既存定義を残しているが利用ページは事実上ライトのみ。
