/*
 * Builds the Windows game:
 *   release/Ghasaq-<version>-Setup.exe     installs it: Start menu and desktop shortcuts, uninstaller
 *   release/Ghasaq-<version>-Portable.exe  runs it without installing
 *
 *   npm run build:exe
 *
 * 1. the single-file game with its fonts inside (dist-app/ghasaq.html)
 * 2. copied into the desktop app as desktop/app/index.html
 * 3. Electron + electron-builder wrap it (their settings are in desktop/package.json)
 * The first run installs Electron into desktop/node_modules and downloads its packaging tools.
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const desktop = join(root, 'desktop');
const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
const node = (args, cwd = root) => execFileSync(process.execPath, args, { cwd, stdio: 'inherit' });

node(['scripts/build-single.mjs', '--app']);
mkdirSync('desktop/app', { recursive: true });
copyFileSync('dist-app/ghasaq.html', 'desktop/app/index.html');
copyFileSync('packaging/icon-512.png', 'desktop/app/icon.png');   // window and taskbar icon
mkdirSync('desktop/build', { recursive: true });
copyFileSync('packaging/icon-512.png', 'desktop/build/icon.png'); // the .exe icon

// the Windows app carries the game's version
const pkgFile = 'desktop/package.json';
const pkg = JSON.parse(readFileSync(pkgFile, 'utf8'));
if (pkg.version !== version) {
  pkg.version = version;
  writeFileSync(pkgFile, JSON.stringify(pkg, null, 2) + '\n');
}

if (!existsSync('desktop/node_modules/electron-builder')) {
  // npm's own script when this runs through npm, otherwise the npm on PATH
  if (process.env.npm_execpath) node([process.env.npm_execpath, 'install'], desktop);
  else if (process.platform === 'win32') execFileSync('cmd.exe', ['/c', 'npm', 'install'], { cwd: desktop, stdio: 'inherit' });
  else execFileSync('npm', ['install'], { cwd: desktop, stdio: 'inherit' });
}
// Electron unpacked in node_modules (it downloads on first use). electron-builder copies it from
// there (electronDist) instead of unzipping into dist/ and renaming a folder, a rename that fails
// on Windows while the editor watches dist/.
if (!existsSync('desktop/node_modules/electron/path.txt')) node(['node_modules/electron/install.js'], desktop);
node([join(desktop, 'node_modules/electron-builder/cli.js'), '--win', '--x64', '--publish', 'never'], desktop);

mkdirSync('release', { recursive: true });
for (const kind of ['Setup', 'Portable']) {
  const name = `Ghasaq-${version}-${kind}.exe`;
  const built = join('desktop/dist', name);
  if (!existsSync(built)) throw new Error('electron-builder finished without producing ' + built);
  copyFileSync(built, join('release', name));
  console.log('release/' + name);
}
