'use strict';
// Přednahrání resource packu serveru do mezipaměti hry, aby se při připojení
// na server už nestahoval.
//
// Minecraft ukládá server packy do  <hra>/downloads/<UUID packu>/<sha1>  a když tam
// při připojení najde soubor se stejným SHA-1, jaký poslal server, použije ho.
// UUID určuje server: Paper pro pack poslaný přes URL používá
// UUID.nameUUIDFromBytes(url). Kdyby plugin použil jiné, launcher si ho zapamatuje
// po prvním připojení (najde složku, ve které hra pack uložila).

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { request, download, sha1File } = require('./http');

/** Java UUID.nameUUIDFromBytes (verze 3, MD5). */
function nameUuid(text) {
  const b = crypto.createHash('md5').update(Buffer.from(text, 'utf8')).digest();
  b[6] = (b[6] & 0x0f) | 0x30;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function readState(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
}

/** Najde složky v downloads/, kam hra dřív uložila některou z našich verzí packu. */
function learnIds(downloadsDir, knownHashes) {
  const found = new Set();
  let dirs = [];
  try {
    dirs = fs.readdirSync(downloadsDir, { withFileTypes: true }).filter((d) => d.isDirectory() && UUID_RE.test(d.name));
  } catch {
    return found;
  }
  for (const d of dirs) {
    try {
      if (fs.readdirSync(path.join(downloadsDir, d.name)).some((f) => knownHashes.has(f.toLowerCase()))) found.add(d.name.toLowerCase());
    } catch {
      /* nečitelná složka */
    }
  }
  return found;
}

/**
 * Stáhne pack (jen když se změnil) a uloží ho do mezipaměti hry.
 * rp: { url, ids?: [UUID] }  dirs: { root, game }
 * Vrací { sha1, ids, downloaded }.
 */
async function prefetch(dirs, rp, progress = () => {}) {
  if (!rp || !rp.url) return null;
  const cacheDir = path.join(dirs.root, 'serverpack');
  const stateFile = path.join(cacheDir, 'state.json');
  const downloadsDir = path.join(dirs.game, 'downloads');
  const state = readState(stateFile);
  fs.mkdirSync(cacheDir, { recursive: true });

  // Změnil se pack? Porovnáme velikost a ETag/Last-Modified (HEAD, bez stahování).
  let meta = null;
  try {
    const res = await request(rp.url, { method: 'HEAD', timeout: 15000 }, 2);
    if (res.ok) meta = { size: res.headers.get('content-length'), etag: res.headers.get('etag') || res.headers.get('last-modified') };
  } catch {
    /* bez internetu použijeme, co máme */
  }
  let sha1 = state.sha1;
  let master = sha1 && path.join(cacheDir, `${sha1}.zip`);
  const same = meta && state.meta && meta.size === state.meta.size && meta.etag === state.meta.etag && state.url === rp.url;
  let downloaded = false;
  if (!master || !fs.existsSync(master) || (meta && !same)) {
    if (!meta && master && fs.existsSync(master)) {
      /* offline, necháme starý */
    } else {
      progress({ stage: 'pack', text: 'Stahuji resource pack serveru…', done: 0, total: 1 });
      const tmp = path.join(cacheDir, 'download.zip');
      await fs.promises.rm(tmp, { force: true });
      await download(rp.url, tmp);
      sha1 = (await sha1File(tmp)).toLowerCase();
      master = path.join(cacheDir, `${sha1}.zip`);
      await fs.promises.rename(tmp, master);
      downloaded = true;
      // staré kopie v mezipaměti launcheru smažeme
      for (const f of fs.readdirSync(cacheDir)) {
        if (/^[0-9a-f]{40}\.zip$/.test(f) && f !== `${sha1}.zip`) fs.rmSync(path.join(cacheDir, f), { force: true });
      }
    }
  }
  if (!sha1 || !master || !fs.existsSync(master)) return null;

  const history = new Set([...(state.history || []), sha1].slice(-10));
  const ids = new Set([nameUuid(rp.url), ...(rp.ids || []).map((x) => String(x).toLowerCase()), ...(state.ids || []), ...learnIds(downloadsDir, history)]);
  for (const id of ids) {
    if (!UUID_RE.test(id)) continue;
    const dest = path.join(downloadsDir, id, sha1);
    try {
      const st = fs.statSync(dest);
      if (st.size === fs.statSync(master).size) continue;
    } catch {
      /* soubor ještě není */
    }
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(master, dest);
  }
  fs.writeFileSync(stateFile, JSON.stringify({ url: rp.url, sha1, meta: meta || state.meta || null, ids: [...ids], history: [...history] }, null, 2));
  return { sha1, ids: [...ids], downloaded, master };
}

const LOCAL_NAME = 'wylvarion-server.zip';
const LOCAL_ID = `file/${LOCAL_NAME}`;

/** Načte seznam z řádku options.txt (JSON pole). */
function parseList(line) {
  try {
    const v = JSON.parse(line);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

/**
 * Nainstaluje pack jako normální resource pack hry (resourcepacks/ + options.txt),
 * takže se načte už při startu hry a při připojení na server se nic nestahuje ani nenačítá.
 */
function installLocal(dirs, master) {
  const packsDir = path.join(dirs.game, 'resourcepacks');
  const dest = path.join(packsDir, LOCAL_NAME);
  fs.mkdirSync(packsDir, { recursive: true });
  let same = false;
  try {
    same = fs.statSync(dest).size === fs.statSync(master).size && fs.readFileSync(dest).equals(fs.readFileSync(master));
  } catch {
    /* ještě není */
  }
  if (!same) {
    const tmp = dest + '.tmp';
    fs.copyFileSync(master, tmp);
    fs.renameSync(tmp, dest);
  }

  const optionsFile = path.join(dirs.game, 'options.txt');
  let lines = [];
  try {
    lines = fs.readFileSync(optionsFile, 'utf8').split(/\r?\n/);
  } catch {
    /* první spuštění – hra si ostatní volby doplní sama */
  }
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  const idx = lines.findIndex((l) => l.startsWith('resourcePacks:'));
  const packs = idx === -1 ? ['vanilla'] : parseList(lines[idx].slice('resourcePacks:'.length));
  // náš pack úplně nahoru (poslední v seznamu = nejvyšší priorita), vlastní packy hráče zůstanou
  const next = [...packs.filter((p) => p !== LOCAL_ID), LOCAL_ID];
  const line = `resourcePacks:${JSON.stringify(next)}`;
  let changed = false;
  if (idx === -1) {
    lines.push(line);
    changed = true;
  } else if (lines[idx] !== line) {
    lines[idx] = line;
    changed = true;
  }
  // Pack nesmí být v seznamu nekompatibilních: když je kompatibilní, Minecraft ho
  // z toho seznamu vyřadí a zároveň ho nezapne (Options.loadSelectedResourcePacks).
  const inc = lines.findIndex((l) => l.startsWith('incompatibleResourcePacks:'));
  if (inc !== -1) {
    const incList = parseList(lines[inc].slice('incompatibleResourcePacks:'.length));
    if (incList.includes(LOCAL_ID)) {
      lines[inc] = `incompatibleResourcePacks:${JSON.stringify(incList.filter((p) => p !== LOCAL_ID))}`;
      changed = true;
    }
  }
  if (changed) fs.writeFileSync(optionsFile, lines.join('\n') + '\n');
  return { changed: changed || !same };
}

/** Vypne dřív nainstalovaný pack serveru v options.txt (soubor nechá, nevadí). */
function uninstallLocal(dirs) {
  const optionsFile = path.join(dirs.game, 'options.txt');
  let text;
  try {
    text = fs.readFileSync(optionsFile, 'utf8');
  } catch {
    return false;
  }
  const lines = text.split(/\r?\n/);
  const idx = lines.findIndex((l) => l.startsWith('resourcePacks:'));
  if (idx === -1) return false;
  const packs = parseList(lines[idx].slice('resourcePacks:'.length));
  if (!packs.includes(LOCAL_ID)) return false;
  lines[idx] = `resourcePacks:${JSON.stringify(packs.filter((p) => p !== LOCAL_ID))}`;
  fs.writeFileSync(optionsFile, lines.join('\n'));
  return true;
}

module.exports = { prefetch, installLocal, uninstallLocal, nameUuid, learnIds, LOCAL_ID };
