'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const { spawnSync }=require('node:child_process');
const { preflight, readIcon }=require('../scripts/release-check');
const { verifyRelease }=require('../scripts/verify-release');
const root=path.resolve(__dirname,'..');
const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
const config=pkg.build;
const read=rel=>fs.readFileSync(path.join(root,rel),'utf8');

test('real full-source snapshot keeps package and lockfile identities synchronized',()=>{
  const info=preflight();
  assert.equal(info.name,'rays-note');
  assert.equal(info.version,'2.0.0');
});
test('existing application identity is preserved for user-data compatibility',()=>{
  assert.equal(config.appId,'com.rays.note');
  assert.equal(config.productName,'Ray Notes');
  assert.equal(pkg.name,'rays-note');
});
test('installer and portable targets are both Windows x64 and have distinct names',()=>{
  assert.deepEqual(config.win.target.map(t=>t.target),['nsis','portable']);
  for(const t of config.win.target) assert.deepEqual(t.arch,['x64']);
  assert.match(config.nsis.artifactName,/Setup/);
  assert.match(config.portable.artifactName,/Portable/);
});
test('NSIS is opt-in installation and will not request deletion of app data',()=>{
  assert.equal(config.nsis.oneClick,false);
  assert.equal(config.nsis.perMachine,false);
  assert.equal(config.nsis.deleteAppDataOnUninstall,false);
  assert.equal(config.nsis.allowToChangeInstallationDirectory,true);
});
test('release build never auto-publishes',()=>{
  assert.match(pkg.scripts.build,/--publish never/);
  assert.doesNotMatch(pkg.scripts.build,/--publish\s+(always|onTag)/);
});
test('only runtime app assets are explicitly packaged',()=>{
  assert.deepEqual(config.files,['main.js','note.html','dashboard.html','note-icon.ico','src/**/*']);
  assert.ok(!config.files.some(p=>p.startsWith('tests')||p.startsWith('docs')||p.startsWith('scripts')));
});
test('production koffi remains installed and native binary is unpacked',()=>{
  assert.ok(pkg.dependencies.koffi);
  assert.equal(config.asar,true);
  assert.deepEqual(config.asarUnpack,['node_modules/koffi/**/*']);
});
test('actual icon has a well-formed ICO directory',()=>{
  assert.doesNotThrow(()=>readIcon(path.join(root,'note-icon.ico')));
});
test('normal notes data location remains unchanged by the release batch',()=>{
  assert.match(read('main.js'),/app\.getPath\('userData'\)/);
  assert.match(read('main.js'),/!app\.isPackaged && process\.env\.RAYS_NOTE_TEST_DATA_DIR/);
  assert.doesNotMatch(read('scripts/release-check.js'),/app\.setPath\(/);
});
test('runtime source and native Windows integration remain included',()=>{
  for(const rel of ['src/windows/win32-desktop.js','src/windows/note-corners.js','src/renderer/note.js','src/storage/note-store.js'])
    assert.ok(fs.existsSync(path.join(root,rel)));
});
test('source preflight CLI runs without installing Electron on non-Windows hosts',()=>{
  const r=spawnSync(process.execPath,['scripts/release-check.js'],{cwd:root,encoding:'utf8'});
  assert.equal(r.status,0,r.stderr);
  assert.match(r.stdout,/RELEASE_SOURCE_CHECK=PASS/);
});
test('build validator blocks missing artifacts without writing a checksum file',()=>{
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'rays-rel-missing-'));
  try {
    fs.mkdirSync(path.join(tmp,'dist'));
    fs.writeFileSync(path.join(tmp,'package.json'),JSON.stringify({version:'2.0.0'}));
    assert.throws(()=>verifyRelease({root:tmp,platform:'win32',arch:'x64'}),/ENOENT|undersized/);
    assert.ok(!fs.existsSync(path.join(tmp,'dist','RayNotes-2.0.0-SHA256.txt')));
  } finally {fs.rmSync(tmp,{recursive:true,force:true});}
});
test('build validator fails closed on non-Windows platform',()=>{
  assert.throws(()=>verifyRelease({root,platform:'linux',arch:'x64'}),/Windows x64/);
});
test('installer, portable and unpacked binaries must have valid PE headers',()=>{
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'rays-rel-pe-'));
  try {
    const d=path.join(tmp,'dist');fs.mkdirSync(d);
    fs.writeFileSync(path.join(tmp,'package.json'),JSON.stringify({version:'2.0.0'}));
    const b=Buffer.alloc(66000,0);b.write('MZ',0,'ascii');b.writeUInt32LE(0x80,0x3c);b.write('PE\0\0',0x80,'ascii');
    fs.writeFileSync(path.join(d,'RayNotes-Setup-2.0.0-x64.exe'),b);
    fs.writeFileSync(path.join(d,'RayNotes-Portable-2.0.0-x64.exe'),b);
    const unpacked=path.join(d,'win-unpacked');fs.mkdirSync(path.join(unpacked,'resources'),{recursive:true});
    fs.writeFileSync(path.join(unpacked,'Ray Notes.exe'),b);
    fs.writeFileSync(path.join(unpacked,'resources','app.asar'),Buffer.alloc(15000,0));
    const native=path.join(unpacked,'resources','app.asar.unpacked','node_modules','koffi');
    fs.mkdirSync(native,{recursive:true});
    assert.throws(()=>verifyRelease({root:tmp,platform:'win32',arch:'x64'}),/native .node binary/);
    fs.writeFileSync(path.join(native,'koffi.node'),Buffer.alloc(10));
    const report=verifyRelease({root:tmp,platform:'win32',arch:'x64',writeChecksums:true});
    assert.equal(report.binaries.length,2);
    assert.equal(report.nativeModules,1);
    assert.match(fs.readFileSync(path.join(d,'RayNotes-2.0.0-SHA256.txt'),'utf8'),/RayNotes-Portable/);
  } finally {fs.rmSync(tmp,{recursive:true,force:true});}
});
test('release documentation warns about unsigned installers and profile boundaries',()=>{
  const doc=read('docs/RELEASE.md');
  assert.match(doc,/unsigned/);
  assert.match(doc,/No automatic data migration is performed/);
  assert.match(doc,/Win\+D/);
});
