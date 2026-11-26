'use strict';
// Hlavní proces Wylvarion Launcheru.

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { app, BrowserWindow, ipcMain, shell, dialog, clipboard } = require('electron');

const store = require('./store');
const auth = require('./core/auth');
const mc = require('./core/minecraft');
const mods = require('./core/mods');
const java = require('./core/java');
const { buildCommand, launch, redact } = require('./core/launch');
const { ping } = require('./core/status');
const { getJson, postJson } = require('./core/http');
const { defaultRoot, layout } = require('./core/paths');
const servers = require('./core/servers');
const skins = require('./core/skins');
const serverpack = require('./core/serverpack');
const intro = require('./core/intro');
const { setOptions, enablePack, tuneDynamicFps, GAME_LANG } = require('./core/options');

let win = null;
let config = null;
let settings = null;
let gameProcess = null;
let busy = false;

const LOCAL_CONFIG = path.join(__dirname, '..', '..', 'config', 'launcher.json');

if (!app.requestSingleInstanceLock()) {
  app.quit();
}
app.on('second-instance', () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  }
});

function send(channel, data) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, data);
}

function progress(p) {
  send('progress', p);
}

function dirs() {
  return layout(settings.root || defaultRoot());
}

function recommendedMemory() {
  const totalMb = Math.round(os.totalmem() / 1024 / 1024);
  if (totalMb >= 16000) return 6144;
  if (totalMb >= 12000) return 4096;
  if (totalMb >= 8000) return 3072;
  return 2048;
}

// Nikdy nepřidělit hře víc paměti, než počítač unese (jinak se Java vůbec nespustí).
function safeMemory(mb) {
  const totalMb = Math.round(os.totalmem() / 1024 / 1024);
  const cap = Math.max(1536, totalMb - (totalMb >= 8000 ? 2560 : 1536));
  return Math.max(1024, Math.min(mb, cap));
}

// Rozpozná z konce logu, proč hra spadla.
function diagnoseCrash(tail) {
  const t = tail.join('\n');
  if (/Could not reserve enough space|Invalid maximum heap|Initial heap size set to a larger value|Could not create the Java Virtual Machine/i.test(t)) return 'ram-start';
  if (/OutOfMemoryError|Java heap space|GC overhead limit/i.test(t)) return 'memory';
  if (/Incompatible mods? found|Mod resolution encountered|requires .* which is missing|Could not find required mod|Mixin apply .* failed|MixinApplyError/i.test(t)) return 'mods';
  if (/reimagined[-_ ]?intro|reimaginedintro/i.test(t) && /Exception|Error/.test(t)) return 'intro';
  if (/iris|shaderpack|oculus/i.test(t) && /Exception|Error/.test(t)) return 'shaders';
  if (/GLFW error|Pixel format not accelerated|OpenGL|WGL|EXCEPTION_ACCESS_VIOLATION|nvoglv|atio6axx|ig\d+icd|igxelpicd|A fatal error has been detected by the Java Runtime/i.test(t)) return 'graphics';
  return 'unknown';
}

async function loadConfig() {
  const local = JSON.parse(fs.readFileSync(LOCAL_CONFIG, 'utf8'));
  config = local;
  try {
    const remote = await getJson(local.remoteConfigUrl, { timeout: 8000 });
    // Vzdálená konfigurace (z webu) může přepsat mody, verzi hry, novinky atd.
    const rm = remote.microsoft || {};
    config = {
      ...local,
      ...remote,
      // Seznam modů z webu; pole, která web neuvádí (např. weakPc), se doplní z vestavěné konfigurace.
      mods:
        Array.isArray(remote.mods) && remote.mods.length
          ? remote.mods.map((m) => ({ ...((local.mods || []).find((l) => l.id === m.id) || {}), ...m }))
          : local.mods,
      microsoft: { ...local.microsoft, ...(rm.clientId ? { clientId: rm.clientId } : {}), ...(rm.redirectUri ? { redirectUri: rm.redirectUri } : {}) },
      server: { ...local.server, ...(remote.server || {}) },
      links: { ...local.links, ...(remote.links || {}) },
      shaders: { ...local.shaders, ...(remote.shaders || {}) }
    };
  } catch {
    /* web nedostupný – použijeme vestavěnou konfiguraci */
  }
  return config;
}

