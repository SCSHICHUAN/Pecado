/**
 * @file index.js
 * CodX UI 设计稿读取（Framelink / DesignImports）
 */
const { simplifyDesignBundle } = require('./simplify');
const { readDesignSummary, resolveDesignJsonPath } = require('./read-design-summary');
const {
  READ_DESIGN_SUMMARY_TOOL_NAME,
  isCodxUiToolName,
  getCodxUiTools,
  EXECUTE_codx_ui_tool,
  FEED_codx_ui_tool_result,
} = require('./tools');

module.exports = {
  simplifyDesignBundle,
  readDesignSummary,
  resolveDesignJsonPath,
  READ_DESIGN_SUMMARY_TOOL_NAME,
  isCodxUiToolName,
  getCodxUiTools,
  EXECUTE_codx_ui_tool,
  FEED_codx_ui_tool_result,
};
