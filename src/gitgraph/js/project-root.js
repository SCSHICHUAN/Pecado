/**
 * @file project-root.js
 *
 * 【功能】读取用户上次 Open Folder 的工程路径（`userData/mcp-project.json`）。
 * 【调用方】gitgraph/js/register.js（GET_STATE / pull / push / commit 默认 cwd）
 * 【说明】与 mcp-filesystem/ipc.js 写入路径一致，Git 面板无需单独选目录。
 */
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

function projectConfigPath() {
  return path.join(app.getPath('userData'), 'mcp-project.json');
}

function readSavedProjectRoot() {
  try {
    const p = projectConfigPath();
    if (!fs.existsSync(p)) return '';
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    return j.projectRoot ? String(j.projectRoot).trim() : '';
  } catch {
    return '';
  }
}

module.exports = { readSavedProjectRoot };
