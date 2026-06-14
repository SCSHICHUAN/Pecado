/**
 * @file guide.js
 * 【功能】注入 Agent system 的 Pecado Xcode 能力说明
 */

const XCODE_AGENT_GUIDE =
  '【Pecado Xcode 工程】Open Folder 目录若含 .xcodeproj，仅在与 iOS 工程/scheme/编译相关时可选 xcode_project_status；' +
  'PDF、文档生成等任务勿调用该工具，应走对应 Skill。' +
  'iOS 编译/模拟器 run 无内置工具，按 Skill Instructions 用 run_skill_resource_script。';

module.exports = { XCODE_AGENT_GUIDE };