function publicAccount(acc) {
  if (!acc) return null;
  return { name: acc.name, uuid: acc.uuid, skin: acc.skin };
}

async function validAccount() {
  let acc = store.loadAccount();
  if (!acc) throw Object.assign(new Error('Nejdřív se přihlas.'), { code: 'LOGIN' });
  if (acc.expiresAt && acc.expiresAt - Date.now() > 5 * 60 * 1000) return acc;
  if (!config.microsoft.clientId) throw new Error('Launcher nemá nastavené Microsoft přihlášení (clientId).');
  try {
    const ms = await auth.refresh(config.microsoft.clientId, acc.refreshToken);
    acc = await auth.fromMicrosoft(ms);
    store.saveAccount(acc);
    send('account', publicAccount(acc));
    return acc;
  } catch (e) {
    store.clearAccount();
    send('account', null);
    throw Object.assign(new Error('Přihlášení vypršelo, přihlas se prosím znovu.'), { code: 'LOGIN' });
  }
}

const LOGIN_BG = '#120b20';
function loginPage(title, body, buttons) {
  const btn = buttons.map(([href, label, primary]) => `<a href="${href}" class="${primary ? 'p' : ''}">${label}</a>`).join('');
  const html = `<!doctype html><meta charset="utf-8"><style>
    body{margin:0;height:100vh;display:flex;align-items:center;justify-content:center;background:${LOGIN_BG};color:#fff;font:15px Segoe UI,system-ui,sans-serif;text-align:center}
    .w{max-width:380px;padding:24px}h1{font-size:20px;margin:0 0 10px}p{color:#b3a7c4;line-height:1.5;margin:0 0 18px}
    .code{font:700 34px Consolas,monospace;letter-spacing:4px;padding:14px 18px;margin:0 0 18px;border-radius:12px;background:#221733;border:1px solid #6d28d9;user-select:all}
    a{display:block;margin:8px 0;padding:12px;border-radius:10px;border:1px solid #3b2a55;color:#fff;text-decoration:none;font-weight:600}
    a.p{background:linear-gradient(135deg,#c084fc,#7c3aed);border:0}
    .sp{width:34px;height:34px;margin:0 auto 18px;border:3px solid #3b2a55;border-top-color:#c084fc;border-radius:50%;animation:r 1s linear infinite}@keyframes r{to{transform:rotate(360deg)}}
  </style><div class="w">${title}${body}${btn}</div>`;
  return 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
}

