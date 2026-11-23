'use strict';
/* global wyl, skinview3d */

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

let state = null;
let viewer = null;
let playing = false;

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function toast(text, err = false) {
  const t = document.createElement('div');
  t.className = 'toast' + (err ? ' err' : '');
  t.textContent = text;
  $('#toasts').appendChild(t);
  setTimeout(() => t.remove(), err ? 9000 : 6000);
}

function fmtMem(mb) {
  return mb >= 1024 ? `${(mb / 1024).toFixed(mb % 1024 ? 1 : 0)} GB` : `${mb} MB`;
}

/* ---------- Navigace a okno ---------- */
$$('.nav[data-page]').forEach((b) =>
  b.addEventListener('click', () => {
    $$('.nav[data-page]').forEach((x) => x.classList.toggle('active', x === b));
    $$('.page').forEach((p) => p.classList.toggle('active', p.id === 'page-' + b.dataset.page));
    if (b.dataset.page === 'mods') renderCustomMods();
    if (b.dataset.page === 'skins') openSkins();
  })
);
$$('.nav[data-link]').forEach((b) => b.addEventListener('click', () => state && wyl.external(state.config.links[b.dataset.link])));
$$('[data-win]').forEach((b) => b.addEventListener('click', () => wyl.windowAction(b.dataset.win)));
$$('[data-open]').forEach((b) => b.addEventListener('click', () => wyl.open(b.dataset.open)));

/* ---------- Účet ---------- */
function renderAccount() {
  const acc = state.account;
  const box = $('#account');
  if (!acc) {
    box.innerHTML = '<button class="btn" id="accLogin" style="width:100%">Přihlásit se</button>';
    $('#accLogin').onclick = showLogin;
    $('#skinName').textContent = '';
    return;
  }
  box.innerHTML = `
    <img src="https://mc-heads.net/avatar/${esc(acc.uuid)}/36" alt="">
    <div style="min-width:0">
      <div class="name">${esc(acc.name)}</div>
      <button class="logout" id="logoutBtn">Odhlásit se</button>
    </div>`;
  $('#logoutBtn').onclick = async () => {
    await wyl.logout();
    state.account = null;
    sk.loaded = false;
    renderAccount();
    loadSkin();
    showLogin();
  };
  $('#skinName').textContent = acc.name;
}

function showLogin() {
  $('#loginOverlay').hidden = false;
  $('#loginError').textContent = '';
  $('#loginInfo').textContent = state.config.loginReady
    ? 'Otevře se okno Microsoftu. Heslo zadáváš přímo Microsoftu, launcher ho nikdy nevidí.'
    : 'Přihlášení zatím není aktivované – správce serveru musí dokončit registraci aplikace u Microsoftu.';
  $('#loginBtn').disabled = !state.config.loginReady;
}

$('#loginBtn').addEventListener('click', async () => {
  $('#loginBtn').disabled = true;
  $('#loginError').textContent = '';
  try {
    state.account = await wyl.login();
    $('#loginOverlay').hidden = true;
    renderAccount();
    loadSkin();
    sk.loaded = false;
    if ($('#page-skins').classList.contains('active')) openSkins();
    toast(`Vítej, ${state.account.name}!`);
  } catch (e) {
    $('#loginError').textContent = cleanErr(e);
  } finally {
    $('#loginBtn').disabled = false;
    setProgress({ stage: 'idle' });
  }
});

function cleanErr(e) {
  return String((e && e.message) || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
}

/* ---------- 3D skin ---------- */
async function loadSkin() {
  const canvas = $('#skin');
  try {
    if (!viewer) {
      viewer = new skinview3d.SkinViewer({ canvas, width: 260, height: 360 });
      viewer.zoom = 0.85;
      viewer.fov = 40;
      viewer.autoRotate = true;
      viewer.autoRotateSpeed = 0.6;
      viewer.animation = new skinview3d.IdleAnimation();
      viewer.controls.enableZoom = false;
    }
    const data = state.account ? await wyl.skin() : null;
    if (data) await viewer.loadSkin(data.url, { model: data.variant === 'SLIM' ? 'slim' : 'default' });
    else await viewer.loadSkin(null);
  } catch {
    /* skin není nutný */
  }
}

/* ---------- Skin a plášť ---------- */
const sk = { viewer: null, variant: 'classic', pending: null, current: null, busy: false, loaded: false };

function loadImage(src) {
  return new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = src;
  });
}

