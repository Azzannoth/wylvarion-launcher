'use strict';
// Instalace Minecraftu + Fabricu: version JSON, knihovny, nativní knihovny, assety a logovací konfigurace.

const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const { getJson, download, pool, fileOk } = require('./http');
const { allowed, currentOs } = require('./rules');
const { mavenPath } = require('./paths');

const VERSION_MANIFEST = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';
const FABRIC_META = 'https://meta.fabricmc.net/v2';
const RESOURCES = 'https://resources.download.minecraft.net';

async function readJson(file) {
  return JSON.parse(await fs.promises.readFile(file, 'utf8'));
}

async function writeJson(file, data) {
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  await fs.promises.writeFile(file, JSON.stringify(data, null, 2));
}

/** Načte version JSON vanilly (z cache, nebo stáhne). */
async function vanillaJson(dirs, mcVersion) {
  const file = path.join(dirs.versions, mcVersion, `${mcVersion}.json`);
  try {
    const manifest = await getJson(VERSION_MANIFEST);
    const entry = manifest.versions.find((v) => v.id === mcVersion);
    if (!entry) throw new Error(`Verze Minecraftu ${mcVersion} neexistuje.`);
    if (!(await fileOk(file, entry.sha1))) await download(entry.url, file, { sha1: entry.sha1 });
  } catch (e) {
    if (!fs.existsSync(file)) throw e; // offline: použijeme uloženou verzi
  }
  return readJson(file);
}

async function resolveLoader(mcVersion, wanted) {
  if (wanted && wanted !== 'latest') return wanted;
  const list = await getJson(`${FABRIC_META}/versions/loader/${encodeURIComponent(mcVersion)}`);
  const stable = list.find((l) => l.loader.stable) || list[0];
  if (!stable) throw new Error(`Fabric zatím nepodporuje Minecraft ${mcVersion}.`);
  return stable.loader.version;
}

/** Načte Fabric profil (z cache, nebo stáhne). */
async function fabricJson(dirs, mcVersion, loaderWanted) {
  let loader;
  try {
    loader = await resolveLoader(mcVersion, loaderWanted);
  } catch (e) {
    const cached = await findCachedFabric(dirs, mcVersion);
    if (cached) return cached;
    throw e;
  }
  const id = `fabric-loader-${loader}-${mcVersion}`;
  const file = path.join(dirs.versions, id, `${id}.json`);
  if (!fs.existsSync(file)) {
    const profile = await getJson(`${FABRIC_META}/versions/loader/${encodeURIComponent(mcVersion)}/${encodeURIComponent(loader)}/profile/json`);
    await writeJson(file, profile);
  }
  return readJson(file);
}

async function findCachedFabric(dirs, mcVersion) {
  try {
    const ids = (await fs.promises.readdir(dirs.versions)).filter((d) => d.startsWith('fabric-loader-') && d.endsWith('-' + mcVersion)).sort();
    if (!ids.length) return null;
    const id = ids[ids.length - 1];
    return readJson(path.join(dirs.versions, id, `${id}.json`));
  } catch {
    return null;
  }
}

function libKey(name) {
  // group:artifact[:classifier] – verze se ignoruje, aby Fabric mohl přepsat starší knihovny vanilly (např. ASM)
  const parts = name.split('@')[0].split(':');
  return [parts[0], parts[1], parts[3] || ''].join(':');
}

/**
 * Sloučí knihovny vanilly a Fabricu do jednoho seznamu artefaktů ke stažení.
 * Vrací { classpath: [{path,url,sha1,size}], natives: [{path,url,sha1,size,exclude}] }.
 */
