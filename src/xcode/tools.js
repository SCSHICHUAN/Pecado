/**
 * @file tools.js
 *
 * 【功能】Agent 可用的 Xcode 工具定义（合并进 LLM tools 列表）。
 */
const { IS_DARWIN } = require('./project');

const XCODE_TOOL_NAMES = new Set([
  'xcode_project_status',
  'xcode_build',
  'xcode_run',
  'xcode_test',
]);

/** @returns {Array<{ name: string, description: string, inputSchema: object }>} */
function getXcodeTools() {
  if (!IS_DARWIN) return [];

  return [
    {
      name: 'xcode_project_status',
      description:
        '读取当前打开的 Xcode 工程信息：workspace/project 路径、可用 scheme、建议的 build destination。在构建前可先调用以确认工程结构。',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'xcode_build',
      description:
        '使用 xcodebuild 编译 Xcode 工程，返回编译错误/警告与日志尾部。修改 Swift/ObjC 代码后应调用以检查是否能通过编译。',
      inputSchema: {
        type: 'object',
        properties: {
          scheme: {
            type: 'string',
            description: '可选。Xcode scheme 名；省略时使用第一个可用 scheme。',
          },
          destination: {
            type: 'string',
            description:
              '可选。xcodebuild -destination，默认 generic/platform=iOS Simulator。macOS 应用可用 platform=macOS。',
          },
        },
      },
    },
    {
      name: 'xcode_run',
      description:
        '等同 Xcode 的 Run（⌘R / 播放按钮）：打开 Xcode 并触发 run，使用 Xcode 当前 scheme 与 Run destination；等待构建完成后读取模拟器运行日志。AppleScript 失败时回退为 xcodebuild+simctl。',
      inputSchema: {
        type: 'object',
        properties: {
          scheme: { type: 'string', description: '可选 scheme 名' },
          destination: {
            type: 'string',
            description:
              '可选 destination。iOS 模拟器可省略（自动选择 iPhone）；macOS 应用用 platform=macOS。',
          },
          simulator: {
            type: 'string',
            description: '可选模拟器设备名，如 iPhone 16',
          },
        },
      },
    },
    {
      name: 'xcode_test',
      description:
        '使用 xcodebuild test 运行单元/UI 测试，返回失败用例与构建日志。用于验证项目是否正常运行。',
      inputSchema: {
        type: 'object',
        properties: {
          scheme: { type: 'string', description: '可选 scheme 名' },
          destination: {
            type: 'string',
            description: '可选 destination，默认 generic/platform=iOS Simulator',
          },
        },
      },
    },
  ];
}

function isXcodeToolName(name) {
  return XCODE_TOOL_NAMES.has(String(name || '').trim());
}

module.exports = { getXcodeTools, isXcodeToolName, XCODE_TOOL_NAMES };