/** Plochý pohled zepředu (16×32 px) pro náhledy uložených skinů. */
async function drawFront(canvas, src, slim) {
  const img = await loadImage(src);
  const legacy = img.height === 32;
  canvas.width = 16;
  canvas.height = 32;
  const c = canvas.getContext('2d');
  c.imageSmoothingEnabled = false;
  const part = (sx, sy, w, h, dx, dy, mirror) => {
    if (!mirror) return c.drawImage(img, sx, sy, w, h, dx, dy, w, h);
    c.save();
    c.translate(dx + w, dy);
    c.scale(-1, 1);
    c.drawImage(img, sx, sy, w, h, 0, 0, w, h);
    c.restore();
  };
  const aw = slim ? 3 : 4;
  const ax = slim ? 1 : 0;
  part(8, 8, 8, 8, 4, 0); // hlava
  part(20, 20, 8, 12, 4, 8); // tělo
  part(44, 20, aw, 12, ax, 8); // pravá ruka
  if (legacy) part(44, 20, aw, 12, 12, 8, true);
  else part(36, 52, aw, 12, 12, 8); // levá ruka
  part(4, 20, 4, 12, 4, 20); // pravá noha
  if (legacy) part(4, 20, 4, 12, 8, 20, true);
  else part(20, 52, 4, 12, 8, 20); // levá noha
  part(40, 8, 8, 8, 4, 0); // vrstva hlavy
  if (!legacy) {
    part(20, 36, 8, 12, 4, 8);
    part(44, 36, aw, 12, ax, 8);
    part(52, 52, aw, 12, 12, 8);
    part(4, 36, 4, 12, 4, 20);
    part(4, 52, 4, 12, 8, 20);
  }
}

async function drawCape(canvas, src) {
  const img = await loadImage(src);
  const k = img.width / 64; // HD pláště
  canvas.width = 10;
  canvas.height = 16;
  const c = canvas.getContext('2d');
  c.imageSmoothingEnabled = false;
  c.drawImage(img, 1 * k, 1 * k, 10 * k, 16 * k, 0, 0, 10, 16);
}

function skinState(text, pending) {
  const e = $('#skinsState');
  e.textContent = text;
  e.classList.toggle('pending', Boolean(pending));
}

function setVariant(v) {
  sk.variant = v === 'slim' ? 'slim' : 'classic';
  $$('#variantBox .vbtn').forEach((b) => b.classList.toggle('active', b.dataset.variant === sk.variant));
}

async function showSkinPreview() {
  if (!sk.viewer) {
    sk.viewer = new skinview3d.SkinViewer({ canvas: $('#skinEdit'), width: 240, height: 320 });
    sk.viewer.zoom = 0.8;
    sk.viewer.fov = 40;
    sk.viewer.animation = new skinview3d.WalkingAnimation();
    sk.viewer.animation.speed = 0.6;
    sk.viewer.controls.enableZoom = false;
  }
  const src = sk.pending ? sk.pending.dataUrl : sk.current && sk.current.skin;
  try {
    await sk.viewer.loadSkin(src || null, { model: sk.variant === 'slim' ? 'slim' : 'default' });
    const cape = sk.current && (sk.current.capes || []).find((c) => c.active);
    if (cape && cape.dataUrl) await sk.viewer.loadCape(cape.dataUrl);
    else sk.viewer.loadCape(null);
  } catch {
    /* náhled není nutný */
  }
}

