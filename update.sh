#!/usr/bin/env bash
#
# 一键更新点位数据：抓原站首页 → 对比 → 补抓详情/评论 → 通知服务热重载
#
# 用法：
#   ./update.sh              # 完整更新
#   ./update.sh --dry-run    # 只对比并报告变更，不写任何文件
#
# 环境变量：
#   PYTHON      python 解释器，默认 python
#   BASE_URL    服务地址，默认 http://127.0.0.1:8080
#   ADMIN_TOKEN 管理接口令牌；未设置时会尝试从 .env 读取
#
# 数据更新不需要重新构建镜像、也不需要重启容器——
# data/ 目录挂进了容器，改完文件调一次热重载接口即可生效。

set -uo pipefail
cd "$(dirname "$0")"

PYTHON="${PYTHON:-python}"
BASE_URL="${BASE_URL:-http://127.0.0.1:8080}"

DRY=0
for a in "$@"; do
  [ "$a" = "--dry-run" ] && DRY=1
done

# 从 .env 里取 ADMIN_TOKEN（如果环境里没有的话）
if [ -z "${ADMIN_TOKEN:-}" ] && [ -f .env ]; then
  ADMIN_TOKEN="$(grep -E '^ADMIN_TOKEN=' .env | head -1 | cut -d= -f2- | tr -d '"'"'"' \r')"
fi

echo "==> [1/4] 更新点位数据"
"$PYTHON" update_points.py "$@" || exit 1

if [ "$DRY" = "1" ]; then
  echo
  echo "（--dry-run：跳过补抓与热重载）"
  exit 0
fi

echo
echo "==> [2/4] 补抓详情页（已有 id 会自动跳过，只抓新增点位）"
"$PYTHON" fetch_details.py

echo
echo "==> [3/4] 补抓车主评论（同上，只抓新增点位）"
"$PYTHON" fetch_comments.py

echo
echo "==> [4/4] 通知服务重新加载数据"
HDR=()
[ -n "${ADMIN_TOKEN:-}" ] && HDR=(-H "X-Admin-Token: ${ADMIN_TOKEN}")

if RESP="$(curl -fsS --max-time 30 "${HDR[@]}" -X POST "${BASE_URL}/api/admin/reload" 2>&1)"; then
  echo "  ${RESP}"
  echo
  echo "✔ 已生效，无需重启"
else
  echo "⚠ 调用失败：${RESP}"
  echo "  常见原因：服务没启动；或未设置 ADMIN_TOKEN（默认只允许容器内调用）。"
  echo "  数据已经写好，服务下次启动时会自动加载。"
fi
