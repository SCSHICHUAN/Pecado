/**
 * @file project-root.js
 *
 * 【功能】读取 MCP 已打开工程路径（与 mcp-filesystem/ipc 共用 mcp-project.json）。
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
