/* Načítání banlistu (vyhledávání, stránkování) a profil hráče */
let banlistAllRows = [];
const WB = { type: 'BAN', q: '', page: 1, pages: 1, seq: 0 };
const WB_TYPE = { BAN: 'Ban', MUTE: 'Mute', KICK: 'Kick', WARN: 'Warn' };
const WB_EMPTY = { BAN: 'žádné bany', MUTE: 'žádné muty', KICK: 'žádné kicky', WARN: 'žádná varování' };

function wbDate(ms) {
  if (!ms) return '–';
  const d = new Date(ms);
  return `${d.toLocaleDateString('cs-CZ')}<small>${d.toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' })}</small>`;
}
function wbUntil(row) {
  if (row.type === 'KICK') return '–';
  if (row.style === 'removed') return 'Zrušen';
  if (row.until === -1 || row.until == null) return 'Permanentní';
  return wbDate(row.until);
}
function wbAgo(ms) {
  if (!ms) return '–';
  const rtf = new Intl.RelativeTimeFormat('cs', { numeric: 'auto' });
  const s = (ms - Date.now()) / 1000;
  const steps = [[60, 'second'], [60, 'minute'], [24, 'hour'], [30, 'day'], [12, 'month'], [Infinity, 'year']];
  let v = s;
  for (const [n, unit] of steps) {
    if (Math.abs(v) < n) return rtf.format(Math.round(v), unit);
    v /= n;
  }
}
function wbHead(nick, uuid, size) {
  const id = nick || uuid || 'MHF_Steve';
  return `https://mc-heads.net/avatar/${encodeURIComponent(id)}/${size}`;
}
function wbBadge(row) {
  return `<span class="wb-pill ${escapeHtml(row.style)}">${escapeHtml(row.status)}</span>`;
}

function renderBanlistRows() {
  const box = document.getElementById('banlist-rows');
  if (!box) return;
  const rows = banlistAllRows;
  if (!rows.length) {
    const msg = WB.q ? `Pro „${escapeHtml(WB.q)}“ jsme nic nenašli.` : `Aktuálně v databázi nejsou ${WB_EMPTY[WB.type]}.`;
    box.innerHTML = `<tr><td colspan="6" class="wb-empty">${msg}</td></tr>`;
    return;
  }
  box.innerHTML = rows.map(row => {
    const name = row.nick || row.uuid || 'Neznámý hráč';
    const key = escapeHtml(row.nick || row.uuid || '');
    return `<tr>
      <td><button class="wb-player" type="button" data-player="${key}" title="Zobrazit profil">
        <img src="${wbHead(row.nick, row.uuid, 64)}" width="32" height="32" alt="" loading="lazy">
        <span class="${row.nick ? '' : 'wb-uuid'}">${escapeHtml(name)}</span></button></td>
      <td class="wb-reason" title="${escapeHtml(cleanReason(row.reason))}">${escapeHtml(cleanReason(row.reason))}</td>
      <td class="wb-hide-m">${escapeHtml(row.by === 'Console' ? 'Konzole' : row.by)}</td>
      <td class="wb-date">${wbDate(row.time)}</td>
      <td class="wb-date wb-hide-m">${wbUntil(row)}</td>
      <td>${wbBadge(row)}</td>
    </tr>`;
  }).join('');
}

function renderBanlistPager() {
  const el = document.getElementById('wbPager');
  if (!el) return;
  if (WB.pages <= 1) { el.innerHTML = ''; return; }
  const btn = (p, label, dis) => `<button type="button" class="wb-page${p === WB.page ? ' is-active' : ''}" data-page="${p}"${dis ? ' disabled' : ''}>${label}</button>`;
  const set = new Set([1, WB.pages, WB.page - 1, WB.page, WB.page + 1].filter(p => p >= 1 && p <= WB.pages));
  const list = [...set].sort((a, b) => a - b);
  let html = btn(WB.page - 1, '‹', WB.page === 1);
  list.forEach((p, i) => {
    if (i && p - list[i - 1] > 1) html += '<span class="wb-gap">…</span>';
    html += btn(p, p);
  });
  html += btn(WB.page + 1, '›', WB.page === WB.pages);
  el.innerHTML = html;
}

