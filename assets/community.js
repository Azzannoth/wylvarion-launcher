/* Wylvarion — komunita: Hráči a profily, Síň slávy, Novinky (blog), Updaty, Influencer, Hrát, přihlášení Minecraft účtem. */
(function () {
  'use strict';
  const API = (typeof CONFIG !== 'undefined' && CONFIG.apiBase) || 'api';
  const esc = (s) => (typeof escapeHtml === 'function' ? escapeHtml(s) : String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));
  const $ = (s, r = document) => r.querySelector(s);
  const num = (n, d = 0) => (n == null ? '–' : Number(n).toLocaleString('cs-CZ', { maximumFractionDigits: d, minimumFractionDigits: 0 }));
  const head = (n, s = 64) => `https://mc-heads.net/avatar/${encodeURIComponent(n)}/${s}`;
  const date = (ms) => (ms ? new Date(ms).toLocaleDateString('cs-CZ', { day: 'numeric', month: 'numeric', year: 'numeric' }) : '–');
  const longDate = (ms) => new Date(ms).toLocaleDateString('cs-CZ', { day: 'numeric', month: 'long', year: 'numeric' });
  function ago(ms) {
    if (!ms) return '–';
    const rtf = new Intl.RelativeTimeFormat('cs', { numeric: 'auto' });
    let v = (ms - Date.now()) / 1000;
    for (const [n, u] of [[60, 'second'], [60, 'minute'], [24, 'hour'], [30, 'day'], [12, 'month'], [Infinity, 'year']]) {
      if (Math.abs(v) < n) return rtf.format(Math.round(v), u);
      v /= n;
    }
  }
  async function getJSON(url) {
    const r = await fetch(url, { credentials: 'same-origin' });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || d.ok === false) throw Object.assign(new Error(d.error || 'Chyba'), { data: d, status: r.status });
    return d;
  }
  async function postJSON(url, body) {
    const r = await fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const d = await r.json().catch(() => ({}));
    return { ok: r.ok && d.ok !== false, ...d };
  }
  const hydrate = (el) => { try { if (typeof hydrateMcIcons === 'function') hydrateMcIcons(el); } catch (e) { /* ikony nejsou nutné */ } };
  const setHash = (h) => { if (history.replaceState) history.replaceState(null, '', h); };

  /* =================== HRÁČI =================== */
  const playerRow = (p, extra) => `
    <button type="button" class="cm-player" data-hr="${esc(p.name)}">
      <span class="cm-head"><img src="${head(p.name, 64)}" alt="" loading="lazy">${p.online ? '<i class="cm-dot" title="Online"></i>' : ''}</span>
      <span class="cm-pmain"><b>${esc(p.name)}</b><small>${extra(p)}</small></span>
    </button>`;
  async function hrHome() {
    const box = $('#hrHome');
    if (!box) return;
    box.innerHTML = '<div class="wp-loading">Načítám hráče…</div>';
    try {
      const d = await getJSON(`${API}/players.php?home=1`);
      if (!d.connected) {
        box.innerHTML = `<div class="cm-empty"><b>Statistiky hráčů se právě propojují se serverem.</b><span>Profil kteréhokoli hráče si ale už můžeš vyhledat výš – uvidíš jeho skin, hlasy a tresty.</span></div>`;
        return;
      }
      const sec = (title, list, extra, empty) => `<div class="cm-block"><h3>${title}</h3>${list.length ? `<div class="cm-pgrid">${list.map((p) => playerRow(p, extra)).join('')}</div>` : `<div class="cm-empty small">${empty}</div>`}</div>`;
      box.innerHTML =
        sec(`<span class="cm-live"></span>Právě online <em>${d.online.length}</em>`, d.online, (p) => `${num(p.hours)} h odehráno`, 'Teď nikdo nehraje.') +
        sec('Naposledy aktivní', d.recent, (p) => (p.online ? 'Online' : ago(p.last)), '') +
        sec('Noví hráči', d.newest, (p) => `poprvé ${ago(p.first)}`, '') +
        `<p class="cm-note">Na Wylvarionu hrálo už <b>${num(d.count)}</b> hráčů.</p>`;
    } catch (e) {
      box.innerHTML = '<div class="cm-empty">Hráče se teď nepodařilo načíst.</div>';
    }
  }
  let sugTimer = null;
  function hrSuggest(q) {
    const box = $('#hrSuggest');
    clearTimeout(sugTimer);
    if (!q) { box.hidden = true; return; }
    sugTimer = setTimeout(async () => {
      try {
        const d = await getJSON(`${API}/players.php?q=${encodeURIComponent(q)}`);
        box.innerHTML = d.players.map((p) => playerRow(p, (x) => (x.online ? 'Online' : `${num(x.hours)} h · ${ago(x.last)}`))).join('') || `<div class="cm-sug-empty">Žádný hráč „${esc(q)}“. Enterem zkusíš otevřít profil i tak.</div>`;
        box.hidden = false;
      } catch (e) { box.hidden = true; }
    }, 180);
  }

  const FRAME_LABEL = {};
  async function openProfile(nick) {
    if (!nick) return;
    if (typeof showPanel === 'function' && !$('#panel-hraci').classList.contains('is-active')) showPanel('hraci');
    $('#hrList').hidden = true;
    const box = $('#hrProfile');
    box.hidden = false;
    box.innerHTML = `<div class="wp-loading"><img src="${head(nick, 64)}" alt="">Načítám profil…</div>`;
    setHash('#hraci/' + encodeURIComponent(nick));
    $('#hrHeading').textContent = nick;
    $('#hrSub').textContent = 'Veřejný profil hráče';
    window.scrollTo(0, 0);
    try {
      const p = await getJSON(`${API}/players.php?nick=${encodeURIComponent(nick)}`);
      renderProfile(p);
    } catch (e) {
      box.innerHTML = `<button type="button" class="wiki-back-btn" data-hr-back>← Zpět na hráče</button><div class="cm-empty"><b>${esc(e.message || 'Profil se nepodařilo načíst.')}</b></div>`;
    }
  }
  function closeProfile() {
    $('#hrProfile').hidden = true;
    $('#hrList').hidden = false;
    $('#hrHeading').textContent = 'Hráči';
    $('#hrSub').textContent = 'Vyhledej si profil kteréhokoli hráče Wylvarionu – odehraný čas, statistiky, odznaky a další.';
    setHash('#hraci');
  }
  function renderProfile(p) {
    const s = p.stats || {};
    const pun = p.punishments || {};
    const state = pun.active === 'BAN' ? ['ban', 'Zabanován'] : pun.active === 'MUTE' ? ['mute', 'Umlčen'] : ['clean', pun.total ? `${pun.total}× trestán` : 'Bez trestu'];
    const kd = s.deaths ? (s.kills / Math.max(1, s.deaths)).toFixed(2) : (s.kills ? String(s.kills) : '–');
    const card = (ic, label, val, sub) => `<div class="pf-stat"><span class="pf-ic">${ic}</span><div><small>${label}</small><b>${val}</b>${sub ? `<em>${sub}</em>` : ''}</div></div>`;
    const stats = p.stats ? [
      card('⏳', 'Odehráno', s.hours != null && p.connected ? `${num(Math.floor(s.hours))} h` : '–', s.hours != null && p.connected ? `${num(Math.round((s.hours % 1) * 60))} min` : 'po propojení se serverem'),
      card('📅', 'Na serveru od', date(s.first), s.first ? ago(s.first) : ''),
      card('🟢', 'Naposledy online', p.online ? 'Právě hraje' : ago(s.last), p.online ? '' : date(s.last)),
      card('💰', 'Peníze', s.money != null ? num(s.money, 0) : '–', ''),
      card('⚔️', 'Zabití hráčů', num(s.kills), `K/D ${kd}`),
      card('💀', 'Úmrtí', num(s.deaths), ''),
      card('🐉', 'Zabití mobů', num(s.mobs), ''),
      card('🗳️', 'Hlasy', p.votes ? num(p.votes.month) : '0', p.votes ? `tento měsíc · celkem ${num(p.votes.total)}` : 'tento měsíc'),
      card('🎣', 'Chycené ryby', num(s.fish), ''),
      card('🧭', 'Nachozeno', s.km != null ? `${num(s.km, 1)} km` : '–', ''),
    ].join('') : `<div class="cm-empty small" style="grid-column:1/-1">Statistiky tohoto hráče zatím nemáme.</div>`;
    const badges = p.badges.map((b) => `<div class="pf-badge${b.has ? ' is-on' : ''}" title="${esc(b.desc)}"><span>${b.icon}</span><b>${esc(b.name)}</b><small>${esc(b.desc)}</small></div>`).join('');
    const got = p.badges.filter((b) => b.has).length;
    $('#hrProfile').innerHTML = `
      <button type="button" class="wiki-back-btn" data-hr-back>← Zpět na hráče</button>
      <div class="pf-hero">
        <div class="pf-skin frame-${esc(p.frame)}"><img src="https://mc-heads.net/body/${encodeURIComponent(p.name)}/260" alt="Skin hráče ${esc(p.name)}"></div>
        <div class="pf-info">
          <div class="pf-tags">
            ${p.online ? '<span class="pf-tag online">● Online</span>' : ''}
            ${p.team ? `<span class="pf-tag team">🛡️ ${esc(p.team)}</span>` : ''}
            ${p.sponsor ? '<span class="pf-tag sponsor">💎 Sponzor</span>' : ''}
            <span class="pf-tag st-${state[0]}">${state[1]}</span>
          </div>
          <h3 class="pf-name">${esc(p.name)}</h3>
          ${p.bio ? `<p class="pf-bio">„${esc(p.bio)}“</p>` : (p.own ? '<p class="pf-bio muted">Zatím nemáš žádné bio. Napiš něco o sobě!</p>' : '')}
          <div class="pf-actions">
            ${p.own ? '<button type="button" class="wb-btn" data-pf-edit>Upravit profil</button>' : ''}
            ${pun.total ? `<button type="button" class="btn btn-ghost btn-sm" data-pf-bans="${esc(p.name)}">Historie trestů</button>` : ''}
            <button type="button" class="btn btn-ghost btn-sm" data-pf-share>Kopírovat odkaz</button>
          </div>
        </div>
      </div>
      <h4 class="pf-h">Statistiky</h4>
      <div class="pf-stats">${stats}</div>
      <h4 class="pf-h">Odznaky <em>${got} / ${p.badges.length}</em></h4>
      <div class="pf-badges">${badges}</div>
      ${!p.own ? '<p class="cm-note">Je to tvůj profil? <button type="button" class="linkish" data-open-mclogin>Přihlas se Minecraft účtem</button> a můžeš si napsat bio a vybrat rámeček.</p>' : ''}
      <div class="wp-overlay" id="pfEdit" hidden><div class="wp-modal pf-edit">
        <button class="wp-close" type="button" data-pf-close aria-label="Zavřít">×</button>
        <h3>Upravit profil</h3>
        <label>Bio <small>(max. 160 znaků, musí dodržovat pravidla serveru)</small></label>
        <textarea id="pfBio" maxlength="160" rows="3" placeholder="Oblíbená hláška, vtip nebo něco o tobě…">${esc(p.bio || '')}</textarea>
        <label>Rámeček avataru</label>
        <div class="pf-frames">${p.frames.map((f) => `<button type="button" class="pf-frame frame-${f.id}${f.id === p.frame ? ' is-sel' : ''}" data-frame="${f.id}" ${f.unlocked ? '' : 'disabled'} title="${f.unlocked ? '' : 'Zatím zamčeno'}"><img src="${head(p.name, 64)}" alt=""><span>${esc(f.name)}${f.unlocked ? '' : ' 🔒'}</span></button>`).join('')}</div>
        <div class="rt-form-foot"><span class="rt-msg" id="pfMsg"></span><button type="button" class="wb-btn" data-pf-save>Uložit</button></div>
      </div></div>`;
    const box = $('#hrProfile');
    box.querySelectorAll('[data-frame]').forEach((b) => b.addEventListener('click', () => {
      box.querySelectorAll('[data-frame]').forEach((x) => x.classList.toggle('is-sel', x === b));
    }));
    box.querySelector('[data-pf-edit]')?.addEventListener('click', () => { $('#pfEdit').hidden = false; });
    box.querySelector('[data-pf-close]')?.addEventListener('click', () => { $('#pfEdit').hidden = true; });
    box.querySelector('[data-pf-save]')?.addEventListener('click', async () => {
      const frame = box.querySelector('.pf-frame.is-sel')?.dataset.frame || 'basic';
      const r = await postJSON(`${API}/players.php`, { bio: $('#pfBio').value, frame });
      if (!r.ok) { $('#pfMsg').textContent = r.error || 'Uložení se nepovedlo.'; return; }
      openProfile(p.name);
    });
    box.querySelector('[data-pf-share]')?.addEventListener('click', (e) => {
      navigator.clipboard?.writeText(`${location.origin}/#hraci/${encodeURIComponent(p.name)}`);
      e.target.textContent = 'Zkopírováno ✓';
    });
    box.querySelector('[data-pf-bans]')?.addEventListener('click', () => {
      if (typeof showPanel === 'function') showPanel('banlist');
      const q = $('#wbQ');
      if (q) { q.value = p.name; $('#wbSearch')?.dispatchEvent(new Event('submit', { cancelable: true })); }
    });
  }

  /* =================== SÍŇ SLÁVY =================== */
  const SL = [
    { id: 'play', label: '⏳ Odehraný čas', fmt: (v) => `${num(Math.floor(v / 72000))} h ${num(Math.floor((v % 72000) / 1200))} min`, title: 'Hráči, kteří odehráli nejvíc' },
    { id: 'money', label: '💰 Peníze', fmt: (v) => num(v, 0), title: 'Nejbohatší hráči' },
    { id: 'votes', label: '🗳️ Hlasy', fmt: (v) => `${num(v)} hlasů`, title: 'Nejvíc hlasů pro server celkem' },
    { id: 'kills', label: '⚔️ Zabití hráčů', fmt: (v) => `${num(v)} zabití`, title: 'Nejlepší bojovníci' },
    { id: 'mobs', label: '🐉 Zabití mobů', fmt: (v) => `${num(v)} mobů`, title: 'Největší lovci' },
    { id: 'fish', label: '🎣 Rybaření', fmt: (v) => `${num(v)} ryb`, title: 'Nejlepší rybáři' },
  ];
  let slCur = 'play';
  async function slRender() {
    const tabs = $('#slTabs');
    if (!tabs) return;
    tabs.innerHTML = SL.map((t) => `<button type="button" class="wq-chip${t.id === slCur ? ' is-active' : ''}" data-sl="${t.id}">${t.label}</button>`).join('');
    const def = SL.find((t) => t.id === slCur);
    const box = $('#slMount');
    box.innerHTML = '<div class="wp-loading">Načítám žebříček…</div>';
    try {
      const d = await getJSON(`${API}/players.php?top=${slCur}`);
      if (!d.top.length) {
        box.innerHTML = `<div class="cm-empty"><b>${d.connected === false ? 'Žebříčky se právě propojují se serverem.' : 'Zatím tu nikdo není.'}</b><span>${d.connected === false ? 'Jakmile server pošle statistiky, objeví se tu nejlepší hráči.' : ''}</span></div>`;
        return;
      }
      const top3 = d.top.slice(0, 3);
      const order = [1, 0, 2].filter((i) => top3[i]);
      box.innerHTML = `<h3 class="sl-title">${def.title}</h3>
        <div class="sl-podium">${order.map((i) => { const r = top3[i]; return `
          <button type="button" class="sl-pod p${i + 1}" data-hr="${esc(r.name)}">
            <img src="https://mc-heads.net/body/${encodeURIComponent(r.name)}/150" alt="" loading="lazy">
            <span class="sl-place">${i + 1}</span><b>${esc(r.name)}</b><small>${def.fmt(r.value)}</small>
          </button>`; }).join('')}</div>
        <div class="sl-list">${d.top.slice(3).map((r, k) => `
          <button type="button" class="sl-row" data-hr="${esc(r.name)}"><span class="sl-n">${k + 4}</span><img src="${head(r.name, 48)}" alt="" loading="lazy"><b>${esc(r.name)}</b>${r.online ? '<i class="cm-dot"></i>' : ''}<em>${def.fmt(r.value)}</em></button>`).join('')}</div>`;
    } catch (e) {
      box.innerHTML = '<div class="cm-empty">Žebříček se teď nepodařilo načíst.</div>';
    }
  }

  /* =================== NOVINKY (BLOG) =================== */
  function md(text) {
    const lines = esc(text).split(/\r?\n/);
    let html = '', list = false, para = [];
    const inline = (s) => s
      .replace(/!\[([^\]]*)\]\((https:\/\/[^)\s]+)\)/g, '<img src="$2" alt="$1" loading="lazy">')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+|#[\w/-]+)\)/g, (m, t, u) => `<a href="${u}"${u.startsWith('#') ? '' : ' target="_blank" rel="noopener"'}>${t}</a>`)
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[\s(])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');
    const flush = () => { if (para.length) { html += `<p>${inline(para.join('<br>'))}</p>`; para = []; } };
    for (const raw of lines) {
      const l = raw.trim();
      if (/^#{1,3}\s/.test(l)) { flush(); if (list) { html += '</ul>'; list = false; } const lv = Math.min(4, l.match(/^#+/)[0].length + 2); html += `<h${lv}>${inline(l.replace(/^#+\s/, ''))}</h${lv}>`; continue; }
      if (/^[-•]\s/.test(l)) { flush(); if (!list) { html += '<ul>'; list = true; } html += `<li>${inline(l.slice(2))}</li>`; continue; }
      if (list && l === '') { html += '</ul>'; list = false; continue; }
      if (l === '') { flush(); continue; }
      if (list) { html += '</ul>'; list = false; }
      para.push(l);
    }
    flush();
    if (list) html += '</ul>';
    return html;
  }
  const icon = (n) => (typeof mcImg === 'function' ? mcImg(n) : '');
  async function nwList() {
    const box = $('#nwMount');
    if (!box) return;
    box.innerHTML = '<div class="wp-loading">Načítám novinky…</div>';
    try {
      const d = await getJSON(`${API}/posts.php`);
      const [first, ...rest] = d.posts;
      const card = (p, big) => `
        <button type="button" class="nw-card${big ? ' is-big' : ''}" data-nw="${esc(p.id)}" style="--t:${esc(p.color)}">
          ${p.cover ? `<span class="nw-cover" style="background-image:url('${esc(p.cover)}')"></span>` : ''}
          <span class="nw-meta"><span class="nw-tag">${icon(p.icon)}${esc(p.tag)}</span><span>${longDate(p.time)}</span>${big ? '<span class="nw-new">Nejnovější</span>' : ''}</span>
          <b>${esc(p.title)}</b>
          <p>${esc(p.excerpt)}</p>
          <span class="nw-foot"><span>${p.readMin} min čtení</span><span>${p.reactions.reduce((a, r) => a + r.count, 0) ? `${p.reactions.filter((r) => r.count).slice(0, 3).map((r) => r.emoji).join('')} ${p.reactions.reduce((a, r) => a + r.count, 0)}` : ''} ${p.commentCount ? `💬 ${p.commentCount}` : ''}</span><span class="wq-arrow">Číst →</span></span>
        </button>`;
      box.innerHTML = `${d.staff ? '<div class="nw-admin"><button type="button" class="wb-btn" data-nw-new>+ Nový článek</button></div>' : ''}
        ${first ? card(first, true) : '<div class="cm-empty">Zatím žádné novinky.</div>'}
        <div class="nw-grid">${rest.map((p) => card(p, false)).join('')}</div>`;
      hydrate(box);
      box.querySelector('[data-nw-new]')?.addEventListener('click', () => nwEditor(null));
    } catch (e) {
      box.innerHTML = '<div class="cm-empty">Novinky se teď nepodařilo načíst.</div>';
    }
  }
  async function nwOpen(id) {
    if (typeof showPanel === 'function' && !$('#panel-novinky').classList.contains('is-active')) showPanel('novinky');
    const box = $('#nwMount');
    box.innerHTML = '<div class="wp-loading">Načítám článek…</div>';
    setHash('#novinky/' + encodeURIComponent(id));
    window.scrollTo(0, 0);
    try {
      const d = await getJSON(`${API}/posts.php?id=${encodeURIComponent(id)}`);
      const p = d.post;
      const login = `${API}/discord-login.php?ret=novinky`;
      box.innerHTML = `
        <button type="button" class="wiki-back-btn" data-nw-back>← Všechny novinky</button>
        <article class="nw-article" style="--t:${esc(p.color)}">
          ${p.cover ? `<img class="nw-acover" src="${esc(p.cover)}" alt="">` : ''}
          <div class="nw-meta"><span class="nw-tag">${icon(p.icon)}${esc(p.tag)}</span><span>${longDate(p.time)}</span><span>${p.readMin} min čtení</span></div>
          <h1>${esc(p.title)}</h1>
          <div class="nw-author"><img src="${head(p.author === 'Wylvarion Team' ? 'MHF_Chest' : p.author, 40)}" alt="">${esc(p.author)}</div>
          <div class="nw-body">${md(p.body)}</div>
          ${p.go && p.go.wiki ? `<button type="button" class="wb-btn" data-wiki-go="${esc(p.go.wiki)}">Otevřít ve Wiki →</button>` : ''}
          ${p.go && p.go.panel ? `<button type="button" class="wb-btn" data-tab-link="${esc(p.go.panel)}">Přejít →</button>` : ''}
          ${d.staff ? `<div class="nw-admin"><button type="button" class="btn btn-ghost btn-sm" data-nw-edit>Upravit článek</button>${d.admin ? '<button type="button" class="btn btn-ghost btn-sm prof-danger" data-nw-del>Smazat</button>' : ''}</div>` : ''}
          <div class="nw-react">${p.reactions.map((r) => `<button type="button" class="nw-r${r.mine ? ' is-mine' : ''}" data-react="${r.emoji}">${r.emoji}<b>${r.count || ''}</b></button>`).join('')}</div>
        </article>
        <div class="nw-nav">${d.newer ? `<button type="button" data-nw="${esc(d.newer.id)}"><small>← Novější</small>${esc(d.newer.title)}</button>` : '<span></span>'}${d.older ? `<button type="button" data-nw="${esc(d.older.id)}" class="r"><small>Starší →</small>${esc(d.older.title)}</button>` : ''}</div>
        <section class="nw-comments">
          <h3>Komentáře <em>${p.comments.length}</em></h3>
          ${d.me ? `<form class="rt-form nw-cform" id="nwCForm"><div class="rt-form-head"><img src="${esc(d.me.avatar)}" alt=""><div><b>${esc(d.me.name)}</b><span>Napiš komentář</span></div></div>
            <textarea name="text" maxlength="600" rows="3" placeholder="Co na to říkáš?"></textarea>
            <div class="rt-form-foot"><span class="rt-msg" id="nwMsg"></span><button type="submit" class="wb-btn">Odeslat</button></div></form>`
            : d.gate === 'login'
              ? `<div class="rt-gate"><b>Chceš komentovat nebo reagovat?</b><span>Komentovat a reagovat mohou hráči s rolí Člen a vyšší na našem Discordu.</span><a class="dc-btn" href="${login}">Přihlásit přes Discord</a></div>`
              : `<div class="rt-gate"><b>${d.gate === 'not_member' ? 'Nejsi na našem Discordu' : 'Chybí ti role Člen'}</b><span>Komentovat a reagovat mohou jen hráči s rolí Člen a vyšší na našem Discordu. Získáš ji ověřením na serveru, pak se přihlas znovu.</span><div class="nw-logins"><a class="btn btn-ghost btn-sm" href="https://discord.gg/Q7PUz7ARsS" target="_blank" rel="noopener">Připojit se na Discord</a><a class="dc-btn" href="${login}">Přihlásit znovu</a></div></div>`}
          <div class="rt-list">${p.comments.slice().reverse().map((c) => `
            <div class="rt-item"><img src="${esc(c.avatar)}" alt="" loading="lazy"><div class="rt-item-main">
              <div class="rt-item-top"><b>${esc(c.name)}</b><small>${ago(c.time)}</small></div><p>${esc(c.text).replace(/\n/g, '<br>')}</p></div>
              ${c.mine || d.admin ? `<button type="button" class="rt-remove" data-cdel="${esc(c.id)}" title="Smazat">×</button>` : ''}</div>`).join('') || '<div class="cm-empty small">Zatím žádné komentáře. Buď první!</div>'}</div>
        </section>`;
      hydrate(box);
      box.querySelectorAll('[data-react]').forEach((b) => b.addEventListener('click', async () => {
        if (!d.me) { box.querySelector('.nw-comments')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
        const r = await postJSON(`${API}/posts.php`, { action: 'react', id: p.id, emoji: b.dataset.react });
        if (r.ok) nwOpen(p.id);
      }));
      $('#nwCForm')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = e.target.querySelector('[type=submit]');
        btn.disabled = true;
        const r = await postJSON(`${API}/posts.php`, { action: 'comment', id: p.id, text: e.target.text.value });
        btn.disabled = false;
        if (!r.ok) { $('#nwMsg').textContent = r.error || 'Odeslání se nepovedlo.'; return; }
        nwOpen(p.id);
      });
      box.querySelectorAll('[data-cdel]').forEach((b) => b.addEventListener('click', async () => {
        if (!confirm('Smazat komentář?')) return;
        await postJSON(`${API}/posts.php`, { action: 'delcomment', id: p.id, cid: b.dataset.cdel });
        nwOpen(p.id);
      }));
      box.querySelector('[data-nw-edit]')?.addEventListener('click', () => nwEditor(p));
      box.querySelector('[data-nw-del]')?.addEventListener('click', async () => {
        if (!confirm('Opravdu smazat celý článek?')) return;
        await postJSON(`${API}/posts.php`, { action: 'delete', id: p.id });
        nwList(); setHash('#novinky');
      });
    } catch (e) {
      box.innerHTML = `<button type="button" class="wiki-back-btn" data-nw-back>← Všechny novinky</button><div class="cm-empty">${esc(e.message || 'Článek se nepodařilo načíst.')}</div>`;
    }
  }
  function nwEditor(p) {
    let o = $('#nwEditor');
    if (!o) { o = document.createElement('div'); o.id = 'nwEditor'; o.className = 'wp-overlay'; document.body.appendChild(o); }
    p = p || { title: '', tag: 'Novinka', color: '#a855f7', icon: 'paper', excerpt: '', body: '', cover: '' };
    o.innerHTML = `<div class="wp-modal nw-editor"><button class="wp-close" type="button" data-x>×</button>
      <h3>${p.id ? 'Upravit článek' : 'Nový článek'}</h3>
      <label>Nadpis</label><input id="neTitle" maxlength="120" value="${esc(p.title)}">
      <div class="ne-row"><div><label>Štítek</label><input id="neTag" maxlength="24" value="${esc(p.tag)}"></div><div><label>Barva</label><input id="neColor" type="color" value="${esc(p.color)}"></div><div><label>Ikona (MC item)</label><input id="neIcon" value="${esc(p.icon)}"></div></div>
      <label>Obrázek nahoře (https odkaz, nepovinné)</label><input id="neCover" value="${esc(p.cover || '')}" placeholder="https://…">
      <label>Krátký popis na kartu (nepovinné)</label><input id="neExcerpt" maxlength="220" value="${esc(p.excerpt)}">
      <label>Text <small>## nadpis, **tučně**, *kurzíva*, - odrážka, [odkaz](https://…), ![obrázek](https://…)</small></label>
      <textarea id="neBody" rows="14">${esc(p.body || '')}</textarea>
      <div class="rt-form-foot"><span class="rt-msg" id="neMsg"></span><button type="button" class="wb-btn" data-save>Uložit a zveřejnit</button></div></div>`;
    o.hidden = false;
    document.body.classList.add('wp-open');
    const close = () => { o.hidden = true; document.body.classList.remove('wp-open'); };
    o.querySelector('[data-x]').onclick = close;
    o.querySelector('[data-save]').onclick = async () => {
      const r = await postJSON(`${API}/posts.php`, { action: 'save', post: { id: p.id, title: $('#neTitle').value, tag: $('#neTag').value, color: $('#neColor').value, icon: $('#neIcon').value, cover: $('#neCover').value, excerpt: $('#neExcerpt').value, body: $('#neBody').value } });
      if (!r.ok) { $('#neMsg').textContent = r.error || 'Uložení se nepovedlo.'; return; }
      close();
      nwOpen(r.id);
    };
  }

  /* =================== UPDATY =================== */
  const KIND = { new: ['✨', 'Novinka'], fix: ['🔧', 'Oprava'], change: ['🔄', 'Změna'], remove: ['🗑️', 'Odebráno'] };
  let upCat = 'Vše';
  let upData = null;
  async function upLoad() {
    try { upData = await getJSON(`${API}/updates.php`); upRender(); } catch (e) { $('#upMount').innerHTML = '<div class="cm-empty">Updaty se teď nepodařilo načíst.</div>'; }
  }
  function upRender() {
    const box = $('#upMount');
    if (!box || !upData) return;
    const d = upData;
    const counts = { 'Vše': d.items.length };
    d.cats.forEach((c) => { counts[c] = d.items.filter((i) => i.cat === c).length; });
    const items = d.items.filter((i) => upCat === 'Vše' || i.cat === upCat);
    const months = {};
    items.forEach((i) => { const k = new Date(i.time).toLocaleDateString('cs-CZ', { month: 'long', year: 'numeric' }); (months[k] = months[k] || []).push(i); });
    box.innerHTML = `
      <div class="wq-bar"><div class="wq-chips">${['Vše', ...d.cats].map((c) => `<button type="button" class="wq-chip${c === upCat ? ' is-active' : ''}" data-up="${c}">${c} <span class="wb-count">${counts[c] || 0}</span></button>`).join('')}</div></div>
      ${d.staff ? `<form class="rt-form up-add" id="upAdd"><b>Přidat změnu</b><div class="ne-row">
        <select name="cat">${d.cats.map((c) => `<option>${c}</option>`).join('')}</select>
        <select name="kind">${Object.entries(KIND).map(([k, v]) => `<option value="${k}">${v[0]} ${v[1]}</option>`).join('')}</select></div>
        <input name="text" maxlength="300" placeholder="Co se změnilo…"><div class="rt-form-foot"><span class="rt-msg" id="upMsg"></span><button class="wb-btn" type="submit">Přidat</button></div></form>` : ''}
      ${Object.entries(months).map(([m, list]) => {
        const byCat = {};
        list.forEach((i) => { (byCat[i.cat] = byCat[i.cat] || []).push(i); });
        return `<div class="up-month"><h3>${m.charAt(0).toUpperCase() + m.slice(1)} <em>${list.length} změn</em></h3>
          ${Object.entries(byCat).map(([c, l]) => `<div class="up-cat"><h4>${esc(c)} <em>${l.length} změn</em></h4>
            ${l.map((i) => `<div class="up-item"><span class="up-k" title="${KIND[i.kind]?.[1] || ''}">${KIND[i.kind]?.[0] || '•'}</span><p>${esc(i.text)}</p><small>${new Date(i.time).toLocaleDateString('cs-CZ', { day: 'numeric', month: 'numeric' })}</small>${d.admin ? `<button type="button" class="rt-remove" data-updel="${i.id}">×</button>` : ''}</div>`).join('')}</div>`).join('')}</div>`;
      }).join('') || '<div class="cm-empty">V této kategorii zatím nic není.</div>'}`;
    $('#upAdd')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target;
      const r = await postJSON(`${API}/updates.php`, { action: 'add', cat: f.cat.value, kind: f.kind.value, text: f.text.value });
      if (!r.ok) { $('#upMsg').textContent = r.error || 'Nepovedlo se.'; return; }
      upLoad();
    });
    box.querySelectorAll('[data-updel]').forEach((b) => b.addEventListener('click', async () => {
      if (!confirm('Smazat tuhle změnu?')) return;
      await postJSON(`${API}/updates.php`, { action: 'delete', id: b.dataset.updel });
      upLoad();
    }));
  }

  /* =================== INFLUENCER =================== */
  function inRender() {
    const box = $('#inMount');
    if (!box || typeof INFLUENCERS === 'undefined') return;
    const I = INFLUENCERS;
    const li = (arr) => arr.map((r) => `<li>${esc(r)}</li>`).join('');
    box.innerHTML = `
      ${I.highlight ? `<div class="in-god"><div class="in-god-ic">👑</div><div><b>${esc(I.highlight.title)}</b><span>${esc(I.highlight.text)}</span></div></div>` : ''}
      <div class="in-hero"><div><b>Jak zažádat o rank tvůrce</b><span>Vyber si, co děláš, splň podmínky a pošli žádost o spolupráci přímo tady na webu. Stačí být na našem Discordu – role Člen není potřeba.</span></div>
        <button type="button" class="wb-btn" data-sp-open>Podat žádost o spolupráci</button></div>
      ${I.common_req ? `<div class="in-common">
        <div class="in-box"><h4>📋 Podmínky pro všechny tvůrce</h4><ul>${li(I.common_req)}</ul></div>
        <div class="in-box in-good"><h4>🎁 Co dostane každý tvůrce</h4><ul class="in-perks">${li(I.common_perks || [])}</ul></div></div>` : ''}
      <div class="in-grid">${I.tiers.map((t) => `
        <div class="in-card" style="--c:${t.color}"><div class="in-ic">${t.icon}</div><h3>${esc(t.name)}</h3>
          <h4>Podmínky navíc</h4><ul>${li(t.req)}</ul>
          <h4>Co získáš</h4><ul class="in-perks">${t.perks.map((r) => `<li${/GOD VIP/i.test(r) ? ' class="in-vip"' : ''}>${esc(r)}</li>`).join('')}</ul></div>`).join('')}</div>
      ${I.rules ? `<div class="in-rules"><h3 class="sl-title">Pravidla pro tvůrce</h3><p class="cm-note">Rank tvůrce je odměna, ne nárok. Kdo pravidla nedodržuje, o rank i GOD VIP přijde.</p>
        <div class="in-rgrid">${I.rules.map((r) => `<div class="in-rule"><span>${r.icon}</span><div><b>${esc(r.title)}</b><p>${esc(r.text)}</p></div></div>`).join('')}</div></div>` : ''}
      <div class="in-steps"><h3 class="sl-title">Jak to probíhá</h3><ol>
        <li><b>Natoč obsah</b><span>Reels, klipy, shorts, videa nebo streamy z Wylvarionu.</span></li>
        <li><b>Pošli žádost</b><span>V Žádostech → Spolupráce vyplň odkazy na svůj kanál a obsah. Stačí být na našem Discordu.</span></li>
        <li><b>Schválení</b><span>Admin team projde tvůj obsah a ozve se ti obvykle do pár dní.</span></li>
        <li><b>Rank a GOD VIP</b><span>Dostaneš rank tvůrce a GOD VIP natrvalo, dokud rank máš.</span></li></ol>
        <p class="cm-note">Odesláním žádosti souhlasíš s pravidly pro tvůrce výše.</p></div>
      <h3 class="sl-title">Naši tvůrci</h3>
      ${I.creators.length ? `<div class="in-creators">${I.creators.map((c) => { const t = I.tiers.find((x) => x.id === c.type) || {}; return `
        <a class="in-creator" href="${esc(c.url || '#')}" target="_blank" rel="noopener" style="--c:${t.color || '#a855f7'}"><img src="https://mc-heads.net/body/${encodeURIComponent(c.nick)}/140" alt="" loading="lazy"><b>${esc(c.nick)}</b><span>${esc(t.name || 'Tvůrce')}</span></a>`; }).join('')}</div>`
        : '<div class="cm-empty"><b>Zatím tu nikdo není.</b><span>Buď první tvůrce Wylvarionu a získej GOD VIP natrvalo!</span></div>'}`;
  }


  /* =================== ŽÁDOST O SPOLUPRÁCI (tvůrci) =================== */
  function spOpenTab() {
    if (typeof showPanel === 'function') showPanel('zadosti');
    document.querySelector('.zadost-tab[data-zadost-tab="spoluprace"]')?.click();
  }
  async function spGate() {
    const gate = $('#spGate'), form = $('#spolupraceForm');
    if (!gate || !form) return;
    let st = { logged: false, inGuild: false };
    try { st = await getJSON(`${API}/relay-spoluprace.php`); } catch (e) { /* nepřihlášen */ }
    const login = `<a class="dc-btn" href="${API}/discord-login.php?ret=zadosti" data-sp-login>Přihlásit přes Discord</a>`;
    const join = `<a class="btn btn-ghost btn-sm" href="https://discord.gg/Q7PUz7ARsS" target="_blank" rel="noopener">Připojit se na Discord</a>`;
    if (st.inGuild) { gate.style.display = 'none'; form.style.display = ''; return; }
    form.style.display = 'none';
    gate.style.display = '';
    gate.innerHTML = st.logged
      ? `<b>Nejsi na našem Discordu</b><p>Žádost o spolupráci může poslat každý, kdo je na našem Discord serveru (role Člen není potřeba). Připoj se a pak se přihlas znovu.</p><div class="nw-logins">${join}${login}</div>`
      : `<b>Přihlas se přes Discord</b><p>Žádost o spolupráci může poslat každý, kdo je na našem Discord serveru – role Člen není potřeba. Přihlášení trvá pár vteřin.</p><div class="nw-logins">${login}${join}</div>`;
    gate.querySelectorAll('[data-sp-login]').forEach((a) => a.addEventListener('click', () => { try { sessionStorage.setItem('wylSpTab', '1'); } catch (e) { /* nic */ } }));
  }
  $('#spolupraceForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target, ok = $('#spOk'), err = $('#spErr'), btn = $('#spSubmit');
    ok.style.display = 'none'; err.style.display = 'none';
    btn.disabled = true; btn.textContent = 'Odesílám…';
    const data = Object.fromEntries(new FormData(f).entries());
    const r = await postJSON(`${API}/relay-spoluprace.php`, data);
    btn.disabled = false; btn.textContent = 'Odeslat žádost o spolupráci';
    if (r.ok) { ok.style.display = 'block'; f.reset(); return; }
    err.textContent = r.error === 'discord_required' ? 'Nejdřív se přihlas přes Discord a připoj se na náš server.' : r.error === 'too_many' ? 'Moc žádostí za krátkou dobu, zkus to prosím později.' : 'Odeslání se nepovedlo. Zkus to prosím znovu.';
    err.style.display = 'block';
    if (r.error === 'discord_required') spGate();
  });
  document.querySelector('.zadost-tab[data-zadost-tab="spoluprace"]')?.addEventListener('click', spGate);
  document.addEventListener('click', (e) => { if (e.target.closest('[data-sp-open]')) { e.preventDefault(); spOpenTab(); spGate(); } }, true);
  window.addEventListener('load', () => setTimeout(() => {
    let f = null; try { f = sessionStorage.getItem('wylSpTab'); sessionStorage.removeItem('wylSpTab'); } catch (e) { /* nic */ }
    if (f) { spOpenTab(); spGate(); }
  }, 400));

  /* =================== ADMIN TEAM: banner + sociální sítě =================== */
  const SOC = {
    discord: ['Discord', 'M20.3 4.4A19.8 19.8 0 0 0 15.4 3l-.6 1.3a18.3 18.3 0 0 0-5.5 0L8.6 3a19.7 19.7 0 0 0-4.9 1.5C.6 9.1-.3 13.6.1 18.1a19.9 19.9 0 0 0 6 3l1.3-2a13 13 0 0 1-2-1l.5-.4a14.2 14.2 0 0 0 12.2 0l.5.4-2 1 1.3 2a19.8 19.8 0 0 0 6-3c.5-5.2-.8-9.7-3.6-13.7ZM8 15.3c-1.2 0-2.2-1.1-2.2-2.4S6.8 10.5 8 10.5s2.2 1.1 2.2 2.4-1 2.4-2.2 2.4Zm8 0c-1.2 0-2.2-1.1-2.2-2.4s1-2.4 2.2-2.4 2.2 1.1 2.2 2.4-1 2.4-2.2 2.4Z'],
    youtube: ['YouTube', 'M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.6 12 3.6 12 3.6s-7.5 0-9.4.5A3 3 0 0 0 .5 6.2 31 31 0 0 0 0 12a31 31 0 0 0 .5 5.8 3 3 0 0 0 2.1 2.1c1.9.5 9.4.5 9.4.5s7.5 0 9.4-.5a3 3 0 0 0 2.1-2.1A31 31 0 0 0 24 12a31 31 0 0 0-.5-5.8ZM9.6 15.6V8.4l6.3 3.6-6.3 3.6Z'],
    twitch: ['Twitch', 'M2.1 0 .5 4.2v16.7h5.8V24h3.2l3.2-3.1h4.7l6.2-6.3V0H2.1Zm19.4 13.6-3.6 3.7h-5.8L9 20.4v-3.1H4.2V2.1h17.3v11.5ZM17.9 6.3v6.3h-2.1V6.3h2.1Zm-5.8 0v6.3H10V6.3h2.1Z'],
    tiktok: ['TikTok', 'M19.6 6.7a4.8 4.8 0 0 1-3.8-4.3V2h-3.4v13.7a2.9 2.9 0 1 1-2-2.8V9.5a6.3 6.3 0 1 0 5.4 6.2V8.8a8.2 8.2 0 0 0 4.8 1.5V6.9l-1-.2Z'],
    instagram: ['Instagram', 'M12 2.2c3.2 0 3.6 0 4.8.1 3.2.1 4.8 1.7 4.9 4.9.1 1.3.1 1.6.1 4.8s0 3.6-.1 4.8c-.1 3.2-1.7 4.8-4.9 4.9-1.3.1-1.6.1-4.8.1s-3.6 0-4.8-.1c-3.3-.1-4.8-1.7-4.9-4.9C2.2 15.6 2.2 15.2 2.2 12s0-3.6.1-4.8C2.4 3.9 3.9 2.4 7.2 2.3 8.4 2.2 8.8 2.2 12 2.2Zm0 4.6a5.2 5.2 0 1 0 0 10.4 5.2 5.2 0 0 0 0-10.4Zm0 8.6a3.4 3.4 0 1 1 0-6.8 3.4 3.4 0 0 1 0 6.8Zm5.4-9.9a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4Z'],
  };
  function teamDecorate() {
    const mount = $('#teamMount');
    if (!mount) return;
    if (!$('#teamJoin')) {
      const b = document.createElement('div');
      b.id = 'teamJoin';
      b.className = 'tj-banner';
      b.innerHTML = `<div class="tj-text"><b>Přidej se do našeho teamu!</b><span>Hledáme stále nové členy. Rád pomáháš hráčům, staváš nebo vymýšlíš eventy? Podej si přihlášku.</span>
        <button type="button" class="wb-btn" data-tab-link="zadosti">Mám na to!</button></div><img src="https://mc-heads.net/body/MHF_Steve/220" alt="" class="tj-img">`;
      mount.parentNode.insertBefore(b, mount);
    }
    if (typeof TEAM === 'undefined') return;
    TEAM.forEach((g) => g.members.forEach((m) => {
      if (!m.socials) return;
      const card = mount.querySelector(`[data-rate="${CSS.escape(m.nick)}"]`);
      if (!card || card.querySelector('.tj-soc')) return;
      const links = Object.entries(m.socials).filter(([k, u]) => SOC[k] && /^https:\/\//.test(u));
      if (!links.length) return;
      const div = document.createElement('div');
      div.className = 'tj-soc';
      div.innerHTML = links.map(([k, u]) => `<a href="${esc(u)}" target="_blank" rel="noopener" title="${SOC[k][0]}" aria-label="${SOC[k][0]}"><svg viewBox="0 0 24 24"><path d="${SOC[k][1]}"/></svg></a>`).join('');
      card.appendChild(div);
    }));
  }

  /* =================== PŘIHLÁŠENÍ MINECRAFT ÚČTEM =================== */
  let mcMode = 'password';
  function openMcLogin() {
    let o = $('#mcLogin');
    if (!o) { o = document.createElement('div'); o.id = 'mcLogin'; o.className = 'wp-overlay'; document.body.appendChild(o); }
    o.innerHTML = `<div class="wp-modal mc-login"><button class="wp-close" type="button" data-x>×</button>
      <img class="mc-logo" src="assets/wylvarion-crest.png" alt="">
      <h3>Přihlášení Minecraft účtem</h3>
      <p class="mc-sub">Přihlas se heslem, které používáš na serveru, nebo kódem přímo ze hry.</p>
      <div class="mc-tabs"><button type="button" data-m="password" class="${mcMode === 'password' ? 'is-active' : ''}">🔑 Heslem</button><button type="button" data-m="code" class="${mcMode === 'code' ? 'is-active' : ''}">🎮 Kódem ve hře</button></div>
      <form id="mcForm" autocomplete="on">
        <label>Minecraft nick</label><input name="nick" maxlength="17" required autocomplete="username" placeholder="Tvůj nick ve hře">
        ${mcMode === 'password'
          ? '<label>Heslo ze serveru</label><input name="password" type="password" required autocomplete="current-password" placeholder="Heslo z /login">'
          : '<div class="mc-hint">Na serveru napiš <code>/web</code>. Ukáže se ti kód, který tady zadáš. Platí 10 minut.</div><label>Kód ze hry</label><input name="code" maxlength="6" required placeholder="např. K7P2QX" style="text-transform:uppercase;letter-spacing:4px;font-weight:800">'}
        <label class="mc-remember"><input type="checkbox" name="remember" checked> Zůstat přihlášen <small>na tomto zařízení 30 dní</small></label>
        <button type="submit" class="wb-btn">Přihlásit se</button>
        <div class="rt-msg" id="mcMsg"></div>
      </form>
      <p class="mc-foot">Heslo se odešle šifrovaně přímo serveru, web ho nikde neukládá.</p></div>`;
    o.hidden = false;
    document.body.classList.add('wp-open');
    const close = () => { o.hidden = true; document.body.classList.remove('wp-open'); };
    o.querySelector('[data-x]').onclick = close;
    o.onclick = (e) => { if (e.target === o) close(); };
    o.querySelectorAll('[data-m]').forEach((b) => (b.onclick = () => { mcMode = b.dataset.m; openMcLogin(); }));
    $('#mcForm').onsubmit = async (e) => {
      e.preventDefault();
      const f = e.target, msg = $('#mcMsg'), btn = f.querySelector('[type=submit]');
      msg.textContent = '';
      btn.disabled = true;
      btn.textContent = 'Ověřuji…';
      const body = { action: mcMode, nick: f.nick.value.trim(), remember: f.remember.checked };
      if (mcMode === 'password') body.password = f.password.value; else body.code = f.code.value.trim();
      try {
        const r = await postJSON(`${API}/mc-login.php`, body);
        if (!r.ok) throw new Error(r.error || 'Přihlášení se nepovedlo.');
        if (r.job) {
          for (let i = 0; i < 20; i++) {
            await new Promise((res) => setTimeout(res, 1000));
            const s = await (await fetch(`${API}/mc-login.php?job=${r.job}`, { credentials: 'same-origin' })).json();
            if (s.done) { if (!s.ok) throw new Error(s.error); return location.reload(); }
          }
          throw new Error('Server neodpověděl. Zkus to prosím znovu, nebo použij kód ze hry.');
        }
        location.reload();
      } catch (err) {
        msg.textContent = err.message;
        btn.disabled = false;
        btn.textContent = 'Přihlásit se';
      }
    };
  }
  window.openMcLogin = openMcLogin;
  // Tlačítko v okně přihlášení webu
  if (typeof authModalHTML === 'function') {
    const orig = authModalHTML;
    window.authModalHTML = function () {
      const html = orig.apply(this, arguments);
      if (typeof AUTH !== 'undefined' && AUTH.user) return html;
      return html.replace('<div class="auth-tabs">', `<button type="button" class="wb-btn mc-auth-btn" data-open-mclogin>🎮 Přihlásit Minecraft účtem</button><div class="auth-or">nebo webovým účtem</div><div class="auth-tabs">`);
    };
  }

  /* =================== Domov: novinky z blogu =================== */
  if (typeof buildHomeNews === 'function') {
    window.buildHomeNews = async function () {
      const m = document.getElementById('newsMount');
      if (!m) return;
      try {
        const d = await getJSON(`${API}/posts.php`);
        m.innerHTML = d.posts.slice(0, 6).map((n) => `
          <article class="news-card" tabindex="0" data-nw="${esc(n.id)}" style="--t:${esc(n.color)}">
            <div class="news-top"><span class="news-tag">${icon(n.icon)}${esc(n.tag)}</span><span class="news-date">${date(n.time)}</span></div>
            <h3>${esc(n.title)}</h3><p>${esc(n.excerpt)}</p><span class="news-more">Číst celé →</span>
          </article>`).join('');
        if (!$('#homeAllNews')) m.insertAdjacentHTML('afterend', '<div class="nw-all" id="homeAllNews"><button type="button" class="btn btn-ghost" data-tab-link="novinky">Všechny novinky →</button></div>');
        hydrate(m);
      } catch (e) { /* zůstanou původní novinky */ }
    };
    try { window.buildHomeNews(); } catch (e) { /* nic */ }
  }

  /* =================== Události a směrování =================== */
  window.openPlayerProfile = (key) => openProfile(key);
  document.addEventListener('click', (e) => {
    const t = e.target;
    const hr = t.closest('[data-hr]');
    if (hr) { e.preventDefault(); $('#hrSuggest') && ($('#hrSuggest').hidden = true); openProfile(hr.dataset.hr); return; }
    if (t.closest('[data-hr-back]')) { closeProfile(); hrHome(); return; }
    const nw = t.closest('[data-nw]');
    if (nw) { e.preventDefault(); e.stopPropagation(); nwOpen(nw.dataset.nw); return; }
    if (t.closest('[data-nw-back]')) { nwList(); setHash('#novinky'); return; }
    if (t.closest('[data-open-mclogin]')) { e.preventDefault(); if (typeof closeAuth === 'function') try { closeAuth(); } catch (x) { /* nic */ } openMcLogin(); return; }
    const sl = t.closest('[data-sl]');
    if (sl) { slCur = sl.dataset.sl; slRender(); return; }
    const up = t.closest('[data-up]');
    if (up) { upCat = up.dataset.up; upRender(); return; }
    const cp = t.closest('[data-copy]');
    if (cp) { navigator.clipboard?.writeText(cp.dataset.copy); const old = cp.textContent; cp.textContent = 'Zkopírováno ✓'; setTimeout(() => (cp.textContent = old), 1600); return; }
    const tl = t.closest('[data-tab-link]');
    if (tl && !tl.closest('#navLinks') && !tl.dataset.boundTab && typeof showPanel === 'function') { e.preventDefault(); showPanel(tl.dataset.tabLink); onPanel(tl.dataset.tabLink); return; }
    const wg = t.closest('[data-wiki-go]');
    if (wg && wg.closest('#panel-novinky') && typeof openWikiArticle === 'function') { showPanel('wiki'); openWikiArticle(wg.dataset.wikiGo); }
  }, true);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') ['#mcLogin', '#nwEditor', '#pfEdit'].forEach((s) => { const o = $(s); if (o && !o.hidden) { o.hidden = true; document.body.classList.remove('wp-open'); } });
    if (e.key === 'Enter' && e.target.matches?.('.news-card[data-nw]')) nwOpen(e.target.dataset.nw);
  });
  $('#hrSearch')?.addEventListener('submit', (e) => { e.preventDefault(); const q = $('#hrQ').value.trim(); if (q) openProfile(q); });
  $('#hrQ')?.addEventListener('input', (e) => hrSuggest(e.target.value.trim()));
  document.addEventListener('click', (e) => { if (!e.target.closest('.cm-search-wrap') && $('#hrSuggest')) $('#hrSuggest').hidden = true; });

  const loaded = {};
  function onPanel(name) {
    if (name === 'hraci' && !location.hash.startsWith('#hraci/')) { closeProfile(); if (!loaded.hr) { loaded.hr = 1; } hrHome(); }
    if (name === 'slava') slRender();
    if (name === 'novinky' && !location.hash.startsWith('#novinky/')) nwList();
    if (name === 'updaty') upLoad();
    if (name === 'influencer') inRender();
    if (name === 'team') setTimeout(teamDecorate, 50);
  }
  document.querySelectorAll('#navLinks [data-tab-link]').forEach((el) => el.addEventListener('click', () => setTimeout(() => onPanel(el.dataset.tabLink), 0)));

  // app.js při startu přepíše adresu na #home – původní odkaz si vezmeme z jeho startHash
  const START_HASH = (typeof startHash !== 'undefined' && startHash) || location.hash;
  let routed = false;
  function route() {
    const h = decodeURIComponent((routed ? location.hash : START_HASH).slice(1));
    routed = true;
    const [panel, sub] = [h.split('/')[0].split('?')[0], h.split('/').slice(1).join('/')];
    if (panel === 'hraci' && sub) { showPanel('hraci'); openProfile(sub); return; }
    if (panel === 'novinky' && sub) { showPanel('novinky'); nwOpen(sub); return; }
    if (['hraci', 'slava', 'novinky', 'updaty', 'influencer', 'hrat'].includes(panel)) { showPanel(panel); onPanel(panel); }
    if (panel === 'team') teamDecorate();
  }
  const start = () => setTimeout(route, 60);
  if (document.readyState === 'complete') start(); else window.addEventListener('load', start);
  teamDecorate();
})();
