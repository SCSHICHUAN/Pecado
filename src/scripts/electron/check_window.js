/**
 * @file check_window.js
 *
 * 极轻量探针：`app.whenReady` 后打印当前所有 `BrowserWindow` 的可见性、焦点与 `getBounds()`，随后 `quit`。
 * 用于验证多窗口或显示状态；需在有窗口已创建的前提下由外部启动才有输出意义。
 */
const { app, BrowserWindow } = require('electron');

app.whenReady().then(() => {
  console.log('BrowserWindow.getAllWindows():', BrowserWindow.getAllWindows());
  BrowserWindow.getAllWindows().forEach((win, index) => {
    console.log(`Window ${index} isVisible:`, win.isVisible());
    console.log(`Window ${index} isFocused:`, win.isFocused());
    console.log(`Window ${index} bounds:`, win.getBounds());
  });
  app.quit();
});
