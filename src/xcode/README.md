# Xcode 模块

macOS 专用：工程发现、pbxproj 集成、流式写盘、Agent 编译/运行工具。

与 **ios-simulator-skill** 分工：Pecado `xcode_build` / `xcode_run` 针对 **Open Folder** 工程编译最新代码；Skill 脚本负责模拟器健康检查、UI 导航、日志等。

## 目录

```
src/xcode/
  project.js        发现 .xcodeproj/.xcworkspace、pbxproj 增删、scheme 查询
  build-runner.js   xcodebuild 构建/测试、simctl 安装启动、Run 缓存与加速
  stream.js         LLM 流式写入源码文件（Xcode 实时刷新）
  paths.js          用户输入 @path、流式写目标解析
  prompt.js         新建文件/目录时「加入 Xcode 工程」对话框
  agent/
    tools.js        xcode_* 工具定义 + 执行
```

## Agent 工具

| 工具 | 作用 |
|------|------|
| `xcode_project_status` | 读取 scheme、工程路径 |
| `xcode_build` | `xcodebuild` 编译 Open Folder 工程 |
| `xcode_run` | `xcodebuild` 编译 + `simctl install/launch` + 运行检测 |
| `xcode_test` | `xcodebuild test` |

## xcode_run 流程

1. 解析 scheme（缓存于 `.pecado/xcode-cache.json`）
2. 选择模拟器（Xcode Run 目标 / 已 Boot 设备 / Simulator 当前设备）
3. 无源码变更时跳过 `xcodebuild`，直接 `simctl launch`
4. 需编译时：`xcodebuild` → 解析 `.app` → `simctl install` → `simctl launch`

入口：`build-runner.js` 的 `runXcodeProject` → `runViaSimctl`。

## 编译加速（build-runner.js）

| 策略 | 说明 |
|------|------|
| 跳过编译 | 比对 `.app` 签名与 `lastSourceMtime`，无变更则不跑 xcodebuild |
| 跳过安装 | 同一 UDID + bundleId + `.app` 签名未变则只 launch |
| DerivedData 复用 | `-derivedDataPath` 指向已有缓存 |
| 模拟器 xcconfig | `.pecado/simulator-run.xcconfig` 关闭 Portal 签名、Index Store 等 |
| generic destination | `generic/platform=iOS Simulator,arch=arm64` 减少切片 |
| 并行 | 编译期间 boot 模拟器；流式检测到 `.app` 后提前 install+launch |
| 直调 | 输入 `xcode_run` / `运行` / 底栏 ▶ 跳过 LLM |

缓存目录：`<工程>/.pecado/xcode-cache.json`、`.pecado/simulator-run.xcconfig`。

## 与 ios-simulator-skill 联用

1. `run_skill_resource_script` → `scripts/sim_health_check.sh`
2. `xcode_build` → 编译 Open Folder 下最新代码
3. `xcode_run` → 安装并在模拟器启动（或一步代替 2+3）

`app_launcher.py --launch` 只启动已安装包，改代码后须先 `xcode_build` / `xcode_run`。

## 调用方

| 模块 | 用途 |
|------|------|
| `mcp-filesystem/tool-executor.js` | 新建文件确认、集成 pbxproj |
| `agent-loop/app-agent-loop.js` | Xcode Agent tools、直调 xcode_run |
| `pecado/js/index.js` | 底栏 ▶ 快捷 xcode_run |
| `llm-server` + `stream-hooks.js` | INFER 增量落盘 |