// Okno přihlášení Microsoft. Když se stránka nenačte (blokace, výpadek, bílé okno),
// nabídne „Zkusit znovu“ nebo přihlášení kódem v prohlížeči (microsoft.com/link).
function loginWindow(url, redirectUri) {
  return new Promise((resolve, reject) => {
    const w = new BrowserWindow({
      width: 520,
      height: 720,
      parent: win,
      title: 'Přihlášení Microsoft',
      autoHideMenuBar: true,
      backgroundColor: LOGIN_BG,
      webPreferences: { partition: `login-${Date.now()}`, sandbox: true, contextIsolation: true }
    });
    const wc = w.webContents;
    // Standardní Chrome user agent: Microsoft u neznámých prohlížečů občas vrátí prázdnou stránku.
    wc.setUserAgent(wc.getUserAgent().replace(/\s(?:Electron|wylvarion[\w-]*|WylvarionLauncher)\/\S+/gi, ''));
    let finished = false;
    let loaded = false;
    let watchdog = null;
    const done = (fn) => {
      finished = true;
      clearTimeout(watchdog);
      if (!w.isDestroyed()) w.close();
      fn();
    };
    const failPage = (why) => {
      if (finished || w.isDestroyed()) return;
      clearTimeout(watchdog);
      wc.loadURL(loginPage('<h1>Přihlašovací stránka se nenačetla</h1>',
        `<p>${why} Zkus to znovu, nebo se přihlas kódem ve svém prohlížeči – funguje to vždy.</p>`,
        [['wyl://retry', 'Zkusit znovu', false], ['wyl://device', 'Přihlásit kódem v prohlížeči', true]]));
    };
    const start = () => {
      loaded = false;
      wc.loadURL(url);
      clearTimeout(watchdog);
      watchdog = setTimeout(() => { if (!loaded) failPage('Microsoft neodpovídá.'); }, 25000);
    };
    const check = (target) => {
      if (!target) return false;
      if (target.startsWith('wyl://')) {
        if (target.startsWith('wyl://retry')) start();
        else done(() => reject(Object.assign(new Error('device'), { code: 'DEVICE' })));
        return true;
      }
      if (!target.startsWith(redirectUri)) return false;
      const u = new URL(target);
      const code = u.searchParams.get('code');
      const err = u.searchParams.get('error_description') || u.searchParams.get('error');
      done(() => (code ? resolve({ code, state: u.searchParams.get('state') }) : reject(new Error(err || 'Přihlášení bylo zrušeno.'))));
      return true;
    };
    wc.on('will-redirect', (e, target) => { if (check(target)) e.preventDefault(); });
    wc.on('will-navigate', (e, target) => { if (check(target)) e.preventDefault(); });
    wc.on('did-navigate', (e, target) => check(target));
    wc.on('did-finish-load', () => { loaded = true; clearTimeout(watchdog); });
    wc.on('did-fail-load', (e, errorCode, desc, target, isMain) => {
      if (!isMain || errorCode === -3 || finished) return;
      if (target && (target.startsWith(redirectUri) || target.startsWith('wyl://'))) return;
      failPage(`Chyba připojení (${desc || errorCode}).`);
    });
    wc.on('render-process-gone', () => failPage('Okno přihlášení spadlo.'));
    wc.setWindowOpenHandler(({ url: u }) => {
      if (/^https:\/\//.test(u)) shell.openExternal(u);
      return { action: 'deny' };
    });
    w.on('closed', () => {
      clearTimeout(watchdog);
      if (!finished) reject(new Error('Přihlášení bylo zrušeno.'));
    });
    start();
  });
}

// Přihlášení kódem: zobrazí kód, otevře microsoft.com/link v prohlížeči a čeká na potvrzení.
async function deviceLogin(clientId) {
  const dc = await auth.deviceCode(clientId);
  const link = dc.verification_uri || 'https://www.microsoft.com/link';
  const w = new BrowserWindow({ width: 460, height: 520, parent: win, title: 'Přihlášení kódem', autoHideMenuBar: true, backgroundColor: LOGIN_BG });
  let closed = false;
  w.on('closed', () => { closed = true; });
  w.webContents.on('will-navigate', (e, target) => {
    e.preventDefault();
    if (target.startsWith('wyl://open')) shell.openExternal(link);
    if (target.startsWith('wyl://copy')) clipboard.writeText(dc.user_code);
  });
  w.loadURL(loginPage('<div class="sp"></div><h1>Přihlášení kódem</h1>',
    `<p>V prohlížeči otevři <b>${link.replace(/^https:\/\//, '')}</b>, zadej tento kód a přihlas se svým Microsoft účtem. Okno se pak samo zavře.</p><div class="code">${dc.user_code}</div>`,
    [['wyl://open', 'Otevřít stránku v prohlížeči', true], ['wyl://copy', 'Zkopírovat kód', false]]));
  clipboard.writeText(dc.user_code);
  shell.openExternal(link);
  try {
    return await auth.pollDevice(clientId, dc, () => closed);
  } finally {
    if (!closed) w.close();
  }
}

// Slabší počítač: integrovaná grafika nebo méně než 8 GB RAM.
function weakPc() {
  return mods.gpuTier(app._gpuInfo) === 'low' || os.totalmem() < 8 * 1024 * 1024 * 1024;
}

// Výchozí stav volitelného modu. weakPc: false = na slabém počítači vypnutý (např. intro, které tam padá).
function modDefault(m) {
  if (m.default === false) return false;
  return !(m.weakPc === false && weakPc());
}

// Jazyk launcheru: z nastavení, jinak podle systému (sk → slovenština, cs → čeština, jinak angličtina).
function currentLang() {
  if (['cs', 'sk', 'en'].includes(settings.lang)) return settings.lang;
  const loc = String(app.getLocale() || '').toLowerCase();
  if (loc.startsWith('sk')) return 'sk';
  if (loc.startsWith('cs')) return 'cs';
  return 'en';
}

async function selectedModList() {
  const opt = settings.optionalMods || {};
  return (config.mods || []).filter((m) => m.required || (m.id in opt ? opt[m.id] : modDefault(m)));
}

function shaderChoice() {
  const preset = settings.shaderPreset || 'auto';
  if (preset === 'off') return null;
  const tier = preset === 'auto' ? mods.gpuTier(app._gpuInfo) : preset;
  const s = (config.shaders || {})[tier];
  return s ? s.id : null;
}

let lastCrashTail = [];

async function play() {
  if (busy) return;
  if (gameProcess) throw new Error('Hra už běží.');
  busy = true;
  const d = dirs();
  try {
    const acc = await validAccount();
    progress({ stage: 'start', text: 'Připravuji hru…', done: 0, total: 1 });

    const installed = await mc.install(d, { mcVersion: config.minecraft, fabricLoader: config.fabricLoader }, progress);

    progress({ stage: 'mods', text: 'Kontroluji mody…', done: 0, total: 1 });
    try {
      const { files, missing } = await mods.resolve(await selectedModList(), config.minecraft);
      await mods.sync(d.mods, files, progress);
      if (missing.length) send('notice', { key: 'notice.modsMissing', vars: { mc: config.minecraft, list: missing.map((m) => m.name).join(', ') } });
    } catch (e) {
      // Bez internetu spustíme s mody, které už jsou stažené.
      send('notice', { key: 'notice.modsOffline' });
    }

    const shader = shaderChoice();
    if (shader !== settings.appliedShader) {
      try {
        await mods.applyShader(d, shader, config.minecraft);
        settings.appliedShader = shader;
        store.saveSettings(settings);
      } catch (e) {
        send('notice', { key: 'notice.shader', vars: { err: e.message } });
      }
    }

    // Resource pack serveru: launcher ho stáhne (jen když se změnil) a zapne ve hře jako
    // normální resource pack. Načte se při startu hry, takže se při připojení nic nestahuje
    // ani nenačítá – pack od serveru hra odmítne (ItemsAdder za to nevyhazuje).
    let localPack = false;
    try {
      const rp = await serverpack.prefetch(d, config.resourcePack, progress);
      if (rp && rp.master) {
        serverpack.installLocal(d, rp.master);
        localPack = true;
      }
    } catch (e) {
      send('notice', { key: 'notice.pack' });
    }

    // Server se dozví, že hráč má pack z launcheru (pack od serveru hra odmítne, takže by to jinak nepoznal)
    // a v tabu / scoreboardu mu ukáže obrázky místo textu. Nevadí, když se to nepovede.
    if (localPack) {
      postJson(config.packReportUrl || 'https://wylvarion.cz/api/launcher-seen.php', { name: acc.name }, { timeout: 6000 }).catch(() => {});
    }

    // Server v seznamu serverů; pack od serveru přijmout jen když ho nemáme nainstalovaný sami (stáhne se sám, bez dotazu).
    try {
      servers.ensureServer(d.game, config.server, { acceptTextures: localPack ? 0 : 1 });
    } catch (e) {
      send('notice', { key: 'notice.servers', vars: { err: e.message } });
    }

    // Intro Wylvarionu pro Reimagined Intro (jen když je mod zapnutý).
    if ((await selectedModList()).some((m) => m.id === 'reimagined-intro')) {
      try {
        await intro.prepare(d, config.intro, settings.introPack || 'wylvarion', progress);
      } catch (e) {
        send('notice', { key: 'notice.intro' });
      }
    }

    // Pozadí menu (panorama z intra) – resource pack pod packem serveru.
    try {
      if (await intro.prepareMenu(d, config.intro)) enablePack(d.game, `file/${intro.MENU_FILE}`, 'file/wylvarion-server.zip');
    } catch {
      /* není podstatné */
    }

    // Dynamic FPS nesmí v neaktivním okně srazit FPS na 1 (intro a menu by trhaly).
    try {
      tuneDynamicFps(d.game);
    } catch {
      /* není podstatné */
    }

    // Jazyk hry a celá obrazovka – zapisujeme jen po změně v launcheru, ať nepřepisujeme volby ze hry.
    try {
      const lang = currentLang();
      const want = { lang: GAME_LANG[lang], fullscreen: settings.fullscreen ? 'true' : 'false' };
      const patch = {};
      if (settings.appliedGameLang !== want.lang) patch.lang = want.lang;
      if (settings.appliedFullscreen !== want.fullscreen) patch.fullscreen = want.fullscreen;
      if (Object.keys(patch).length) {
        setOptions(d.game, patch);
        settings.appliedGameLang = want.lang;
        settings.appliedFullscreen = want.fullscreen;
        store.saveSettings(settings);
      }
    } catch {
      /* není podstatné */
    }

    const component = (installed.vanilla.javaVersion && installed.vanilla.javaVersion.component) || 'java-runtime-epsilon';
    const javaPath = await java.ensureJava(d.runtime, component, progress);

    const cmd = buildCommand({
      install: installed,
      dirs: d,
      account: { ...acc, clientId: config.microsoft.clientId },
      server: config.server,
      memoryMb: safeMemory(settings.memoryMb || recommendedMemory()),
      launcherVersion: app.getVersion(),
      quickPlay: Boolean(settings.autoJoin),
      width: settings.width,
      height: settings.height
    });

    fs.mkdirSync(d.logs, { recursive: true });
    const logFile = path.join(d.logs, 'launcher-last.log');
    const log = fs.createWriteStream(logFile);
    log.write(`[Wylvarion Launcher ${app.getVersion()}] ${new Date().toISOString()}\n${javaPath} ${redact(cmd.args, acc.accessToken).join(' ')}\n\n`);

    progress({ stage: 'launch', text: 'Spouštím Minecraft…', done: 1, total: 1 });
    const tail = [];
    gameProcess = launch(javaPath, cmd, d, (line) => {
      log.write(line);
      send('game-log', line);
      for (const l of String(line).split('\n')) {
        if (!l) continue;
        tail.push(l);
        if (tail.length > 400) tail.shift();
        if (gameProcess && /Reloading ResourceManager|Sound engine started|OpenAL initialized|Created: \d+x\d+/.test(l)) gameProcess.emit('game-window');
      }
    });
    const started = Date.now();
    // Launcher se schová/zavře až ve chvíli, kdy je okno hry opravdu vidět (ne hned po startu Javy),
    // ať hráč nezůstane bez ničeho, když se hra načítá dlouho nebo spadne.
    let windowUp = false;
    let afterTimer = null;
    const afterLaunch = () => {
      if (!gameProcess || afterTimer === 'done') return;
      clearTimeout(afterTimer);
      afterTimer = 'done';
      if (settings.afterLaunch === 'hide' && win && !win.isDestroyed()) win.hide();
      if (settings.afterLaunch === 'close') app.quit();
    };
    gameProcess.on('game-window', () => {
      windowUp = true;
      progress({ stage: 'idle' });
      setTimeout(afterLaunch, 1500);
    });
    gameProcess.on('spawn', () => {
      send('game-state', { running: true });
      progress({ stage: 'starting', text: 'Minecraft se načítá…', done: 0, total: 0 });
      afterTimer = setTimeout(afterLaunch, 180000);
    });
    gameProcess.on('error', (e) => {
      send('notice', `Hru se nepodařilo spustit: ${e.message}`);
    });
    gameProcess.on('exit', (code) => {
      log.end();
      gameProcess = null;
      if (afterTimer !== 'done') clearTimeout(afterTimer);
      const playedMs = Date.now() - started;
      const crashed = code !== 0 && code !== null;
      lastCrashTail = tail.slice(-300);
      const crash = crashed ? { kind: diagnoseCrash(tail), early: !windowUp || playedMs < 120000, code } : null;
      send('game-state', { running: false, code, playedMs, logFile, crash });
      if (win && !win.isDestroyed()) {
        win.show();
        win.focus();
      }
    });
    return { ok: true };
  } finally {
    busy = false;
  }
}

function createWindow() {
  win = new BrowserWindow({
    width: 1180,
    height: 720,
    minWidth: 980,
    minHeight: 620,
    frame: false,
    backgroundColor: '#0b0913',
    show: false,
    title: 'Wylvarion Launcher',
    icon: path.join(__dirname, '..', '..', 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  win.once('ready-to-show', () => win.show());
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
}

function setupIpc() {
  ipcMain.handle('state', async () => ({
    version: app.getVersion(),
    platform: process.platform,
    account: publicAccount(store.loadAccount()),
    settings: { ...settings, root: settings.root || defaultRoot(), memoryMb: settings.memoryMb || recommendedMemory() },
    totalMemoryMb: Math.round(os.totalmem() / 1024 / 1024),
    recommendedMemoryMb: recommendedMemory(),
    gpuTier: mods.gpuTier(app._gpuInfo),
    weakPc: weakPc(),
    lang: currentLang(),
    config: {
      server: config.server,
      minecraft: config.minecraft,
      mods: config.mods,
      shaders: config.shaders,
      links: config.links,
      voteSites: config.voteSites || [],
      news: config.news || [],
      loginReady: Boolean(config.microsoft.clientId)
    },
    running: Boolean(gameProcess)
  }));

  ipcMain.handle('login', async () => {
    if (!config.microsoft.clientId) throw new Error('Microsoft přihlášení zatím není nastavené. Správce serveru musí doplnit clientId.');
    const { verifier, challenge } = auth.pkce();
    const state = crypto.randomBytes(12).toString('hex');
    const url = auth.authorizeUrl(config.microsoft.clientId, config.microsoft.redirectUri, challenge, state);
    let ms;
    try {
      const res = await loginWindow(url, config.microsoft.redirectUri);
      if (res.state !== state) throw new Error('Neplatná odpověď přihlášení.');
      progress({ stage: 'login', text: 'Ověřuji účet…', done: 0, total: 1 });
      ms = await auth.exchangeCode(config.microsoft.clientId, config.microsoft.redirectUri, res.code, verifier);
    } catch (e) {
      if (e.code !== 'DEVICE') throw e;
      ms = await deviceLogin(config.microsoft.clientId);
      progress({ stage: 'login', text: 'Ověřuji účet…', done: 0, total: 1 });
    }
    const acc = await auth.fromMicrosoft(ms);
    store.saveAccount(acc);
    progress({ stage: 'idle', text: '', done: 1, total: 1 });
    return publicAccount(acc);
  });

  ipcMain.handle('skin', async () => {
    const acc = store.loadAccount();
    if (!acc || !acc.skin || !acc.skin.url) return null;
    try {
      const res = await require('./core/http').request(acc.skin.url.replace(/^http:/, 'https:'));
      if (!res.ok) return null;
      const buf = Buffer.from(await res.arrayBuffer());
      return { url: `data:image/png;base64,${buf.toString('base64')}`, variant: acc.skin.variant };
    } catch {
      return null;
    }
  });

  // --- Skiny a pláště ---
  const skinLib = () => skins.library(path.join(app.getPath('userData'), 'skins'));
  // Výsledek vždy jako { ok, ... } nebo { ok:false, error, code }, aby se v okně dal poznat vypršelý login.
  const safe = (fn) => async (e, ...args) => {
    try {
      return { ok: true, ...(await fn(...args)) };
    } catch (err) {
      if (err.code === 'LOGIN') {
        store.clearAccount();
        send('account', null);
      }
      return { ok: false, error: err.message, code: err.code };
    }
  };
  const afterProfile = (acc, p) => {
    acc.skin = skins.activeSkin(p);
    store.saveAccount(acc);
    send('account', publicAccount(acc));
  };
  const profileView = async (p) => ({
    skin: p ? await skins.textureDataUrl((skins.activeSkin(p) || {}).url).catch(() => null) : null,
    variant: p && skins.activeSkin(p) ? (skins.activeSkin(p).variant === 'SLIM' ? 'slim' : 'classic') : 'classic',
    capes: p
      ? await Promise.all(
          (p.capes || []).map(async (c) => ({ id: c.id, name: c.alias || 'Plášť', active: c.state === 'ACTIVE', dataUrl: await skins.textureDataUrl(c.url).catch(() => null) }))
        )
      : []
  });

  ipcMain.handle('skins:state', safe(async () => {
    const acc = await validAccount();
    const p = await skins.profile(acc.accessToken);
    afterProfile(acc, p);
    return { ...(await profileView(p)), library: skinLib().list() };
  }));

  ipcMain.handle('skins:pick', safe(async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Vyber skin (PNG 64×64)', filters: [{ name: 'Skin', extensions: ['png'] }], properties: ['openFile'] });
    if (r.canceled || !r.filePaths[0]) return { canceled: true };
    const png = await fs.promises.readFile(r.filePaths[0]);
    skins.checkSkin(png);
    return { name: path.basename(r.filePaths[0], path.extname(r.filePaths[0])).slice(0, 32), data: png.toString('base64'), dataUrl: `data:image/png;base64,${png.toString('base64')}` };
  }));

  ipcMain.handle('skins:apply', safe(async (opts) => {
    const acc = await validAccount();
    const png = opts.libraryId ? skinLib().get(opts.libraryId).png : Buffer.from(String(opts.data || ''), 'base64');
    const variant = opts.variant || (opts.libraryId ? skinLib().get(opts.libraryId).variant : 'classic');
    skins.checkSkin(png);
    if (opts.save && !opts.libraryId) skinLib().add(png, opts.name, variant);
    const p = await skins.upload(acc.accessToken, png, variant);
    afterProfile(acc, p);
    return { ...(await profileView(p)), library: skinLib().list() };
  }));

  ipcMain.handle('skins:saveCurrent', safe(async (name) => {
    const acc = await validAccount();
    if (!acc.skin || !acc.skin.url) throw new Error('Účet nemá vlastní skin.');
    const res = await require('./core/http').request(acc.skin.url.replace(/^http:/, 'https:'));
    if (!res.ok) throw new Error('Skin se nepodařilo stáhnout.');
    skinLib().add(Buffer.from(await res.arrayBuffer()), name || acc.name, acc.skin.variant === 'SLIM' ? 'slim' : 'classic');
    return { library: skinLib().list() };
  }));

  ipcMain.handle('skins:remove', safe(async (id) => {
    skinLib().remove(id);
    return { library: skinLib().list() };
  }));

  ipcMain.handle('skins:cape', safe(async (capeId) => {
    const acc = await validAccount();
    const p = await skins.setCape(acc.accessToken, capeId || null);
    afterProfile(acc, p);
    return await profileView(p);
  }));

  ipcMain.handle('logout', () => {
    store.clearAccount();
    return true;
  });

  ipcMain.handle('play', async () => {
    try {
      return await play();
    } catch (e) {
      progress({ stage: 'error', text: e.message, done: 0, total: 1 });
      return { ok: false, error: e.message, code: e.code };
    }
  });

  ipcMain.handle('status', async () => {
    try {
      return await ping(config.server.host, config.server.port);
    } catch (e) {
      return { online: false, error: e.message };
    }
  });

  ipcMain.handle('settings:set', (e, patch) => {
    const allowedKeys = ['memoryMb', 'shaderPreset', 'optionalMods', 'afterLaunch', 'autoJoin', 'width', 'height', 'root', 'firstRunDone', 'lang', 'introPack', 'fullscreen'];
    for (const k of allowedKeys) if (k in patch) settings[k] = patch[k];
    store.saveSettings(settings);
    return settings;
  });

  ipcMain.handle('root:choose', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Vyber složku pro hru', properties: ['openDirectory', 'createDirectory'] });
    if (r.canceled || !r.filePaths[0]) return null;
    settings.root = r.filePaths[0];
    store.saveSettings(settings);
    return settings.root;
  });

  ipcMain.handle('mods:custom', async () => mods.customMods(dirs().mods));

  ipcMain.handle('mods:addJar', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Přidat vlastní mod', filters: [{ name: 'Fabric mod', extensions: ['jar'] }], properties: ['openFile', 'multiSelections'] });
    if (r.canceled) return mods.customMods(dirs().mods);
    fs.mkdirSync(dirs().mods, { recursive: true });
    for (const f of r.filePaths) fs.copyFileSync(f, path.join(dirs().mods, path.basename(f)));
    return mods.customMods(dirs().mods);
  });

  ipcMain.handle('mods:removeJar', async (e, name) => {
    if (!/^[^/\\]+\.jar(\.disabled)?$/i.test(name)) throw new Error('Neplatný název souboru.');
    fs.rmSync(path.join(dirs().mods, name), { force: true });
    return mods.customMods(dirs().mods);
  });

  ipcMain.handle('mods:search', async (e, query) => mods.search(String(query || '').slice(0, 80), config.minecraft));

  ipcMain.handle('mods:addModrinth', async (e, id) => {
    const v = await mods.latestVersion(id, config.minecraft, ['fabric']);
    if (!v) throw new Error(`Mod není dostupný pro Minecraft ${config.minecraft}.`);
    const f = v.files.find((x) => x.primary) || v.files[0];
    const { download } = require('./core/http');
    await download(f.url, path.join(dirs().mods, f.filename), { sha1: f.hashes && f.hashes.sha1, size: f.size });
    return mods.customMods(dirs().mods);
  });

  ipcMain.handle('open', (e, what) => {
    const d = dirs();
    const map = { game: d.game, mods: d.mods, logs: d.logs, screenshots: path.join(d.game, 'screenshots'), root: d.root };
    if (map[what]) {
      fs.mkdirSync(map[what], { recursive: true });
      shell.openPath(map[what]);
    }
  });

  ipcMain.handle('copy', (e, text) => clipboard.writeText(String(text || '').slice(0, 200)));
  ipcMain.handle('copyLog', () => {
    clipboard.writeText(`Wylvarion Launcher ${app.getVersion()} | ${os.platform()} ${os.release()} | RAM ${Math.round(os.totalmem() / 1073741824)} GB\n` + lastCrashTail.join('\n'));
    return true;
  });
  // Rychlé opravy po pádu hry.
  ipcMain.handle('crashFix', (e, what) => {
    if (what === 'intro') settings.optionalMods = { ...(settings.optionalMods || {}), 'reimagined-intro': false };
    if (what === 'shaders') settings.shaderPreset = 'off';
    if (what === 'ram') settings.memoryMb = safeMemory(Math.max(2048, (settings.memoryMb || recommendedMemory()) - 1024));
    if (what === 'more-ram') settings.memoryMb = safeMemory((settings.memoryMb || recommendedMemory()) + 1024);
    store.saveSettings(settings);
    return { ...settings };
  });

  // Oprava: při dalším spuštění znovu stáhnout a ověřit resource pack, intro a shader.
  // Mody launcher ověřuje podle SHA-1 při každém spuštění, poškozené stáhne znovu sám.
  ipcMain.handle('repair', async () => {
    const d = dirs();
    for (const p of [path.join(d.root, 'serverpack'), path.join(d.root, 'intro-state.json'), path.join(d.game, 'intros', intro.FILE_NAME)]) {
      await fs.promises.rm(p, { recursive: true, force: true }).catch(() => {});
    }
    settings.appliedShader = undefined;
    settings.appliedGameLang = undefined;
    settings.appliedFullscreen = undefined;
    store.saveSettings(settings);
    return true;
  });

  ipcMain.handle('external', (e, url) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
  });

  ipcMain.handle('window', (e, action) => {
    if (!win) return;
    if (action === 'min') win.minimize();
    else if (action === 'max') win.isMaximized() ? win.unmaximize() : win.maximize();
    else if (action === 'close') win.close();
  });

  ipcMain.handle('update:install', () => {
    try {
      require('electron-updater').autoUpdater.quitAndInstall();
    } catch {
      /* aktualizace není připravená */
    }
  });
}

