#!/bin/bash
set -euo pipefail

cat <<'EOF'
scripts/seed.sh は旧 Firestore スキーマ向けのため廃止しました。

このリポジトリの現行スキーマ:
- customers.isPaid で精算状態を管理
- orders.status は pending / completed のみ
- items は旧ネスト明細ではなく、setId でメイン/サイドを関連付けるフラット構造

現行の seed は次を使ってください。
- node scripts/seed.mjs
- node scripts/seed-orders.mjs
- node scripts/seed_500.mjs
EOF

exit 1
