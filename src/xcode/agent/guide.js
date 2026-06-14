/**
 * @file guide.js
 * 【功能】注入 Agent system 的 Pecado Xcode 能力说明
 */

const XCODE_AGENT_GUIDE =
  '【Pecado Xcode 工程】File → Open Folder 须为含 .xcodeproj/.xcworkspace 的 iOS/macOS 应用工程根目录；' +
  '@ ios-simulator-skill 仅提供模拟器脚本与文档，不会自动编译 Open Folder 工程。' +
  '编译/在模拟器看最新代码：用 xcode_run（xcodebuild + simctl 安装启动）；默认跟随 Xcode Run 目标 / Simulator 当前设备，也可用 simulator 参数指定。仅验证编译用 xcode_build。' +
  '典型流程（@ ios-simulator-skill + 跑模拟器）：① run_skill_resource_script sim_health_check.sh → ② xcode_build → ③ xcode_run；' +
  '或 xcode_run 一步完成编译+simctl 安装+模拟器启动。app_launcher.py 仅启动已安装包，改代码后须 xcode_run（勿只 xcode_build）。' +
  'PDF/文档等非 iOS 任务勿调 xcode_*。';

module.exports = { XCODE_AGENT_GUIDE };
