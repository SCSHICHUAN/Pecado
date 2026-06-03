/**
 * @file app-menu.js
 *
 * 应用菜单（macOS 菜单栏 File → Open Folder…），调用 MCP 选工程并连接。
 */
const { app, Menu, dialog } = require('electron');
const { pickAndConnectProject } = require('./filesystem-ipc');

async function onOpenFolder(getMainWindow) {
  const result = await pickAndConnectProject(getMainWindow);
  if (result.canceled) return;
  if (result.error) {
    dialog.showErrorBox('Open Folder', result.error);
    return;
  }
  console.log('[menu] Open Folder:', result.projectRoot);
}

/**
 * @param {() => import('electron').BrowserWindow | null} getMainWindow
 */
function setupApplicationMenu(getMainWindow) {
  const isMac = process.platform === 'darwin';

  /** @type {import('electron').MenuItemConstructorOptions[]} */
  const template = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' },
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
            onOpenFolder(getMainWindow).catch((e) => {
              dialog.showErrorBox('Open Folder', e.message || String(e));
            });
          },
        },
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
