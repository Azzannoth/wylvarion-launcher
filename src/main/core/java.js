'use strict';
// Stáhne oficiální Java runtime od Mojangu (stejný, jaký používá vanilla launcher).

const fs = require('fs');
const path = require('path');
const { getJson, download, pool } = require('./http');

const RUNTIME_INDEX =
  'https://launchermeta.mojang.com/v1/products/java-runtime/2ec0cc96c44e5a76b9c8b7c39df7210883d12871/all.json';

function platformKey() {
  const a = process.arch;
  if (process.platform === 'win32') return a === 'arm64' ? 'windows-arm64' : a === 'ia32' ? 'windows-x86' : 'windows-x64';
  if (process.platform === 'darwin') return a === 'arm64' ? 'mac-os-arm64' : 'mac-os';
  return a === 'ia32' ? 'linux-i386' : 'linux';
}

function javaBinary(home) {
  if (process.platform === 'win32') return path.join(home, 'bin', 'javaw.exe');
  if (process.platform === 'darwin') return path.join(home, 'jre.bundle', 'Contents', 'Home', 'bin', 'java');
  return path.join(home, 'bin', 'java');
}

/**
 * Zajistí Java runtime pro danou komponentu (např. "java-runtime-epsilon").
 * Vrací cestu ke spustitelné Javě.
 */
async function ensureJava(runtimeDir, component, progress = () => {}) {
  const key = platformKey();
  const home = path.join(runtimeDir, component, key);
  const marker = path.join(home, '.wylvarion-ok');
  const bin = javaBinary(home);
  if (fs.existsSync(marker) && fs.existsSync(bin)) return bin;

  progress({ stage: 'java', text: 'Stahuji Javu…', done: 0, total: 1 });
  const index = await getJson(RUNTIME_INDEX);
  const entries = (index[key] || {})[component];
  if (!entries || !entries.length) {
    throw new Error(`Pro tento systém (${key}) Mojang nenabízí Javu „${component}“.`);
  }
  const manifest = await getJson(entries[0].manifest.url);
  const files = Object.entries(manifest.files);

  for (const [rel, f] of files) {
    if (f.type === 'directory') await fs.promises.mkdir(path.join(home, rel), { recursive: true });
  }
  const toGet = files.filter(([, f]) => f.type === 'file');
  let done = 0;
  await pool(toGet, 12, async ([rel, f]) => {
    const dest = path.join(home, rel);
    const raw = f.downloads.raw;
    await download(raw.url, dest, { sha1: raw.sha1, size: raw.size });
    if (f.executable && process.platform !== 'win32') await fs.promises.chmod(dest, 0o755);
    done++;
    if (done % 20 === 0 || done === toGet.length) progress({ stage: 'java', text: 'Stahuji Javu…', done, total: toGet.length });
  });
  for (const [rel, f] of files) {
    if (f.type !== 'link') continue;
    const dest = path.join(home, rel);
    try {
      await fs.promises.rm(dest, { force: true });
      await fs.promises.symlink(f.target, dest);
    } catch {
      /* odkazy nejsou pro spuštění nutné */
    }
  }
  if (!fs.existsSync(bin)) throw new Error('Java se nestáhla správně, chybí spustitelný soubor.');
  await fs.promises.writeFile(marker, component);
  return bin;
}

module.exports = { ensureJava, platformKey, javaBinary };
