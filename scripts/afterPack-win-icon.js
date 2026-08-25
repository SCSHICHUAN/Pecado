/**
 * electron-builder afterPack：在 macOS 交叉打包 Windows 时，
 * signAndEditExecutable 必须为 false（否则 rcedit/wine 会卡住），
 * 因此用纯 JS resedit 把 icon.ico 写入 Pecado.exe。
 */
const fs = require('fs');
const path = require('path');

async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return;

  const exeName = `${context.packager.appInfo.productFilename}.exe`;
  const exePath = path.join(context.appOutDir, exeName);
  const iconPath = path.join(context.packager.projectDir, 'assets', 'icons', 'icon.ico');

  if (!fs.existsSync(exePath)) {
    console.warn('[afterPack] skip icon: exe not found', exePath);
    return;
  }
  if (!fs.existsSync(iconPath)) {
    console.warn('[afterPack] skip icon: ico not found', iconPath);
    return;
  }

  // app-builder-lib 已依赖 resedit；从项目 node_modules 解析
  let ResEdit;
  try {
    ResEdit = require('resedit');
  } catch (_) {
    ResEdit = require(path.join(
      context.packager.projectDir,
      'node_modules',
      'app-builder-lib',
      'node_modules',
      'resedit'
    ));
  }

  const exeBuf = fs.readFileSync(exePath);
  const icoBuf = fs.readFileSync(iconPath);
  const exe = ResEdit.NtExecutable.from(exeBuf, { ignoreCert: true });
  const res = ResEdit.NtExecutableResource.from(exe);
  const iconFile = ResEdit.Data.IconFile.from(icoBuf);
  const icons = iconFile.icons.map((item) => item.data);

  const groups = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries);
  if (groups.length > 0) {
    for (const group of groups) {
      ResEdit.Resource.IconGroupEntry.replaceIconsForResource(
        res.entries,
        group.id,
        group.lang,
        icons
      );
    }
  } else {
    ResEdit.Resource.IconGroupEntry.replaceIconsForResource(res.entries, 1, 1033, icons);
  }

  // 顺带写入产品名等版本信息（原先依赖 rcedit）
  const viList = ResEdit.Resource.VersionInfo.fromEntries(res.entries);
  if (viList.length === 1) {
    const vi = viList[0];
    const langs = vi.getAllLanguagesForStringValues();
    const lang = langs[0] || { lang: 1033, codepage: 1200 };
    const productName = context.packager.appInfo.productName || 'Pecado';
    vi.setStringValues(lang, {
      FileDescription: productName,
      ProductName: productName,
      OriginalFilename: exeName,
    });
    vi.outputToResourceEntries(res.entries);
  }

  res.outputResource(exe);
  fs.writeFileSync(exePath, Buffer.from(exe.generate()));
  console.log('[afterPack] embedded Windows icon into', exePath);
}

module.exports = afterPack;
