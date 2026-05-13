# Hello Electron!

一个简单的 Electron 应用程序（Pecado AI 界面）。

## 项目结构

```
firstElectron/
├── assets/icons/          # 打包用图标等资源
├── config/                # electron-builder 等构建配置
├── scripts/
│   ├── electron/          # 本地调试用的 Electron 小脚本
│   └── shell/             # 命令行快速启动脚本
├── src/                   # 全部应用源码
│   ├── main/              # 主进程：main.js、ipc/（按功能的 IPC，如 qq-music.js）
│   ├── preload/           # preload.js（暴露 electronAPI，与 shared 通道名对齐）
│   ├── shared/            # 主进程与 preload 共用（如 ipc-channels.js）
│   └── renderer/          # app.html、app.css、chat.js、volc-chat.js、command-handlers.js
├── release/               # electron-builder 输出目录（npm run build）
├── package.json
└── README.md
```

## 安装依赖

```bash
npm install
```

如需国内镜像，可在环境变量中设置 `ELECTRON_MIRROR`（参见 `package.json` 的 `config` 字段），或使用 `npm config set electron_mirror ...`。

## 运行应用

```bash
npm start
```

或使用 shell 脚本（从仓库根目录执行）：

```bash
chmod +x scripts/shell/start.sh scripts/shell/quick-start.sh
./scripts/shell/quick-start.sh
```

## 开发

- 编辑 `src/renderer/app.html`、`app.css`、`chat.js`、`volc-chat.js`、`command-handlers.js` 修改界面与对话
- 豆包 bots：① `npm run env:init` 后编辑根目录 `.env` 填 `VOLC_ARK_API_KEY`（勿留空行值）② 或复制 `config/secrets.example.json` 为 `config/secrets.json` 填 `volcArkApiKey`。发消息前会重新加载环境文件；终端见 `[env]` 日志
- 编辑 `src/main/main.js`（窗口与生命周期）、`src/main/ipc/`（主进程 IPC 实现）
- 编辑 `src/preload/preload.js`（向页面暴露的安全 API）、`src/shared/ipc-channels.js`（通道名常量）

## 构建打包

```bash
npm run build
```

产物在 `release/` 目录。

## 技术栈

- **Electron**: 见 `package.json` 中 `devDependencies`
- **HTML / CSS / JavaScript**
