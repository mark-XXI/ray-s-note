'use strict';
// Safe source and optional runtime preflight. Does not build, install, migrate,
// delete or modify any Ray's Note data. No network access.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');

function assert(condition, description) {
  if (!condition) throw new Error(description);
}
function assertFile(relative) {
  const file = path.join(root, relative);
  assert(fs.statSync(file).isFile(), `Missing required file: ${relative}`);
}
function readIcon(file) {
  const b = fs.readFileSync(file);
  assert(b.length >= 22 && b.readUInt16LE(0) === 0 && b.readUInt16LE(2) === 1,
    'Invalid Windows .ico header');
  const count = b.readUInt16LE(4);
  assert(count >= 1 && b.length >= 6 + 16 * count, 'Invalid .ico image directory');
  for (let i = 0; i < count; i++) {
    const off = 6 + 16 * i;
    const size = b.readUInt32LE(off + 8);
    const start = b.readUInt32LE(off + 12);
    assert(size > 0 && start >= 6 + 16 * count && start + size <= b.length,
      'Corrupt .ico image payload');
  }
}

function preflight({ runtime = false } = {}) {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
  const b = pkg.build || {};
  assert(pkg.name === 'rays-note' && pkg.version === '1.0.0',
    'Unexpected package identity/version; review data-location compatibility');
  assert(b.appId === 'com.rays.note' && b.productName === 'Ray Notes',
    'Do not rename the established app ID or product name');
  assert(lock.name === pkg.name && lock.version === pkg.version &&
    lock.packages && lock.packages[''] &&
    lock.packages[''].name === pkg.name && lock.packages[''].version === pkg.version,
    'Lockfile root does not match package.json');
  for (const kind of ['dependencies','devDependencies']) {
    assert(JSON.stringify(pkg[kind] || {}) === JSON.stringify(lock.packages[''][kind] || {}),
      `Lockfile ${kind} is out of sync; do not regenerate silently`);
  }
  assert(pkg.dependencies && pkg.dependencies.koffi &&
    pkg.devDependencies && pkg.devDependencies.electron && pkg.devDependencies['electron-builder'],
    'Required Electron/build/native dependencies are missing');
  const targets = b.win && b.win.target;
  assert(Array.isArray(targets) && targets.length === 2 &&
    ['nsis','portable'].every(t => targets.some(x => x.target === t &&
      Array.isArray(x.arch) && x.arch.includes('x64'))),
    'Both NSIS and portable x64 targets must be configured');
  assert(b.win.icon === 'note-icon.ico', 'Windows icon path changed');
  assert(b.asar === true && Array.isArray(b.asarUnpack) &&
    b.asarUnpack.includes('node_modules/koffi/**/*'),
    'Native koffi must be explicitly unpacked');
  assert(Array.isArray(b.files) &&
    ['main.js','note.html','dashboard.html','note-icon.ico','src/**/*'].every(f => b.files.includes(f)) &&
    b.files.every(f => !f.includes('**/*') || f === 'src/**/*'),
    'Release files must be explicitly allowlisted');
  assert(b.nsis && b.nsis.oneClick === false &&
    b.nsis.deleteAppDataOnUninstall === false &&
    b.nsis.artifactName === 'RayNotes-Setup-${version}-${arch}.${ext}',
    'Installer settings must preserve user data');
  assert(b.portable &&
    b.portable.artifactName === 'RayNotes-Portable-${version}-${arch}.${ext}',
    'Portable target filename mismatch');
  assert(pkg.scripts.build.includes('--publish never'),
    'Building must not publish any files');
  for (const file of ['main.js','note.html','dashboard.html','note-icon.ico',
    'src/windows/win32-desktop.js','src/windows/note-corners.js',
    'src/preload/note.js','src/preload/dashboard.js',
    'src/storage/note-store.js']) assertFile(file);
  readIcon(path.join(root,'note-icon.ico'));
  const main = fs.readFileSync(path.join(root,'main.js'),'utf8');
  assert(main.includes("app.getPath('userData')") &&
    main.includes("if (!app.isPackaged && process.env.RAYS_NOTE_TEST_DATA_DIR)"),
    'Production userData isolation has changed; review before release');
  assert(main.includes("require('./src/windows/win32-desktop')") &&
    main.includes("require('./src/windows/note-corners')"),
    'Windows integration sources not wired into packaged main');
  if (runtime) {
    assert(process.platform === 'win32' && process.arch === 'x64',
      'Native release preflight must run on Windows x64');
    const koffiPath = require.resolve('koffi', { paths: [root] });
    assert(koffiPath && require(koffiPath),
      'Cannot load koffi production native module on Windows');
  }
  return {
    name: pkg.name,
    version: pkg.version,
    productName: b.productName,
    appId: b.appId,
    targets: b.win.target.map(t=>t.target),
    runtimeVerified: runtime,
  };
}

if (require.main === module) {
  try {
    const runtime = process.argv.includes('--runtime');
    const info = preflight({ runtime });
    for (const [k,v] of Object.entries(info))
      process.stdout.write(`${k.toUpperCase()}=${Array.isArray(v)?v.join(','):v}\n`);
    process.stdout.write('RELEASE_SOURCE_CHECK=PASS\n');
  } catch (error) {
    process.stderr.write(`RELEASE_SOURCE_CHECK=FAIL: ${error.message}\n`);
    process.exitCode = 1;
  }
}
module.exports = { preflight, readIcon };