async function loadBanlistTable() {
  const box = document.getElementById('banlist-rows');
  const seq = ++WB.seq;
  if (box && !banlistAllRows.length) box.innerHTML = '<tr><td colspan="6" class="wb-empty">Načítám tresty…</td></tr>';
  document.querySelector('.wb-card')?.classList.add('is-loading');
  try {
    const qs = new URLSearchParams({ type: WB.type, page: WB.page });
    if (WB.q) qs.set('q', WB.q);
    const res = await fetch(`${CONFIG.apiBase}/bans.php?${qs}`);
    const data = await res.json();
    if (seq !== WB.seq) return;
    if (!res.ok || data.error) throw new Error(data.error || 'bad response');
    banlistAllRows = (data.rows || []).filter(r => !isTestPunishment(r));
    WB.pages = data.pages || 1;
    Object.entries(data.counts || {}).forEach(([k, v]) => {
      const c = document.querySelector(`.wb-count[data-count="${k}"]`);
      if (c) c.textContent = Number(v).toLocaleString('cs-CZ');
    });
    renderBanlistRows();
    renderBanlistPager();
  } catch (err) {
    if (seq !== WB.seq) return;
    banlistAllRows = [];
    if (box) box.innerHTML = '<tr><td colspan="6" class="wb-empty wb-err">Databázi trestů se teď nepodařilo načíst. Zkus to prosím za chvíli.</td></tr>';
  } finally {
    if (seq === WB.seq) document.querySelector('.wb-card')?.classList.remove('is-loading');
  }
}

