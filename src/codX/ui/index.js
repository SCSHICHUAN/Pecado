/**
 * @file index.js
 * CodX UI 设计稿读取（Framelink / DesignImports）
 */
const { compressFigmaBundle, hasCompressed } = require('./compress-figma');
const { readUiLayer } = require('./read-ui-layer');
const {
  READ_UI_LAYER_TOOL_NAME,
  isCodxUiToolName,
  getCodxUiTools,
  EXECUTE_codx_ui_tool,
  FEED_codx_ui_tool_result,
} = require('./tools');

module.exports = {
  compressFigmaBundle,
  hasCompressed,
  readUiLayer,
  READ_UI_LAYER_TOOL_NAME,
  isCodxUiToolName,
  getCodxUiTools,
  EXECUTE_codx_ui_tool,
  FEED_codx_ui_tool_result,
};
