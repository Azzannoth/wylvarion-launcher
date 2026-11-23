'use strict';
// Skiny a pláště přes oficiální Minecraft API (mění se na celém účtu)
// a knihovna uložených skinů v počítači hráče.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { request, getJson } = require('./http');

const API = 'https://api.minecraftservices.com/minecraft/profile';

/** Rozměry PNG z hlavičky. Skin musí být 64×64 (nebo starý formát 64×32). */
function pngSize(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 24) return null;
  if (buf.readUInt32BE(0) !== 0x89504e47 || buf.toString('ascii', 12, 16) !== 'IHDR') return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function checkSkin(buf) {
  const s = pngSize(buf);
  if (!s) throw new Error('Soubor není PNG obrázek.');
  if (!(s.width === 64 && (s.height === 64 || s.height === 32))) {
    throw new Error(`Skin musí mít rozměr 64×64 pixelů (tenhle má ${s.width}×${s.height}).`);
  }
  if (buf.length > 24 * 1024) throw new Error('Soubor skinu je moc velký (max. 24 kB).');
}

function apiError(res, body, fallback) {
  let msg = fallback;
  try {
    const j = JSON.parse(body);
    if (j.errorMessage) msg = `${fallback} (${j.errorMessage})`;
  } catch {
    /* není JSON */
  }
  if (res.status === 401) msg = 'Přihlášení vypršelo, přihlas se prosím znovu.';
  if (res.status === 429) msg = 'Moc změn najednou. Mojang dovolí skin měnit jen pár krát za minutu, zkus to za chvíli.';
  return Object.assign(new Error(msg), { status: res.status, code: res.status === 401 ? 'LOGIN' : undefined });
}

const auth = (token) => ({ Authorization: `Bearer ${token}` });

/** Jeden pokus bez opakování (změnu skinu nechceme poslat dvakrát). */
async function call(url, opts, fallback) {
  let res;
  try {
    res = await request(url, opts, 1);
  } catch (e) {
    if (e.status) throw apiError({ status: e.status }, '', fallback);
    throw new Error(`${fallback}: Mojang neodpovídá, zkontroluj připojení k internetu.`);
  }
  const body = await res.text();
  if (!res.ok) throw apiError(res, body, fallback);
  return JSON.parse(body);
}

async function profile(token) {
  return getJson(API, { headers: auth(token) });
}

/** Nahraje skin na účet. variant: 'classic' | 'slim'. Vrací nový profil. */
async function upload(token, png, variant) {
  checkSkin(png);
  const form = new FormData();
  form.append('variant', variant === 'slim' ? 'slim' : 'classic');
  form.append('file', new Blob([png], { type: 'image/png' }), 'skin.png');
  return call(`${API}/skins`, { method: 'POST', headers: auth(token), body: form }, 'Skin se nepodařilo nastavit');
}

/** Nastaví plášť (capeId) nebo ho schová (null). Vrací nový profil. */
async function setCape(token, capeId) {
  const opts = capeId
    ? { method: 'PUT', headers: { ...auth(token), 'Content-Type': 'application/json' }, body: JSON.stringify({ capeId }) }
    : { method: 'DELETE', headers: auth(token) };
  return call(`${API}/capes/active`, opts, 'Plášť se nepodařilo nastavit');
}

/** Stáhne texturu a vrátí ji jako data URL (okno launcheru nesmí načítat cizí obrázky). */
async function textureDataUrl(url) {
  if (!url) return null;
  const res = await request(url.replace(/^http:/, 'https:'));
  if (!res.ok) return null;
  return `data:image/png;base64,${Buffer.from(await res.arrayBuffer()).toString('base64')}`;
}

function activeSkin(p) {
  const s = (p.skins || []).find((x) => x.state === 'ACTIVE') || (p.skins || [])[0];
  return s ? { url: s.url, variant: s.variant } : null;
}

// --- knihovna uložených skinů ---
function library(dir) {
  const indexFile = path.join(dir, 'index.json');
  const read = () => {
    try {
      const list = JSON.parse(fs.readFileSync(indexFile, 'utf8'));
      return Array.isArray(list) ? list : [];
    } catch {
      return [];
    }
  };
  const write = (list) => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(indexFile, JSON.stringify(list, null, 2));
  };
  return {
    list() {
      return read()
        .map((s) => {
          try {
            const png = fs.readFileSync(path.join(dir, s.file));
            return { ...s, dataUrl: `data:image/png;base64,${png.toString('base64')}` };
          } catch {
            return null;
          }
        })
        .filter(Boolean);
    },
    get(id) {
      const s = read().find((x) => x.id === id);
      if (!s) throw new Error('Skin v knihovně nenalezen.');
      return { ...s, png: fs.readFileSync(path.join(dir, s.file)) };
    },
    add(png, name, variant) {
      checkSkin(png);
      const hash = crypto.createHash('sha1').update(png).digest('hex');
      const list = read();
      const existing = list.find((x) => x.hash === hash);
      if (existing) {
        existing.name = name || existing.name;
        existing.variant = variant;
        write(list);
        return existing.id;
      }
      const id = hash.slice(0, 12);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, `${id}.png`), png);
      list.unshift({ id, hash, file: `${id}.png`, name: String(name || 'Skin').slice(0, 32), variant: variant === 'slim' ? 'slim' : 'classic', added: new Date().toISOString() });
      write(list);
      return id;
    },
    remove(id) {
      const list = read();
      const s = list.find((x) => x.id === id);
      if (!s) return;
      fs.rmSync(path.join(dir, s.file), { force: true });
      write(list.filter((x) => x.id !== id));
    }
  };
}

module.exports = { pngSize, checkSkin, profile, upload, setCape, textureDataUrl, activeSkin, library };
