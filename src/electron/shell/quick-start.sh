#!/usr/bin/env bash
# quick-start.sh — 安装依赖（若缺失）并 npm start
# 路径：src/electron/shell → 上溯三级到仓库根
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$ROOT"

echo "正在启动 Pecado..."

export ELECTRON_MIRROR="${ELECTRON_MIRROR:-https://npmmirror.com/mirrors/electron/}"

if [ ! -d "node_modules" ]; then
  echo "未检测到依赖，正在安装..."
  npm install
fi

echo "启动应用..."
npm start
