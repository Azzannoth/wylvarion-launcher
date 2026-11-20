'use strict';
// Síťové pomocné funkce: JSON požadavky a stahování souborů s kontrolou SHA-1,
// opakováním při chybě a omezením počtu souběžných stahování.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pipeline } = require('stream/promises');
const { Readable } = require('stream');

const USER_AGENT = 'WylvarionLauncher/1.0 (+https://wylvarion.cz)';

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function request(url, opts = {}, attempts = 3) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, {
        ...opts,
        headers: { 'User-Agent': USER_AGENT, ...(opts.headers || {}) },
        signal: AbortSignal.timeout(opts.timeout || 30000)
      });
      if (res.status >= 500 || res.status === 429) {
        throw Object.assign(new Error(`HTTP ${res.status} ${url}`), { status: res.status, retry: true });
      }
      return res;
    } catch (e) {
      lastErr = e;
      if (e.status && !e.retry) break;
      await sleep(600 * (i + 1));
    }
  }
  throw lastErr;
}

async function getJson(url, opts = {}) {
  const res = await request(url, opts);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw Object.assign(new Error(`HTTP ${res.status} ${url} ${body.slice(0, 200)}`), { status: res.status, body });
  }
  return res.json();
}

async function postJson(url, data, opts = {}) {
  return getJson(url, {
    ...opts,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(opts.headers || {}) },
    body: JSON.stringify(data)
  });
}

async function sha1File(file) {
  const hash = crypto.createHash('sha1');
  await pipeline(fs.createReadStream(file), hash);
  return hash.digest('hex');
}

async function fileOk(file, sha1, size) {
  try {
    const st = await fs.promises.stat(file);
    if (size != null && st.size !== size) return false;
    if (sha1) return (await sha1File(file)) === sha1.toLowerCase();
    return st.size > 0;
  } catch {
    return false;
  }
}

/** Stáhne soubor (pokud už neexistuje se správným hashem). */
async function download(url, dest, { sha1, size, onBytes } = {}) {
  if (await fileOk(dest, sha1, size)) return false;
  await fs.promises.mkdir(path.dirname(dest), { recursive: true });
  const tmp = dest + '.part';
  let lastErr;
  for (let i = 0; i < 4; i++) {
    try {
      const res = await request(url, { timeout: 120000 });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
      const body = Readable.fromWeb(res.body);
      if (onBytes) body.on('data', (c) => onBytes(c.length));
      await pipeline(body, fs.createWriteStream(tmp));
      if (sha1 && (await sha1File(tmp)) !== sha1.toLowerCase()) throw new Error(`Špatný kontrolní součet: ${path.basename(dest)}`);
      await fs.promises.rename(tmp, dest);
      return true;
    } catch (e) {
      lastErr = e;
      await fs.promises.rm(tmp, { force: true });
      await sleep(800 * (i + 1));
    }
  }
  throw lastErr;
}

/** Spustí úlohy s omezenou souběžností. */
async function pool(items, limit, fn) {
  let index = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const i = index++;
      await fn(items[i], i);
    }
  });
  await Promise.all(workers);
}

module.exports = { request, getJson, postJson, download, pool, sha1File, fileOk, USER_AGENT, sleep };
