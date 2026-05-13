#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

echo "正在启动 Hello Electron! 应用..."

export ELECTRON_MIRROR="${ELECTRON_MIRROR:-https://npmmirror.com/mirrors/electron/}"

if [ ! -d "node_modules" ]; then
  echo "未检测到依赖，正在安装..."
  npm install
fi

echo "启动应用..."
npm start