function skinFail(r) {
  if (r && r.code === 'LOGIN') {
    state.account = null;
    renderAccount();
    showLogin();
  }
  toast((r && r.error) || 'Něco se nepovedlo.', true);
}

function renderCapes() {
  const capes = (sk.current && sk.current.capes) || [];
  const box = $('#capeList');
  if (!capes.length) {
    box.innerHTML = '<p class="muted small" style="margin:0">Tvůj účet nemá žádný plášť.</p>';
    return;
  }
  const none = !capes.some((c) => c.active);
  box.innerHTML =
    `<button class="cape ${none ? 'active' : ''}" data-cape=""><span class="none">✕</span>Bez pláště</button>` +
    capes.map((c) => `<button class="cape ${c.active ? 'active' : ''}" data-cape="${esc(c.id)}"><canvas></canvas>${esc(c.name)}</button>`).join('');
  capes.forEach((c, i) => c.dataUrl && drawCape(box.querySelectorAll('canvas')[i], c.dataUrl).catch(() => {}));
  $$('#capeList [data-cape]').forEach((b) =>
    b.addEventListener('click', async () => {
      if (sk.busy || b.classList.contains('active')) return;
      sk.busy = true;
      $$('#capeList .cape').forEach((x) => (x.disabled = true));
      const r = await wyl.skins.cape(b.dataset.cape || null);
      sk.busy = false;
      if (!r.ok) {
        renderCapes();
        return skinFail(r);
      }
      sk.current = { ...sk.current, capes: r.capes };
      renderCapes();
      showSkinPreview();
      toast(b.dataset.cape ? 'Plášť nastaven.' : 'Plášť schován.');
    })
  );
}

function renderLibrary(list) {
  sk.library = list || sk.library || [];
  const box = $('#skinLib');
  if (!sk.library.length) {
    box.innerHTML = '<p class="muted">Zatím žádné uložené skiny. Nahraj nový nebo ulož ten, co máš teď.</p>';
    return;
  }
  box.innerHTML = sk.library
    .map((s) => `<div class="lib-item" data-id="${esc(s.id)}" title="${esc(s.name)} (${s.variant === 'slim' ? 'tenká' : 'klasická'} postava)">
        <canvas></canvas><div class="lname">${esc(s.name)}</div>
        <button class="del" data-del="${esc(s.id)}" title="Smazat">✕</button></div>`)
    .join('');
  sk.library.forEach((s, i) => drawFront(box.querySelectorAll('canvas')[i], s.dataUrl, s.variant === 'slim').catch(() => {}));
  $$('#skinLib .lib-item').forEach((el) =>
    el.addEventListener('click', async (e) => {
      if (e.target.closest('[data-del]')) return;
      await applySkin({ libraryId: el.dataset.id });
    })
  );
  $$('#skinLib [data-del]').forEach((b) =>
    b.addEventListener('click', async () => {
      const r = await wyl.skins.remove(b.dataset.del);
      if (r.ok) renderLibrary(r.library);
    })
  );
}

function clearPending() {
  sk.pending = null;
  $('#skinApply').disabled = true;
  $('#skinReset').hidden = true;
  $('#skinTitle').value = '';
  if (sk.current) setVariant(sk.current.variant);
  skinState('Tvůj aktuální skin');
}

async function applySkin(opts) {
  if (sk.busy) return;
  sk.busy = true;
  $('#skinApply').disabled = true;
  skinState('Nastavuji skin…', true);
  const r = await wyl.skins.apply(opts);
  sk.busy = false;
  if (!r.ok) {
    skinState(sk.pending ? 'Nový skin ještě není nastavený' : 'Tvůj aktuální skin', Boolean(sk.pending));
    $('#skinApply').disabled = !sk.pending;
    return skinFail(r);
  }
  sk.current = r;
  renderLibrary(r.library);
  clearPending();
  showSkinPreview();
  loadSkin();
  toast('Skin nastaven! Ve hře ho uvidíš po dalším připojení na server.');
}

