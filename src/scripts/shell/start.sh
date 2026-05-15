#!/usr/bin/env bash
# start.sh
# - 切换到仓库根（与 quick-start 相同 ROOT 计算）。
# - 不安装依赖，直接 npm start；适合已 npm install 过的环境。
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$ROOT"
export ELECTRON_MIRROR="${ELECTRON_MIRROR:-https://npmmirror.com/mirrors/electron/}"
npm start
