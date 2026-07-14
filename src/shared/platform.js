/**
 * @file platform.js
 * 进程平台探测：跨平台功能 vs macOS-only（Xcode / 模拟器）
 */
const IS_DARWIN = process.platform === 'darwin';
const IS_WIN = process.platform === 'win32';
const IS_LINUX = process.platform === 'linux';

/** Xcode / simctl / qlmanage 等仅 macOS */
const HAS_XCODE = IS_DARWIN;

module.exports = {
  IS_DARWIN,
  IS_WIN,
  IS_LINUX,
  HAS_XCODE,
  platform: process.platform,
};