async function openSkins(force) {
  if (!state.account) {
    skinState('Pro změnu skinu se nejdřív přihlas.');
    return;
  }
  if (sk.loaded && !force) return;
  skinState('Načítám skin…');
  const r = await wyl.skins.state();
  if (!r.ok) {
    skinState('Skin se nepodařilo načíst.');
    return skinFail(r);
  }
  sk.loaded = true;
  sk.current = r;
  setVariant(r.variant);
  skinState('Tvůj aktuální skin');
  renderCapes();
  renderLibrary(r.library);
  showSkinPreview();
}

$$('#variantBox .vbtn').forEach((b) =>
  b.addEventListener('click', () => {
    setVariant(b.dataset.variant);
    if (!sk.pending) {
      // změna postavy u aktuálního skinu = znovu nahrát stejný obrázek
      $('#skinApply').disabled = !(sk.current && sk.current.skin) || sk.variant === sk.current.variant;
    }
    showSkinPreview();
  })
);

$('#skinPick').addEventListener('click', async () => {
  const r = await wyl.skins.pick();
  if (!r.ok) return toast(r.error, true);
  if (r.canceled) return;
  sk.pending = r;
  $('#skinTitle').value = r.name;
  $('#skinApply').disabled = false;
  $('#skinReset').hidden = false;
  skinState('Náhled – skin ještě není nastavený', true);
  showSkinPreview();
});

$('#skinReset').addEventListener('click', () => {
  clearPending();
  showSkinPreview();
});

$('#skinApply').addEventListener('click', () => {
  if (sk.pending) {
    return applySkin({ data: sk.pending.data, variant: sk.variant, name: $('#skinTitle').value.trim() || sk.pending.name, save: $('#skinSave').checked });
  }
  // jen změna postavy u aktuálního skinu
  if (sk.current && sk.current.skin) {
    applySkin({ data: sk.current.skin.split(',')[1], variant: sk.variant });
  }
});

$('#skinSaveCurrent').addEventListener('click', async () => {
  const r = await wyl.skins.saveCurrent();
  if (!r.ok) return skinFail(r);
  renderLibrary(r.library);
  toast('Aktuální skin uložen do Mých skinů.');
});

/* ---------- Stav serveru a novinky ---------- */
async function refreshStatus() {
  const s = await wyl.status();
  const dot = $('#statusDot');
  dot.className = 'status-dot ' + (s.online ? 'on' : 'off');
  $('#serverSub').textContent = s.online ? `${s.players}/${s.max} hráčů online · ${s.ping} ms` : 'Server je offline';
}

function renderNews() {
  const list = state.config.news || [];
  $('#news').innerHTML = list.length
    ? list
        .slice(0, 8)
        .map(
          (n) => `<div class="news-item">
            <div class="date">${esc(n.date || '')}</div>
            <div class="title">${esc(n.title || '')}</div>
            <div class="text">${esc(n.text || '')}${n.url ? ` <a href="#" data-url="${esc(n.url)}">Více</a>` : ''}</div>
          </div>`
        )
        .join('')
    : '<div class="news-item"><div class="text">Novinky najdeš na webu wylvarion.cz.</div></div>';
  $$('#news a[data-url]').forEach((a) => a.addEventListener('click', (e) => (e.preventDefault(), wyl.external(a.dataset.url))));
}

/* ---------- Hraní ---------- */
const STAGES = { start: 0, meta: 0.02, client: 0.05, libraries: 0.1, assets: 0.3, mods: 0.7, java: 0.8, launch: 1 };

