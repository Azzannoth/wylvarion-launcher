'use strict';
// Zápis servers.dat: přidá server Wylvarion do seznamu serverů a nastaví
// „Resource packy serveru: Povolit“, aby se serverový resource pack stáhl
// sám bez dotazu. Ostatní servery hráče zůstanou beze změny.

const fs = require('fs');
const path = require('path');

// --- minimální NBT (nekomprimované, big-endian) ---
const T = { END: 0, BYTE: 1, SHORT: 2, INT: 3, LONG: 4, FLOAT: 5, DOUBLE: 6, BYTE_ARRAY: 7, STRING: 8, LIST: 9, COMPOUND: 10, INT_ARRAY: 11, LONG_ARRAY: 12 };

function reader(buf) {
  let o = 0;
  const r = {
    u8: () => buf.readUInt8(o++),
    i8: () => buf.readInt8(o++),
    i16: () => { const v = buf.readInt16BE(o); o += 2; return v; },
    u16: () => { const v = buf.readUInt16BE(o); o += 2; return v; },
    i32: () => { const v = buf.readInt32BE(o); o += 4; return v; },
    i64: () => { const v = buf.readBigInt64BE(o); o += 8; return v; },
    f32: () => { const v = buf.readFloatBE(o); o += 4; return v; },
    f64: () => { const v = buf.readDoubleBE(o); o += 8; return v; },
    str: () => { const n = r.u16(); const s = buf.toString('utf8', o, o + n); o += n; return s; }
  };
  function payload(t) {
    switch (t) {
      case T.BYTE: return r.i8();
      case T.SHORT: return r.i16();
      case T.INT: return r.i32();
      case T.LONG: return r.i64();
      case T.FLOAT: return r.f32();
      case T.DOUBLE: return r.f64();
      case T.BYTE_ARRAY: { const n = r.i32(); const a = []; for (let i = 0; i < n; i++) a.push(r.i8()); return a; }
      case T.STRING: return r.str();
      case T.LIST: { const et = r.u8(); const n = r.i32(); const items = []; for (let i = 0; i < n; i++) items.push(payload(et)); return { type: et, items }; }
      case T.COMPOUND: { const c = []; for (;;) { const ct = r.u8(); if (ct === T.END) break; const name = r.str(); c.push({ type: ct, name, value: payload(ct) }); } return c; }
      case T.INT_ARRAY: { const n = r.i32(); const a = []; for (let i = 0; i < n; i++) a.push(r.i32()); return a; }
      case T.LONG_ARRAY: { const n = r.i32(); const a = []; for (let i = 0; i < n; i++) a.push(r.i64()); return a; }
      default: throw new Error('Neznámý NBT typ ' + t);
    }
  }
  return {
    root() {
      const t = r.u8();
      if (t !== T.COMPOUND) throw new Error('servers.dat nemá kořenový compound');
      const name = r.str();
      return { name, value: payload(T.COMPOUND) };
    }
  };
}

function writer() {
  const parts = [];
  const push = (b) => parts.push(b);
  const num = (fn, size, v) => { const b = Buffer.alloc(size); b[fn](v, 0); push(b); };
  const str = (s) => { const b = Buffer.from(s, 'utf8'); num('writeUInt16BE', 2, b.length); push(b); };
  function payload(t, v) {
    switch (t) {
      case T.BYTE: return num('writeInt8', 1, v);
      case T.SHORT: return num('writeInt16BE', 2, v);
      case T.INT: return num('writeInt32BE', 4, v);
      case T.LONG: return num('writeBigInt64BE', 8, v);
      case T.FLOAT: return num('writeFloatBE', 4, v);
      case T.DOUBLE: return num('writeDoubleBE', 8, v);
      case T.BYTE_ARRAY: num('writeInt32BE', 4, v.length); return v.forEach((x) => num('writeInt8', 1, x));
      case T.STRING: return str(v);
      case T.LIST: num('writeUInt8', 1, v.items.length ? v.type : T.END); num('writeInt32BE', 4, v.items.length); return v.items.forEach((x) => payload(v.type, x));
      case T.COMPOUND: v.forEach((e) => { num('writeUInt8', 1, e.type); str(e.name); payload(e.type, e.value); }); return num('writeUInt8', 1, T.END);
      case T.INT_ARRAY: num('writeInt32BE', 4, v.length); return v.forEach((x) => num('writeInt32BE', 4, x));
      case T.LONG_ARRAY: num('writeInt32BE', 4, v.length); return v.forEach((x) => num('writeBigInt64BE', 8, x));
      default: throw new Error('Neznámý NBT typ ' + t);
    }
  }
  return {
    root(name, value) { num('writeUInt8', 1, T.COMPOUND); str(name); payload(T.COMPOUND, value); return Buffer.concat(parts); }
  };
}

