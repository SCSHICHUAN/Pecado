/**
 * @file syntax-check.js
 * CodX 编辑时语法检查（Swift / ObjC / C / C++ 等）
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);
const ISSUE_RE = /:(\d+):(\d+):\s*(error|warning):\s*(.+)$/i;

/**
 * @param {string} text
 * @returns {Array<{ line: number, column: number, severity: 'error'|'warning', message: string }>}
 */
function parseCompilerIssues(text) {
  /** @type {Array<{ line: number, column: number, severity: 'error'|'warning', message: string }>} */
  const issues = [];
  const seen = new Set();
  for (const rawLine of String(text || '').split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    const m = line.match(ISSUE_RE);
    if (!m) continue;
    const item = {
      line: Number(m[1]),
      column: Number(m[2]),
      severity: m[3].toLowerCase() === 'warning' ? 'warning' : 'error',
      message: m[4].trim(),
    };
    const key = `${item.line}:${item.column}:${item.severity}:${item.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    issues.push(item);
  }
  return issues;
}

/**
 * @param {string} absPath
 * @param {string} content
 * @returns {string}
 */
function writeTempCopy(absPath, content) {
  const base = path.basename(absPath) || 'file.txt';
  const tmp = path.join(os.tmpdir(), `pecado-codx-${process.pid}-${Date.now()}-${base}`);
  fs.writeFileSync(tmp, content, 'utf8');
  return tmp;
}

async function getIosSimulatorSdkPath() {
  try {
    const { stdout } = await execFileAsync('xcrun', ['--sdk', 'iphonesimulator', '--show-sdk-path'], {
      encoding: 'utf8',
    });
    return String(stdout || '').trim();
  } catch {
    return '';
  }
}

/**
 * @param {string} absPath
 * @param {string} lang
 */
async function runClangSyntaxCheck(absPath, lang) {
  const sdk = await getIosSimulatorSdkPath();
  const args = ['-fsyntax-only', '-Wno-everything'];
  if (sdk) args.push('-isysroot', sdk);
  if (lang === 'objective-c') args.push('-x', 'objective-c');
  else if (lang === 'objective-c++') args.push('-x', 'objective-c++');
  else if (lang === 'c') args.push('-x', 'c');
  else args.push('-x', 'c++');
  args.push(absPath);
  try {
    await execFileAsync('xcrun', ['clang', ...args], { encoding: 'utf8' });
    return '';
  } catch (e) {
    return `${e.stdout || ''}\n${e.stderr || ''}\n${e.message || ''}`;
  }
}

/**
 * @param {string} absPath
 */
async function runSwiftParseCheck(absPath) {
  try {
    await execFileAsync('xcrun', ['swiftc', '-parse', absPath], { encoding: 'utf8' });
    return '';
  } catch (e) {
    return `${e.stdout || ''}\n${e.stderr || ''}\n${e.message || ''}`;
  }
}

/**
 * @param {string} relPath
 */
function guessCheckKind(relPath) {
  const ext = path.extname(String(relPath || '')).toLowerCase();
  if (ext === '.swift') return 'swift';
  if (ext === '.m') return 'objective-c';
  if (ext === '.mm') return 'objective-c++';
  if (ext === '.h' || ext === '.hpp') return 'objective-c';
  if (ext === '.c') return 'c';
  if (ext === '.cpp' || ext === '.cc') return 'cpp';
  return '';
}

/**
 * @param {{ absPath: string, relPath: string, content?: string }} input
 */
async function checkFileSyntax(input) {
  const relPath = String(input?.relPath || '');
  const absPath = String(input?.absPath || '');
  if (!absPath && input?.content == null) {
    return { ok: false, issues: [], error: '文件不存在' };
  }

  const kind = guessCheckKind(relPath);
  if (!kind) {
    return { ok: true, issues: [], skipped: true };
  }

  let checkPath = absPath;
  let tempPath = '';
  try {
    if (input?.content != null) {
      tempPath = writeTempCopy(absPath || path.join(os.tmpdir(), path.basename(relPath) || 'file.txt'), input.content);
      checkPath = tempPath;
    } else if (!fs.existsSync(absPath)) {
      return { ok: false, issues: [], error: '文件不存在' };
    }

    let output = '';
    if (kind === 'swift') output = await runSwiftParseCheck(checkPath);
    else output = await runClangSyntaxCheck(checkPath, kind);

    return { ok: true, issues: parseCompilerIssues(output) };
  } catch (e) {
    return { ok: false, issues: [], error: e.message || String(e) };
  } finally {
    if (tempPath) {
      try {
        fs.unlinkSync(tempPath);
      } catch {
        /* ignore */
      }
    }
  }
}

module.exports = {
  checkFileSyntax,
  parseCompilerIssues,
  guessCheckKind,
};
