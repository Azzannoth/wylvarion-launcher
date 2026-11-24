'use strict';
// Intro Wylvarionu pro mod Reimagined Intro.
// Mod hledá balíčky v  <hra>/intros/  a aktivní vybírá v  config/reimagined-intro.json  (selectedPack).
// Balíček je na GitHubu rozdělený na části (manifest.json + part_00, part_01 …), launcher je spojí,
// ověří SHA-1 a uloží jako jeden .zip. Stahuje jen když se změnil.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { getJson, download, sha1File } = require('./http');

const FILE_NAME = 'wylvarion-intro.zip';
const MOJANG_PACK = 'mojang_reimagined';

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/** Nastaví vybraný balíček v configu modu, ostatní volby hráče nechá. */
function selectPack(gameDir, packId) {
  const file = path.join(gameDir, 'config', 'reimagined-intro.json');
  const cfg = readJson(file) || {};
  const next = { ...cfg, selectedPack: packId, enableIntro: true };
  if (cfg.enableTitleScreenLoop === undefined) next.enableTitleScreenLoop = true;
  if (JSON.stringify(next) === JSON.stringify(cfg)) return false;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(next, null, 2));
  return true;
}

/**
 * Připraví intro. choice: 'wylvarion' (náš balíček) nebo 'mojang' (původní z modu).
 * intro: { manifest: URL manifest.json }  dirs: { root, game }
 */
async function prepare(dirs, intro, choice, progress = () => {}) {
  if (choice === 'mojang' || !intro || !intro.manifest) {
    selectPack(dirs.game, MOJANG_PACK);
    return { pack: MOJANG_PACK, downloaded: false };
  }
  const base = intro.manifest.replace(/[^/]*$/, '');
  const introsDir = path.join(dirs.game, 'intros');
  const dest = path.join(introsDir, FILE_NAME);
  const stateFile = path.join(dirs.root, 'intro-state.json');
  const state = readJson(stateFile) || {};

  let manifest = null;
  try {
    manifest = await getJson(intro.manifest, { timeout: 15000 });
  } catch {
    /* bez internetu: použijeme, co už máme */
  }
  const have = fs.existsSync(dest) && state.sha1;
  if (!manifest) {
    if (have) selectPack(dirs.game, state.id);
    return { pack: have ? state.id : null, downloaded: false };
  }

  let downloaded = false;
  if (!have || state.sha1 !== manifest.sha1 || fs.statSync(dest).size !== manifest.size) {
    const tmpDir = path.join(dirs.root, 'intro-download');
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
    fs.mkdirSync(tmpDir, { recursive: true });
    const parts = manifest.parts && manifest.parts.length ? manifest.parts : [manifest.file];
    for (let i = 0; i < parts.length; i++) {
      progress({ stage: 'intro', text: `Stahuji intro Wylvarionu… (${i + 1}/${parts.length})`, done: i, total: parts.length });
      await download(base + parts[i], path.join(tmpDir, parts[i]));
    }
    // spojit části a ověřit
    const joined = path.join(tmpDir, FILE_NAME);
    const out = fs.createWriteStream(joined);
    for (const p of parts) {
      await new Promise((res, rej) => {
        const r = fs.createReadStream(path.join(tmpDir, p));
        r.on('error', rej);
        r.on('end', res);
        r.pipe(out, { end: false });
      });
    }
    await new Promise((res) => out.end(res));
    const sha1 = (await sha1File(joined)).toLowerCase();
    if (sha1 !== String(manifest.sha1).toLowerCase()) {
      await fs.promises.rm(tmpDir, { recursive: true, force: true });
      throw new Error('Intro se nestáhlo celé, zkusí se to příště znovu.');
    }
    fs.mkdirSync(introsDir, { recursive: true });
    await fs.promises.rm(dest, { force: true });
    await fs.promises.rename(joined, dest);
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
    fs.writeFileSync(stateFile, JSON.stringify({ id: manifest.id, sha1, version: manifest.version }, null, 2));
    downloaded = true;
  }
  selectPack(dirs.game, manifest.id);
  return { pack: manifest.id, downloaded };
}

/**
 * Pozadí menu (panorama z intra) jako resource pack. Stáhne se jen při změně, vrací cestu k souboru nebo null.
 * intro: { manifest }  – v manifestu je pole menu: { file, size, sha1 }
 */
async function prepareMenu(dirs, intro) {
  if (!intro || !intro.manifest) return null;
  const dest = path.join(dirs.game, 'resourcepacks', MENU_FILE);
  let manifest;
  try {
    manifest = await getJson(intro.manifest, { timeout: 15000 });
  } catch {
    return fs.existsSync(dest) ? dest : null;
  }
  const m = manifest && manifest.menu;
  if (!m) return null;
  const base = intro.manifest.replace(/[^/]*$/, '');
  await download(base + m.file, dest, { sha1: m.sha1, size: m.size });
  return dest;
}

const MENU_FILE = 'wylvarion-menu.zip';

module.exports = { prepare, prepareMenu, MENU_FILE, selectPack, MOJANG_PACK, FILE_NAME, _sha1: (b) => crypto.createHash('sha1').update(b).digest('hex') };
