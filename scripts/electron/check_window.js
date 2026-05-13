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
