/**
 * @file app-menu.js
 *
 * 【功能】应用菜单栏：Pecado 应用菜单、File/Edit/View/Window 标准项与 Preferences 入口。
 *
 * 【调用方】settings/js/register.js；main/js/main.js → setupApplicationMenu(getMainWindowFn)
 *
 * 【依赖】settings/index.js（openSettings）；mcp-filesystem/ipc.js（openProjectFolder）
 */
const { Menu, dialog } = require('electron');
const { openProjectFolder } = require('../../mcp-filesystem/ipc');
const { APP } = require('../../shared/ipc-channels');
const { promptXcodeAutomationPermission } = require('../../xcode/automation-permission');

const APP_NAME = 'Pecado';

function getPreferencesMenuItem() {
  return {
    label: 'Preferences…',
    accelerator: 'CmdOrCtrl+,',
    click: () => {
      const { openSettings } = require('./register');
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
        ...(isMac
          ? [
              {
                label: 'Authorize Xcode Automation…',
                click: () => {
                  const win = getMainWindowFn();
                  promptXcodeAutomationPermission(win).catch((e) => {
                    dialog.showErrorBox('Xcode Automation', e.message || String(e));
                  });
                },
              },
            ]
          : []),
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
      submenu: [
        {
          label: 'Pecado',
          accelerator: 'CmdOrCtrl+1',
          click: () => {
            const win = getMainWindowFn();
            win?.webContents.send(APP.NAVIGATE_VIEW, { view: 'chat' });
          },
        },
        {
          label: 'Workflow',
          accelerator: 'CmdOrCtrl+2',
          click: () => {
            const win = getMainWindowFn();
            win?.webContents.send(APP.NAVIGATE_VIEW, { view: 'workflow' });
          },
        },
        {
          label: 'Git 面板',
          accelerator: 'CmdOrCtrl+3',
          click: () => {
            const win = getMainWindowFn();
            win?.webContents.send(APP.NAVIGATE_VIEW, { view: 'git' });
          },
        },
        { type: 'separator' },
        { role: 'toggleDevTools' },
        { role: 'reload' },
      ],
    },
    {
      label: 'Window',
      submenu: [{ role: 'minimize' }, ...(isMac ? [{ type: 'separator' }, { role: 'front' }] : [{ role: 'close' }])],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

module.exports = { setupApplicationMenu };