const get = (c, name) => c.find((e) => e.name === name);
function set(c, type, name, value) {
  const e = get(c, name);
  if (e) { e.type = type; e.value = value; } else c.push({ type, name, value });
}

function sameHost(ip, host, port) {
  const a = String(ip || '').trim().toLowerCase();
  const plain = host.toLowerCase();
  return a === plain || a === `${plain}:${port || 25565}`;
}

/**
 * Zajistí, že servers.dat obsahuje server s povoleným resource packem.
 * Vrací true, pokud se soubor změnil.
 */
function ensureServer(gameDir, server, opts = {}) {
  // 1 = Povolit (stáhne pack od serveru), 0 = Zakázat (pack už má hra nainstalovaný sama)
  const accept = opts.acceptTextures === 0 ? 0 : 1;
  const file = path.join(gameDir, 'servers.dat');
  const address = server.port && server.port !== 25565 ? `${server.host}:${server.port}` : server.host;
  let root = { name: '', value: [] };
  if (fs.existsSync(file)) {
    try {
      root = reader(fs.readFileSync(file)).root();
    } catch {
      // Poškozený soubor: necháme si zálohu a vytvoříme nový.
      fs.copyFileSync(file, file + '.bak');
      root = { name: '', value: [] };
    }
  }
  let list = get(root.value, 'servers');
  if (!list || list.type !== T.LIST) {
    set(root.value, T.LIST, 'servers', { type: T.COMPOUND, items: [] });
    list = get(root.value, 'servers');
  }
  if (!list.value.items.length) list.value.type = T.COMPOUND;
  const items = list.value.items;

  let changed = false;
  // Úklid: záznamy s přímou adresou hostingu (přidané omylem) – server je jen play.wylvarion.cz.
  for (let i = items.length - 1; i >= 0; i--) {
    const v = String((get(items[i], 'ip') || {}).value || '').toLowerCase();
    if (v.startsWith('chicken.hostify.cz')) {
      items.splice(i, 1);
      changed = true;
    }
  }
  let entry = items.find((s) => sameHost((get(s, 'ip') || {}).value, server.host, server.port));
  if (!entry) {
    entry = [];
    set(entry, T.STRING, 'name', server.name || 'Wylvarion');
    set(entry, T.STRING, 'ip', address);
    items.unshift(entry);
    changed = true;
  }
  // Adresu držíme přesně podle konfigurace (velikost písmen: podle ní server pozná hráče z launcheru).
  const ip = get(entry, 'ip');
  if (!ip || ip.value !== address) {
    set(entry, T.STRING, 'ip', address);
    changed = true;
  }
  // Záznam, který si hra uložila při Quick Play, je skrytý – v seznamu serverů by nebyl vidět.
  const hiddenIdx = entry.findIndex((e) => e.name === 'hidden');
  if (hiddenIdx !== -1) {
    entry.splice(hiddenIdx, 1);
    items.splice(items.indexOf(entry), 1);
    items.unshift(entry);
    changed = true;
  }
  const at = get(entry, 'acceptTextures');
  if (!at || at.value !== accept) {
    set(entry, T.BYTE, 'acceptTextures', accept);
    changed = true;
  }
  if (changed) {
    fs.mkdirSync(gameDir, { recursive: true });
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, writer().root(root.name, root.value));
    fs.renameSync(tmp, file);
  }
  return changed;
}

module.exports = { ensureServer, _nbt: { reader, writer, T } };
