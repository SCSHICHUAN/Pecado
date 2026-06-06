/**
 * @file app-menu.js
 *
 * 【功能】应用菜单栏：Pecado 应用菜单、File/Edit/View/Window 标准项与 Preferences 入口。
 *
 * 【调用方】settings/index.js 再导出；main/main.js → setupApplicationMenu(getMainWindowFn)
 *
 * 【依赖】settings/index.js（openSettings）；main/mcp-filesystem/ipc.js（openProjectFolder）
 */
const { Menu, dialog } = require('electron');
const { openProjectFolder } = require('../main/mcp-filesystem/ipc');

const APP_NAME = 'Pecado';

function getPreferencesMenuItem() {
  return {
    label: 'Preferences…',
    accelerator: 'CmdOrCtrl+,',
    click: () => {
      const { openSettings } = require('./index');
      openSettings();
    },
  };
}

/**
 * @param {() => import('electron').BrowserWindow | null} getMainWindowFn
 */
function setupApplicationMenu(getMainWindowFn) {
  const isMac = process.platform === 'darwin';
  const preferencesItem = getPreferencesMenuItem();

  /** @type {import('electron').MenuItemConstructorOptions[]} */
  const template = [
    ...(isMac
      ? [
          {
            label: APP_NAME,
            submenu: [
              { role: 'about' },
              { type: 'separator' },
              preferencesItem,
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' },
            ],
          },
        ]
      : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'Open Folder…',
          accelerator: 'CmdOrCtrl+O',
          click: () => {
            openProjectFolder(getMainWindowFn).catch((e) => {
              dialog.showErrorBox('Open Folder', e.message || String(e));
            });
          },
        },
        ...(isMac ? [] : [{ type: 'separator' }, preferencesItem]),
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [{ role: 'toggleDevTools' }, { role: 'reload' }],
    },
    {
      label: 'Window',
      submenu: [{ role: 'minimize' }, ...(isMac ? [{ type: 'separator' }, { role: 'front' }] : [{ role: 'close' }])],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

module.exports = { setupApplicationMenu };