function setupUpdater() {
  // Verzi z Microsoft Storu aktualizuje Store sám.
  if (!app.isPackaged || process.windowsStore) return;
  let autoUpdater;
  try {
    autoUpdater = require('electron-updater').autoUpdater;
  } catch {
    return;
  }
  autoUpdater.autoDownload = true;
  autoUpdater.on('update-available', (i) => send('update', { state: 'downloading', version: i.version }));
  autoUpdater.on('download-progress', (p) => send('update', { state: 'downloading', percent: Math.round(p.percent) }));
  autoUpdater.on('update-downloaded', (i) => send('update', { state: 'ready', version: i.version }));
  autoUpdater.on('error', () => {});
  autoUpdater.checkForUpdates().catch(() => {});
  // Kontrola i za běhu (každou hodinu), ne jen při startu.
  setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 60 * 60 * 1000);
}

app.whenReady().then(async () => {
  settings = store.loadSettings();
  try {
    app._gpuInfo = await app.getGPUInfo('basic');
  } catch {
    app._gpuInfo = null;
  }
  await loadConfig();
  setupIpc();
  createWindow();
  setupUpdater();
});

app.on('window-all-closed', () => {
  // Když hráč zavře launcher během hry, hra běží dál a launcher se ukončí po jejím konci.
  if (!gameProcess) app.quit();
  else gameProcess.once('exit', () => app.quit());
});