document.getElementById('banlistTypeTabs')?.addEventListener('click', e => {
  const b = e.target.closest('[data-ban-type]');
  if (!b) return;
  document.querySelectorAll('#banlistTypeTabs .wb-tab').forEach(x => x.classList.toggle('is-active', x === b));
  WB.type = b.dataset.banType; WB.page = 1;
  loadBanlistTable();
});
document.getElementById('wbSearch')?.addEventListener('submit', e => {
  e.preventDefault();
  WB.q = document.getElementById('wbQ').value.trim(); WB.page = 1;
  loadBanlistTable();
});
document.getElementById('wbQ')?.addEventListener('search', e => {
  if (!e.target.value && WB.q) { WB.q = ''; WB.page = 1; loadBanlistTable(); }
});
document.getElementById('wbPager')?.addEventListener('click', e => {
  const b = e.target.closest('[data-page]');
  if (!b || b.disabled) return;
  WB.page = Number(b.dataset.page);
  loadBanlistTable();
  document.getElementById('banlistTypeTabs')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

/* ---------- Profil hráče ---------- */
const wpOverlay = document.getElementById('wpOverlay');
function closePlayerProfile() {
  if (!wpOverlay || wpOverlay.hidden) return;
  wpOverlay.hidden = true;
  document.body.classList.remove('wp-open');
  if (location.hash.startsWith('#hrac/') && history.replaceState) history.replaceState(null, '', '#banlist');
}
async function openPlayerProfile(key) {
  if (!wpOverlay || !key) return;
  const body = document.getElementById('wpBody');
  const isUuid = /^[0-9a-f-]{32,36}$/i.test(key);
  wpOverlay.hidden = false;
  document.body.classList.add('wp-open');
  if (history.replaceState) history.replaceState(null, '', '#hrac/' + encodeURIComponent(key));
  body.innerHTML = `<div class="wp-loading"><img src="${wbHead(isUuid ? '' : key, isUuid ? key : '', 64)}" alt="">Načítám profil…</div>`;
  try {
    const res = await fetch(`${CONFIG.apiBase}/player.php?${isUuid ? 'uuid' : 'nick'}=${encodeURIComponent(key)}`);
    const p = await res.json();
    if (!res.ok || p.error) throw new Error(p.error);
    body.innerHTML = renderPlayerProfile(p, key);
  } catch (e) {
    body.innerHTML = '<div class="wp-loading">Profil se teď nepodařilo načíst. Zkus to prosím za chvíli.</div>';
  }
}
function renderPlayerProfile(p, key) {
  const nick = p.nick || key;
  const list = (p.punishments || []).filter(r => !isTestPunishment({ ...r, nick }));
  const active = p.active || [];
  let state = ['clean', 'Bez trestu'];
  if (active.includes('BAN')) state = ['ban', 'Zabanován'];
  else if (active.includes('MUTE')) state = ['mute', 'Umlčen'];
  const c = p.counts || {};
  const skinId = p.nick || p.uuid || key;
  const names = (p.names || []).slice(1);
  const v = p.votes;
  const stat = (label, val, sub) => `<div class="wp-stat"><div class="wp-stat-l">${label}</div><div class="wp-stat-v">${val}</div>${sub ? `<div class="wp-stat-s">${sub}</div>` : ''}</div>`;
  const first = p.first_seen ? new Date(p.first_seen) : null;
  return `
    <div class="wp-hero">
      <div class="wp-skin"><img src="https://mc-heads.net/body/${encodeURIComponent(skinId)}/240" alt="Skin hráče ${escapeHtml(nick)}"></div>
      <div class="wp-info">
        <h3 class="wp-name">${escapeHtml(nick)}</h3>
        <span class="wp-state ${state[0]}">${state[1]}</span>
        ${names.length ? `<div class="wp-names">Dřív hrál jako: ${names.map(n => `<span>${escapeHtml(n)}</span>`).join('')}</div>` : ''}
        <div class="wp-stats">
          ${stat('Na serveru od', first ? first.toLocaleDateString('cs-CZ') : '–', first ? wbAgo(p.first_seen) : (p.found ? '' : 'na Wylvarionu ještě nehrál'))}
          ${stat('Naposledy připojen', p.last_seen ? wbAgo(p.last_seen) : '–', p.last_seen ? new Date(p.last_seen).toLocaleDateString('cs-CZ') : '')}
          ${stat('Hlasy tento měsíc', v ? v.month : 0, v ? `celkem ${v.total}` : '')}
        </div>
      </div>
    </div>
    <div class="wp-counts">
      ${['BAN', 'MUTE', 'KICK', 'WARN'].map(t => `<div class="wp-count t-${t.toLowerCase()}"><b>${c[t] || 0}</b><span>${{ BAN: 'Bany', MUTE: 'Muty', KICK: 'Kicky', WARN: 'Warny' }[t]}</span></div>`).join('')}
    </div>
    <h4 class="wp-h">Historie trestů</h4>
    ${list.length ? `<div class="wp-list">${list.map(r => `
      <div class="wp-item">
        <span class="wp-type t-${r.type.toLowerCase()}">${WB_TYPE[r.type]}</span>
        <div class="wp-item-main"><div class="wp-item-reason">${escapeHtml(cleanReason(r.reason))}</div>
          <div class="wp-item-meta">${escapeHtml(r.by === 'Console' ? 'Konzole' : r.by)} · ${new Date(r.time).toLocaleString('cs-CZ', { dateStyle: 'medium', timeStyle: 'short' })}${r.type !== 'KICK' && r.style !== 'removed' ? ` · do ${r.until === -1 ? 'odvolání' : new Date(r.until).toLocaleDateString('cs-CZ')}` : ''}</div></div>
        ${wbBadge(r)}
      </div>`).join('')}</div>` : '<div class="wp-clean">Čistý štít, žádný trest. Jen tak dál!</div>'}
  `;
}
document.addEventListener('click', e => {
  const b = e.target.closest('[data-player]');
  if (b && b.dataset.player) { e.preventDefault(); openPlayerProfile(b.dataset.player); return; }
  if (e.target === wpOverlay || e.target.closest('#wpClose')) closePlayerProfile();
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') closePlayerProfile(); });
window.addEventListener('load', () => setTimeout(() => {
  const m = location.hash.match(/^#hrac\/(.+)$/);
  if (m) { showPanel('banlist'); history.replaceState(null, '', '#hrac/' + m[1]); openPlayerProfile(decodeURIComponent(m[1])); }
}, 0));