function setProgress(p) {
  const fill = $('#progressFill');
  const text = $('#progressText');
  if (!p || p.stage === 'idle') {
    fill.classList.remove('indeterminate');
    fill.style.width = '0';
    text.textContent = playing ? 'Hra běží' : 'Připraveno ke hře';
    return;
  }
  if (p.stage === 'error') {
    fill.classList.remove('indeterminate');
    fill.style.width = '0';
    text.textContent = p.text;
    return;
  }
  const part = p.total ? p.done / p.total : 0;
  const base = STAGES[p.stage] ?? 0;
  const keys = Object.keys(STAGES);
  const next = STAGES[keys[keys.indexOf(p.stage) + 1]] ?? 1;
  fill.classList.toggle('indeterminate', p.stage === 'login');
  fill.style.width = `${Math.round((base + (next - base) * part) * 100)}%`;
  text.textContent = p.total > 1 ? `${p.text} ${p.done}/${p.total}` : p.text;
}

$('#playBtn').addEventListener('click', async () => {
  if (!state.account) return showLogin();
  $('#playBtn').disabled = true;
  $('#playBtn span').textContent = 'SPOUŠTÍM';
  const r = await wyl.play();
  if (!r || !r.ok) {
    $('#playBtn').disabled = false;
    $('#playBtn span').textContent = 'HRÁT';
    if (r && r.code === 'LOGIN') {
      state.account = null;
      renderAccount();
      showLogin();
    }
    if (r && r.error) toast(r.error, true);
  }
});

wyl.onProgress(setProgress);
wyl.onNotice((t) => toast(t));
wyl.onAccount((acc) => {
  state.account = acc;
  renderAccount();
});
wyl.onGameState((g) => {
  playing = g.running;
  $('#playBtn').disabled = g.running;
  $('#playBtn span').textContent = g.running ? 'HRA BĚŽÍ' : 'HRÁT';
  setProgress({ stage: 'idle' });
  if (!g.running && g.code && g.code !== 0) {
    toast('Hra se neočekávaně ukončila. Log najdeš v Nastavení → Logy (launcher-last.log).', true);
  }
});
wyl.onUpdate((u) => {
  $('#updateBar').hidden = false;
  if (u.state === 'ready') {
    $('#updateText').textContent = `Nová verze ${u.version} je připravená.`;
    $('#updateBtn').hidden = false;
  } else {
    $('#updateText').textContent = `Stahuji aktualizaci launcheru${u.percent != null ? ` (${u.percent} %)` : ''}…`;
  }
});
$('#updateBtn').addEventListener('click', () => wyl.installUpdate());

/* ---------- Mody ---------- */
function renderMods() {
  const opt = state.settings.optionalMods || {};
  $('#modList').innerHTML = state.config.mods
    .map((m) => {
      const on = m.required || (m.id in opt ? opt[m.id] : m.default !== false);
      const control = m.required
        ? '<span class="lock">povinný</span>'
        : `<label class="switch"><input type="checkbox" data-mod="${esc(m.id)}" ${on ? 'checked' : ''}><span></span></label>`;
      return `<div class="mod"><div class="info"><div class="mname">${esc(m.name)}</div><div class="mdesc">${esc(m.desc || '')}</div></div>${control}</div>`;
    })
    .join('');
  $$('#modList input[data-mod]').forEach((i) =>
    i.addEventListener('change', async () => {
      const optionalMods = { ...(state.settings.optionalMods || {}), [i.dataset.mod]: i.checked };
      state.settings = { ...state.settings, ...(await wyl.setSettings({ optionalMods })) };
      toast('Změna se projeví při dalším spuštění hry.');
    })
  );
}

async function renderCustomMods(list) {
  const mods = list || (await wyl.customMods());
  $('#customList').innerHTML = mods.length
    ? mods
        .map((m) => `<div class="mod"><div class="info"><div class="mname">${esc(m)}</div></div><button class="btn small danger" data-rm="${esc(m)}">Odebrat</button></div>`)
        .join('')
    : '<p class="muted">Zatím žádné vlastní mody.</p>';
  $$('#customList [data-rm]').forEach((b) => b.addEventListener('click', async () => renderCustomMods(await wyl.removeJar(b.dataset.rm))));
}

$('#addJar').addEventListener('click', async () => renderCustomMods(await wyl.addJar()));

