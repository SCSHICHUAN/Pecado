#!/usr/bin/env bash
# quick-start.sh
# - 解析自身路径得到仓库根（src/scripts/shell → 上溯三级）。
# - 可选：无 node_modules 时执行 npm install。
# - 设置默认 ELECTRON_MIRROR（国内镜像），再 npm start。
# 与 package.json 中 "start:shell" 对应。
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$ROOT"

echo "正在启动 Hello Electron! 应用..."

export ELECTRON_MIRROR="${ELECTRON_MIRROR:-https://npmmirror.com/mirrors/electron/}"

if [ ! -d "node_modules" ]; then
  echo "未检测到依赖，正在安装..."
  npm install
fi

echo "启动应用..."
npm start
