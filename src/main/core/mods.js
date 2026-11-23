'use strict';
// Mody a shadery z Modrinthu.
// Launcher si pamatuje, které soubory v mods/ nainstaloval sám (managed.json),
// takže vlastní .jar soubory hráče nikdy nemaže.

const fs = require('fs');
const path = require('path');
const { getJson, download, pool } = require('./http');

const API = 'https://api.modrinth.com/v2';

function q(obj) {
  return encodeURIComponent(JSON.stringify(obj));
}

/** Najde nejnovější verzi projektu pro danou verzi hry a loader. */
async function latestVersion(projectId, gameVersion, loaders) {
  const list = await getJson(`${API}/project/${encodeURIComponent(projectId)}/version?loaders=${q(loaders)}&game_versions=${q([gameVersion])}`);
  if (!list.length) return null;
  return list.find((v) => v.version_type === 'release') || list[0];
}

function primaryFile(version) {
  return version.files.find((f) => f.primary) || version.files[0];
}

async function versionById(id) {
  return getJson(`${API}/version/${encodeURIComponent(id)}`);
}

/** Konkrétní verze projektu podle ID verze nebo čísla verze (připnutí v konfiguraci). */
async function pinnedVersion(projectId, version) {
  try {
    return await versionById(version);
  } catch {
    return getJson(`${API}/project/${encodeURIComponent(projectId)}/version/${encodeURIComponent(version)}`);
  }
}

function fileEntry(v, m) {
  const f = primaryFile(v);
  return {
    projectId: v.project_id,
    versionId: v.id,
    slug: m.id,
    name: m.name,
    version: v.version_number,
    filename: f.filename,
    url: f.url,
    sha1: f.hashes && f.hashes.sha1,
    size: f.size
  };
}

/**
 * Sestaví seznam souborů k instalaci včetně povinných závislostí.
 * wanted: [{id, name, required, version?}] – vybrané mody; version připne konkrétní verzi.
 * Když mod v závislostech předepisuje přesnou verzi jiného modu (např. Iris → Sodium),
 * použije se ta, ne nejnovější. Jinak by se hra nespustila kvůli nekompatibilitě.
 * Vrací { files: [{projectId, versionId, name, filename, url, sha1, size}], missing: [{id, name}] }.
 */
async function resolve(wanted, gameVersion, loader = 'fabric') {
  const files = new Map(); // projectId -> soubor
  const missing = [];
  const pins = new Map(); // projectId -> versionId předepsané závislostí
  const queue = wanted.map((m) => ({ id: m.id, name: m.name || m.id, version: m.version }));
  const seen = new Set();

  const noteDeps = (v) => {
    for (const dep of v.dependencies || []) {
      if (dep.dependency_type !== 'required') continue;
      if (dep.version_id && dep.project_id) pins.set(dep.project_id, dep.version_id);
      if (dep.project_id && !seen.has(dep.project_id) && !files.has(dep.project_id)) {
        queue.push({ id: dep.project_id, name: dep.project_id, dependency: true });
      }
    }
  };

  while (queue.length) {
    const batch = queue.splice(0, 8).filter((m) => !seen.has(m.id));
    batch.forEach((m) => seen.add(m.id));
    await Promise.all(
      batch.map(async (m) => {
        let v;
        try {
          v = m.version ? await pinnedVersion(m.id, m.version) : await latestVersion(m.id, gameVersion, [loader]);
        } catch {
          v = null;
        }
        if (!v) {
          // Hlásíme jen mody ze seznamu. Chybějící závislost bývá chyba v metadatech
          // (např. Zoomify uvádí KotlinLangForge pro Forge i u Fabric verze) a hra jede i bez ní.
          if (!m.dependency) missing.push(m);
          return;
        }
        if (!files.has(v.project_id)) files.set(v.project_id, fileEntry(v, m));
        seen.add(v.project_id);
        noteDeps(v);
      })
    );
  }

  // Přesné verze, které si vyžádaly závislosti.
  for (const [projectId, versionId] of pins) {
    const cur = files.get(projectId);
    if (!cur || cur.versionId === versionId) continue;
    try {
      const v = await versionById(versionId);
      if (!(v.loaders || []).includes(loader) || !(v.game_versions || []).includes(gameVersion)) continue;
      files.set(projectId, fileEntry(v, { id: cur.slug, name: cur.name }));
    } catch {
      /* předepsanou verzi se nepodařilo načíst, necháme nejnovější */
    }
  }
  return { files: [...files.values()], missing };
}

async function readManaged(modsDir) {
  try {
    return JSON.parse(await fs.promises.readFile(path.join(modsDir, '.wylvarion-managed.json'), 'utf8'));
  } catch {
    return { files: [] };
  }
}