async function doSearch() {
  const q = $('#modSearch').value.trim();
  if (!q) return;
  $('#searchList').innerHTML = '<p class="muted">Hledám…</p>';
  try {
    const hits = await wyl.searchMods(q);
    $('#searchList').innerHTML = hits.length
      ? hits
          .map(
            (h) => `<div class="mod">${h.icon ? `<img src="${esc(h.icon)}" alt="">` : ''}<div class="info"><div class="mname">${esc(h.name)}</div><div class="mdesc">${esc(h.desc)}</div></div><button class="btn small" data-add="${esc(h.id)}">Přidat</button></div>`
          )
          .join('')
      : '<p class="muted">Nic nenalezeno pro tuto verzi hry.</p>';
    $$('#searchList [data-add]').forEach((b) =>
      b.addEventListener('click', async () => {
        b.disabled = true;
        b.textContent = 'Stahuji…';
        try {
          renderCustomMods(await wyl.addModrinth(b.dataset.add));
          b.textContent = 'Přidáno';
        } catch (e) {
          toast(cleanErr(e), true);
          b.disabled = false;
          b.textContent = 'Přidat';
        }
      })
    );
  } catch (e) {
    $('#searchList').innerHTML = `<p class="muted">Vyhledávání selhalo: ${esc(cleanErr(e))}</p>`;
  }
}
$('#modSearchBtn').addEventListener('click', doSearch);
$('#modSearch').addEventListener('keydown', (e) => e.key === 'Enter' && doSearch());

/* ---------- Nastavení ---------- */
function renderSettings() {
  const s = state.settings;
  const ram = $('#ram');
  ram.max = Math.max(4096, Math.floor((state.totalMemoryMb * 0.75) / 512) * 512);
  ram.value = s.memoryMb;
  $('#ramVal').textContent = fmtMem(+ram.value);
  $('#ramRec').textContent = fmtMem(state.recommendedMemoryMb);
  $('#ramTotal').textContent = fmtMem(state.totalMemoryMb);
  ram.oninput = () => ($('#ramVal').textContent = fmtMem(+ram.value));
  ram.onchange = () => wyl.setSettings({ memoryMb: +ram.value });

  const tiers = { low: 'slabší', medium: 'střední', high: 'výkonná' };
  $('#gpuTier').textContent = tiers[state.gpuTier] || state.gpuTier;
  $('#shader').value = s.shaderPreset || 'auto';
  $('#shader').onchange = () => wyl.setSettings({ shaderPreset: $('#shader').value });

  $('#autoJoin').checked = Boolean(s.autoJoin);
  $('#autoJoin').onchange = () => wyl.setSettings({ autoJoin: $('#autoJoin').checked });

  $('#afterLaunch').value = s.afterLaunch || 'hide';
  $('#afterLaunch').onchange = () => wyl.setSettings({ afterLaunch: $('#afterLaunch').value });

  $('#rootPath').textContent = s.root;
  $('#chooseRoot').onclick = async () => {
    const r = await wyl.chooseRoot();
    if (r) {
      state.settings.root = r;
      $('#rootPath').textContent = r;
      toast('Složka změněna. Hra se při dalším spuštění stáhne do nové složky.');
    }
  };
  $('#appVersion').textContent = state.version;
  $$('.mcver').forEach((e) => (e.textContent = state.config.minecraft));
}

/* ---------- Start ---------- */
(async function init() {
  state = await wyl.state();
  $('#serverName').textContent = state.config.server.host;
  renderAccount();
  renderNews();
  renderMods();
  renderSettings();
  loadSkin();
  refreshStatus();
  setInterval(refreshStatus, 30000);
  if (state.running) {
    playing = true;
    $('#playBtn').disabled = true;
    $('#playBtn span').textContent = 'HRA BĚŽÍ';
  }
  if (!state.account) showLogin();
  if (!state.settings.firstRunDone) {
    toast('Tip: v Nastavení si můžeš upravit paměť a shadery, v Modech přidat vlastní mody.');
    wyl.setSettings({ firstRunDone: true });
  }
})();