function collectLibraries(dirs, vanilla, fabric, env = currentOs()) {
  const byKey = new Map();
  const natives = [];

  const add = (lib, source) => {
    if (!allowed(lib.rules, env)) return;
    const art = lib.downloads && lib.downloads.artifact;
    if (art || source === 'fabric' || lib.url) {
      const rel = (art && art.path) || mavenPath(lib.name);
      const base = (lib.url || 'https://libraries.minecraft.net/').replace(/\/?$/, '/');
      const entry = {
        name: lib.name,
        path: path.join(dirs.libraries, rel),
        url: (art && art.url) || base + rel,
        sha1: (art && art.sha1) || lib.sha1,
        size: (art && art.size) || lib.size
      };
      // Novější formát: nativní knihovny jsou samostatné artefakty s klasifikátorem natives-*
      const isNative = /:natives-/.test(lib.name);
      byKey.set(libKey(lib.name), entry);
      if (isNative) natives.push({ ...entry, exclude: (lib.extract && lib.extract.exclude) || ['META-INF/'] });
    }
    // Starší formát nativních knihoven (classifiers)
    if (lib.natives && lib.downloads && lib.downloads.classifiers) {
      const clsName = (lib.natives[env.name] || '').replace('${arch}', env.arch === 'x64' ? '64' : '32');
      const cls = lib.downloads.classifiers[clsName];
      if (cls) {
        natives.push({
          name: lib.name + ':' + clsName,
          path: path.join(dirs.libraries, cls.path),
          url: cls.url,
          sha1: cls.sha1,
          size: cls.size,
          exclude: (lib.extract && lib.extract.exclude) || ['META-INF/']
        });
      }
    }
  };

  for (const lib of vanilla.libraries || []) add(lib, 'vanilla');
  for (const lib of (fabric && fabric.libraries) || []) add(lib, 'fabric');
  return { classpath: [...byKey.values()], natives };
}

async function extractNatives(natives, dir) {
  await fs.promises.rm(dir, { recursive: true, force: true });
  await fs.promises.mkdir(dir, { recursive: true });
  for (const n of natives) {
    const zip = new AdmZip(n.path);
    for (const e of zip.getEntries()) {
      if (e.isDirectory) continue;
      if ((n.exclude || []).some((x) => e.entryName.startsWith(x))) continue;
      if (!/\.(dll|so|dylib|jnilib)$/i.test(e.entryName)) continue;
      await fs.promises.writeFile(path.join(dir, path.basename(e.entryName)), e.getData());
    }
  }
}

async function installAssets(dirs, vanilla, progress) {
  const idx = vanilla.assetIndex;
  const indexFile = path.join(dirs.assets, 'indexes', `${idx.id}.json`);
  await download(idx.url, indexFile, { sha1: idx.sha1, size: idx.size });
  const index = await readJson(indexFile);
  const objects = Object.values(index.objects);
  let done = 0;
  await pool(objects, 16, async (o) => {
    const sub = o.hash.slice(0, 2);
    await download(`${RESOURCES}/${sub}/${o.hash}`, path.join(dirs.assets, 'objects', sub, o.hash), { sha1: o.hash, size: o.size });
    done++;
    if (done % 50 === 0 || done === objects.length) progress({ stage: 'assets', text: 'Stahuji zvuky a textury…', done, total: objects.length });
  });
}

/**
 * Nainstaluje (nebo ověří) hru. Vrací vše potřebné ke spuštění.
 */
async function install(dirs, { mcVersion, fabricLoader }, progress = () => {}) {
  progress({ stage: 'meta', text: 'Zjišťuji verzi hry…', done: 0, total: 1 });
  const vanilla = await vanillaJson(dirs, mcVersion);
  const fabric = await fabricJson(dirs, mcVersion, fabricLoader);

  // Klientský JAR
  const client = vanilla.downloads.client;
  const clientJar = path.join(dirs.versions, mcVersion, `${mcVersion}.jar`);
  progress({ stage: 'client', text: 'Stahuji Minecraft…', done: 0, total: 1 });
  await download(client.url, clientJar, { sha1: client.sha1, size: client.size });

  // Knihovny
  const libs = collectLibraries(dirs, vanilla, fabric);
  const all = [...libs.classpath, ...libs.natives.filter((n) => !libs.classpath.some((c) => c.path === n.path))];
  let done = 0;
  await pool(all, 10, async (l) => {
    await download(l.url, l.path, { sha1: l.sha1, size: l.size });
    done++;
    progress({ stage: 'libraries', text: 'Stahuji knihovny…', done, total: all.length });
  });

  // Nativní knihovny
  const nativesDir = dirs.natives(mcVersion);
  await extractNatives(libs.natives, nativesDir);

  // Assety
  await installAssets(dirs, vanilla, progress);

  // Konfigurace logování
  let logging = null;
  const lc = vanilla.logging && vanilla.logging.client;
  if (lc && lc.file) {
    const logFile = path.join(dirs.assets, 'log_configs', lc.file.id);
    await download(lc.file.url, logFile, { sha1: lc.file.sha1, size: lc.file.size });
    logging = lc.argument.replace('${path}', logFile);
  }

  return { vanilla, fabric, clientJar, libs, nativesDir, logging };
}

module.exports = { install, collectLibraries, libKey, resolveLoader, vanillaJson, fabricJson };
