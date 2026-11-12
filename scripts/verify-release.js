'use strict';
// Validate generated artifacts. No installer is launched, no registry writes,
// and no application data is read/modified. Only --write-checksums writes to dist/.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function verifyRelease({ root = path.resolve(__dirname, '..'),
  platform = process.platform, arch = process.arch, writeChecksums = false } = {}) {
  if (platform !== 'win32' || arch !== 'x64') {
    throw new Error('Release binaries must be verified on Windows x64');
  }
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'),'utf8'));
  const dist = path.join(root,'dist');
  const expected = [
    `RayNotes-Setup-${pkg.version}-x64.exe`,
    `RayNotes-Portable-${pkg.version}-x64.exe`,
  ];
  function assertFile(p, min) {
    const stats = fs.statSync(p);
    if (!stats.isFile() || stats.size < min)
      throw new Error(`Missing or undersized release file: ${p}`);
    return stats.size;
  }
  // This is a structural PE check, not malware scanning or signature verification.
  function peSignature(p) {
    const fd = fs.openSync(p,'r');
    try {
      const head = Buffer.alloc(512);
      const count = fs.readSync(fd, head, 0, head.length, 0);
      if (count < 256 || head.toString('ascii',0,2) !== 'MZ')
        throw new Error(`Missing Windows MZ header: ${p}`);
      const offset = head.readUInt32LE(0x3c);
      if (offset < 64 || offset > 65536) throw new Error(`Invalid PE offset: ${p}`);
      const sig = Buffer.alloc(4);
      if (fs.readSync(fd,sig,0,4,offset)!==4 || sig.toString('ascii')!=='PE\0\0')
        throw new Error(`Missing PE signature: ${p}`);
    } finally { fs.closeSync(fd); }
  }
  const binaryInfo=[];
  for (const name of expected) {
    const file=path.join(dist,name);
    const size=assertFile(file,65536);
    peSignature(file);
    binaryInfo.push({name,file,size,sha256:crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')});
  }
  const unpacked=path.join(dist,'win-unpacked');
  const appExe=path.join(unpacked,'Ray Notes.exe');
  assertFile(appExe,65536);peSignature(appExe);
  assertFile(path.join(unpacked,'resources','app.asar'),10000);
  const koffiRoot=path.join(unpacked,'resources','app.asar.unpacked','node_modules','koffi');
  if (!fs.existsSync(koffiRoot)) throw new Error('Missing native koffi unpack directory');
  let nativeCount=0;
  const queue=[koffiRoot];
  while (queue.length) {
    const dir=queue.pop();
    for (const e of fs.readdirSync(dir,{withFileTypes:true})) {
      const p=path.join(dir,e.name);
      if (e.isDirectory()) queue.push(p);
      else if (e.isFile() && e.name.toLowerCase().endsWith('.node')) nativeCount++;
    }
  }
  if (!nativeCount) throw new Error('Missing unpacked koffi native .node binary');
  if (writeChecksums) {
    const sums=binaryInfo.map(({name,sha256})=>`${sha256}  ${name}`).join('\n')+'\n';
    fs.writeFileSync(path.join(dist,`RayNotes-${pkg.version}-SHA256.txt`),sums,'utf8');
  }
  return { binaries:binaryInfo, nativeModules:nativeCount, checksumFile:writeChecksums
    ? `RayNotes-${pkg.version}-SHA256.txt` : null };
}

if (require.main === module) {
  try {
    const result=verifyRelease({writeChecksums:process.argv.includes('--write-checksums')});
    for(const item of result.binaries) {
      process.stdout.write(`ARTIFACT=${item.name}\nSIZE_BYTES=${item.size}\nSHA256=${item.sha256}\n`);
    }
    process.stdout.write(`KOFFI_NATIVE_BINARIES=${result.nativeModules}\n`);
    if(result.checksumFile) process.stdout.write(`CHECKSUM_FILE=dist/${result.checksumFile}\n`);
    process.stdout.write('RELEASE_ARTIFACT_CHECK=PASS\n');
  } catch(error) {
    process.stderr.write(`RELEASE_ARTIFACT_CHECK=FAIL: ${error.message}\n`);
    process.exitCode=1;
  }
}
module.exports={verifyRelease};
