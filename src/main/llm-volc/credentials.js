/**
 * @file credentials.js
 * @domain volc
 */
const { getResolvedApiKey, getResolvedModel } = require('../ipc/volc-user-config');

function resolveVolcCredentials() {
  let apiKey =
    process.env.VOLC_ARK_API_KEY ||
    process.env.ARK_API_KEY ||
    process.env.DOUBAO_API_KEY;
  if (apiKey) apiKey = String(apiKey).trim();
  if (!apiKey) apiKey = getResolvedApiKey();
  return {
    apiKey,
    model: getResolvedModel(),
  };
}

const MISSING_KEY_ERROR =
  '未配置 API 密钥。任选其一：① 项目根目录 .env 中 VOLC_ARK_API_KEY=密钥（勿留空）② 复制 config/secrets.example.json 为 config/secrets.json，填写 volcArkApiKey。③ 应用内用户配置（若已接入）。文件须 UTF-8。';

module.exports = { resolveVolcCredentials, MISSING_KEY_ERROR };
