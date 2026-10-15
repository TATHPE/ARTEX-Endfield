// electron-builder afterPack hook.
//
// We disable electron-builder's own sign/edit step ("signAndEditExecutable":
// false) because unpacking its winCodeSign bundle needs symlink privileges this
// machine does not have (the bundle ships macOS dylibs as symlinks). The icon and
// version strings are therefore stamped here, with the rcedit that is already in
// the electron-builder cache, before the NSIS installer is produced.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

function findRcedit() {
  const root = path.join(process.env.LOCALAPPDATA || '', 'electron-builder', 'Cache', 'winCodeSign');
  let entries = [];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const candidate = path.join(root, entry.name, 'rcedit-x64.exe');
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

module.exports = async function afterPack(context) {
  const productName = context.packager.appInfo.productFilename || 'ARTEX';
  const exe = path.join(context.appOutDir, `${productName}.exe`);
  const ico = path.join(context.packager.projectDir, 'build', 'icon.ico');
  const version = context.packager.appInfo.version || '0.3.19';

  if (!fs.existsSync(exe)) {
    console.log('[afterPack] executable not found, skipping stamp:', exe);
    return;
  }
  if (!fs.existsSync(ico)) {
    console.log('[afterPack] icon not found, skipping stamp:', ico);
    return;
  }
  const rcedit = findRcedit();
  if (!rcedit) {
    console.log('[afterPack] rcedit not in cache, icon left untouched');
    return;
  }

  execFileSync(
    rcedit,
    [
      exe,
      '--set-icon', ico,
      '--set-version-string', 'FileDescription', 'ARTEX - Autonomous Pentest Console',
      '--set-version-string', 'ProductName', 'ARTEX',
      '--set-version-string', 'CompanyName', 'ARTEX',
      '--set-version-string', 'LegalCopyright', 'AGPL-3.0',
      '--set-file-version', version,
      '--set-product-version', version,
    ],
    { stdio: 'inherit' }
  );
  console.log('[afterPack] stamped icon + version into', exe);
};
