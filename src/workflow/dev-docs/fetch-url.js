/**
 * @file fetch-url.js
 * 【功能】主进程拉取 URL 文本（开发文档导入）
 */
const http = require('http');
const https = require('https');

const MAX_BYTES = 2 * 1024 * 1024;

/**
 * @param {string} url
 * @param {{ allowInsecureTls?: boolean, timeoutMs?: number }} [opts]
 */
function fetchUrlText(url, opts = {}) {
  const raw = String(url || '').trim();
  if (!raw) return Promise.reject(new Error('缺少 URL'));
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return Promise.reject(new Error('URL 格式无效'));
  }
  if (!/^https?:$/i.test(parsed.protocol)) {
    return Promise.reject(new Error('仅支持 http / https 链接'));
  }

  const attempt = (allowInsecure) =>
    new Promise((resolve, reject) => {
      const lib = parsed.protocol === 'https:' ? https : http;
      const reqOpts = {
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: `${parsed.pathname}${parsed.search}`,
        method: 'GET',
        headers: {
          'User-Agent': 'Pecado-DevDocs/1.0',
          Accept: 'text/html,text/plain,application/xhtml+xml,*/*',
        },
        timeout: opts.timeoutMs || 20000,
        ...(parsed.protocol === 'https:' && allowInsecure ? { rejectUnauthorized: false } : {}),
      };

      const req = lib.request(reqOpts, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          try {
            const next = new URL(res.headers.location, raw).href;
            fetchUrlText(next, opts).then(resolve).catch(reject);
          } catch (e) {
            reject(new Error(`重定向无效：${res.headers.location}`));
          }
          res.resume();
          return;
        }
        if (!res.statusCode || res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode || '错误'}`));
          res.resume();
          return;
        }
        const chunks = [];
        let size = 0;
        res.on('data', (c) => {
          size += c.length;
          if (size > MAX_BYTES) {
            req.destroy();
            reject(new Error('页面过大（>2MB）'));
            return;
          }
          chunks.push(c);
        });
        res.on('end', () => {
          const ct = String(res.headers['content-type'] || '');
          const charset = /charset=([\w-]+)/i.exec(ct)?.[1] || 'utf-8';
          const buf = Buffer.concat(chunks);
          resolve({
            text: buf.toString(charset.toLowerCase() === 'gbk' ? 'utf8' : charset),
            contentType: ct,
            finalUrl: raw,
          });
        });
      });
      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('请求超时'));
      });
      req.end();
    });

  return attempt(Boolean(opts.allowInsecureTls)).catch((err) => {
    const msg = String(err?.message || err);
    if (/certificate|CERT|SSL|TLS|UNABLE_TO_VERIFY/i.test(msg) && !opts.allowInsecureTls) {
      return fetchUrlText(raw, { ...opts, allowInsecureTls: true });
    }
    throw err;
  });
}

module.exports = { fetchUrlText };
