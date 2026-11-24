'use strict';
// Úprava jednotlivých voleb v options.txt hry (ostatní řádky zůstanou beze změny).

const fs = require('fs');
const path = require('path');

/** values: { lang: 'cs_cz', fullscreen: 'true' } – zapíše jen to, co se liší. Vrací true, když se soubor změnil. */
function setOptions(gameDir, values) {
  const file = path.join(gameDir, 'options.txt');
  let lines = [];
  try {
    lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  } catch {
    /* první spuštění – hra si ostatní volby doplní sama */
  }
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  let changed = false;
  for (const [key, value] of Object.entries(values)) {
    const line = `${key}:${value}`;
    const i = lines.findIndex((l) => l.startsWith(key + ':'));
    if (i === -1) {
      lines.push(line);
      changed = true;
    } else if (lines[i] !== line) {
      lines[i] = line;
      changed = true;
    }
  }
  if (changed) {
    fs.mkdirSync(gameDir, { recursive: true });
    fs.writeFileSync(file, lines.join('\n') + '\n');
  }
  return changed;
}

const GAME_LANG = { cs: 'cs_cz', sk: 'sk_sk', en: 'en_us' };

function parseList(v) {
  try {
    const a = JSON.parse(v);
    return Array.isArray(a) ? a.map(String) : [];
  } catch {
    return [];
  }
}

/**
 * Zapne resource pack (např. file/wylvarion-menu.zip) v options.txt. Dá ho těsně pod `below`
 * (pokud je v seznamu), jinak nahoru. Vlastní packy hráče zůstanou.
 */
function enablePack(gameDir, packId, below) {
  const file = path.join(gameDir, 'options.txt');
  let lines = [];
  try {
    lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  } catch {
    /* první spuštění */
  }
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  const i = lines.findIndex((l) => l.startsWith('resourcePacks:'));
  const packs = i === -1 ? ['vanilla'] : parseList(lines[i].slice('resourcePacks:'.length));
  if (packs.includes(packId)) return false;
  const at = below && packs.includes(below) ? packs.indexOf(below) : packs.length;
  packs.splice(at, 0, packId);
  const line = `resourcePacks:${JSON.stringify(packs)}`;
  if (i === -1) lines.push(line);
  else lines[i] = line;
  fs.mkdirSync(gameDir, { recursive: true });
  fs.writeFileSync(file, lines.join('\n') + '\n');
  return true;
}

/**
 * Dynamic FPS: když okno hry není aktivní, sníží FPS až na 1 – intro a menu pak trhaně „lagují“.
 * Nastavíme neaktivní okno na 60 FPS (jen když je nižší). Soubor si mod vytvoří sám při prvním spuštění.
 */
function tuneDynamicFps(gameDir) {
  const file = path.join(gameDir, 'config', 'dynamic_fps.json');
  let cfg;
  try {
    cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return false;
  }
  const st = cfg.states || (cfg.states = {});
  let changed = false;
  for (const name of ['unfocused', 'hovered']) {
    const s = st[name] || (st[name] = {});
    if (!(typeof s.frame_rate_target === 'number' && s.frame_rate_target >= 60)) {
      s.frame_rate_target = 60;
      changed = true;
    }
  }
  if (changed) fs.writeFileSync(file, JSON.stringify(cfg, null, 4));
  return changed;
}

module.exports = { setOptions, enablePack, tuneDynamicFps, GAME_LANG };
