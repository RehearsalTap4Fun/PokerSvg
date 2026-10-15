#!/usr/bin/env bash
# 部署到与饮食日记、叠叠中国、同路同一台服务器：跑测试 → 构建 → rsync dist/ → 回读远端确认
# 变量写在 .deploy.env（已 gitignore）：POKER_SSH / POKER_PATH / POKER_URL
# nginx 的 /poker/ 规则见 scripts/nginx-poker.inc（一次性粘进服务器 nutri-site.inc）
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f .deploy.env ] && set -a && . ./.deploy.env && set +a
: "${POKER_SSH:?需要 POKER_SSH，例如 admin@1.2.3.4}"
: "${POKER_PATH:=/var/www/poker}"

echo "▶ 测试"
npm test --silent >/dev/null
echo "▶ 构建（web 版：单文件页面 + manifest/图标/service worker）"
npm run build:web >/dev/null
echo "▶ 同步到 $POKER_SSH:$POKER_PATH"
ssh "$POKER_SSH" "mkdir -p '$POKER_PATH'"
rsync -az --delete dist-web/ "$POKER_SSH:$POKER_PATH/"
echo "✓ 已同步"
if [ -n "${POKER_URL:-}" ]; then
  code=$(curl -s -o /dev/null -w '%{http_code}' -m 8 "$POKER_URL/")
  echo "▶ 远端 $POKER_URL/ → HTTP $code"
fi