/**
 * Synchronizuje složku mods/: stáhne chybějící, smaže staré verze, které launcher dřív nainstaloval.
 */
async function sync(modsDir, files, progress = () => {}) {
  await fs.promises.mkdir(modsDir, { recursive: true });
  const managed = await readManaged(modsDir);
  const keep = new Set(files.map((f) => f.filename));
  for (const old of managed.files || []) {
    if (!keep.has(old)) await fs.promises.rm(path.join(modsDir, old), { force: true });
  }
  let done = 0;
  await pool(files, 6, async (f) => {
    await download(f.url, path.join(modsDir, f.filename), { sha1: f.sha1, size: f.size });
    done++;
    progress({ stage: 'mods', text: 'Stahuji mody…', done, total: files.length });
  });
  await fs.promises.writeFile(
    path.join(modsDir, '.wylvarion-managed.json'),
    JSON.stringify({ updated: new Date().toISOString(), files: files.map((f) => f.filename) }, null, 2)
  );
}

/** Seznam vlastních .jar souborů hráče (ty, které neinstaloval launcher). */
async function customMods(modsDir) {
  const managed = new Set((await readManaged(modsDir)).files || []);
  try {
    return (await fs.promises.readdir(modsDir)).filter((f) => /\.jar(\.disabled)?$/i.test(f) && !managed.has(f));
  } catch {
    return [];
  }
}

async function search(query, gameVersion) {
  const facets = q([['categories:fabric'], [`versions:${gameVersion}`], ['project_type:mod']]);
  const res = await getJson(`${API}/search?query=${encodeURIComponent(query)}&limit=20&facets=${facets}`);
  return res.hits.map((h) => ({ id: h.slug, name: h.title, desc: h.description, icon: h.icon_url, downloads: h.downloads }));
}

/**
 * Stáhne shader pack a nastaví ho v Iris. id=null shadery vypne.
 */
async function applyShader(dirs, shaderId, gameVersion) {
  const irisCfg = path.join(dirs.config, 'iris.properties');
  await fs.promises.mkdir(dirs.config, { recursive: true });
  let props = {};
  try {
    for (const line of (await fs.promises.readFile(irisCfg, 'utf8')).split(/\r?\n/)) {
      const m = line.match(/^([^#=]+)=(.*)$/);
      if (m) props[m[1].trim()] = m[2].trim();
    }
  } catch {
    /* soubor ještě neexistuje */
  }
  if (!shaderId) {
    props.enableShaders = 'false';
  } else {
    let v = null;
    for (const gv of [gameVersion, null]) {
      const url = `${API}/project/${encodeURIComponent(shaderId)}/version?loaders=${q(['iris'])}${gv ? `&game_versions=${q([gv])}` : ''}`;
      const list = await getJson(url).catch(() => []);
      if (list.length) {
        v = list[0];
        break;
      }
    }
    if (!v) throw new Error(`Shader „${shaderId}“ se nepodařilo najít.`);
    const f = primaryFile(v);
    await download(f.url, path.join(dirs.shaderpacks, f.filename), { sha1: f.hashes && f.hashes.sha1, size: f.size });
    props.shaderPack = f.filename;
    props.enableShaders = 'true';
  }
  const out = Object.entries(props).map(([k, val]) => `${k}=${val}`).join('\n') + '\n';
  await fs.promises.writeFile(irisCfg, out);
  return props.shaderPack || null;
}

/** Odhad výkonu grafiky z informací o GPU (Electron app.getGPUInfo). */
function gpuTier(gpuInfo) {
  const devices = (gpuInfo && gpuInfo.gpuDevice) || [];
  const names = devices
    .map((d) => `${d.vendorString || ''} ${d.deviceString || ''} ${d.driverVendor || ''}`)
    .join(' ')
    .toLowerCase();
  const ids = devices.map((d) => d.vendorId);
  const hasNvidia = ids.includes(0x10de) || /nvidia|geforce|rtx|gtx/.test(names);
  const hasAmdDiscrete = /radeon (rx|pro)|rx \d{3,4}/.test(names);
  const appleHigh = /apple m\d (pro|max|ultra)/.test(names);
  if (/rtx|rx 6[7-9]|rx 7|rx 9|gtx 1[06-8]|gtx 16/.test(names) || appleHigh) return 'high';
  if (hasNvidia || hasAmdDiscrete || /apple m\d/.test(names) || /arc a\d/.test(names)) return 'medium';
  return 'low';
}

module.exports = { resolve, sync, customMods, search, applyShader, gpuTier, latestVersion };
