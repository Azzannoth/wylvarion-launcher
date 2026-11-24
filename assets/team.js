function buildTeam(){
  document.getElementById('teamMount').innerHTML = TEAM.map(group => `
    <div class="tier-block">
      <div class="tier-label"><span class="tier-ic" style="--tc:${group.color}">${mcImg(TEAM_MC[group.tier] || 'name_tag')}</span>${group.tier}</div>
      <div class="tier-grid">
        ${group.members.map(m => {
          const free = m.nick === 'Volná pozice';
          return `
          <div class="crew-card${free ? '' : ' rt-card'}" style="--crew-color:${group.color}"${free ? '' : ` data-rate="${escapeHtml(m.nick)}" tabindex="0" role="button" aria-label="Hodnocení – ${escapeHtml(m.nick)}"`}>
            ${free ? '' : `<span class="rt-chip" data-rt-sum="${escapeHtml(m.nick.toLowerCase())}"><span class="rt-star">★</span><b>–</b></span><span class="rt-hover">★ Ohodnotit člena</span>`}
            <div class="crew-seal"><img loading="lazy" src="${m.skin ? `https://mc-heads.net/avatar/${m.skin}/120` : m.uuid ? `api/skin.php?uuid=${m.uuid}&size=120` : (free ? `https://mc-heads.net/avatar/MHF_Steve/120` : `api/skin.php?name=${encodeURIComponent(m.nick)}&size=120`)}" alt="Skin hráče ${m.nick}" onerror="skinFallback(this,'${m.nick}',120)"></div>
            <div class="crew-name">${m.nick}</div>
            <div class="crew-role">${m.role}</div>
            <p class="crew-bio">${m.bio}</p>
          </div>`;
        }).join('')}
      </div>
    </div>
  `).join('');
  loadRatingSummary();
}

/* ---------- Hodnocení členů teamu (jen pro členy Discordu) ---------- */
const RT = { member: null, data: null, stars: 0, page: 0, per: 4 };
function rtStars(v, size){
  const full = Math.round(v);
  return `<span class="rt-stars${size ? ' ' + size : ''}">${[1,2,3,4,5].map(i => `<i class="${i <= full ? 'on' : ''}">★</i>`).join('')}</span>`;
}
async function loadRatingSummary(){
  try{
    const res = await fetch(`${CONFIG.apiBase}/ratings.php`, { credentials:'same-origin' });
    const d = await res.json();
    if (!d.ok) return;
    Object.entries(d.summary).forEach(([nick, s]) => {
      const el = document.querySelector(`[data-rt-sum="${CSS.escape(nick.toLowerCase())}"]`);
      if (el) el.innerHTML = `<span class="rt-star">★</span><b>${s.count ? s.avg.toFixed(1) : '–'}</b>${s.count ? `<small>(${s.count})</small>` : ''}`;
    });
  }catch(e){}
}
function rtEnsureModal(){
  let o = document.getElementById('rtOverlay');
  if (o) return o;
  o = document.createElement('div');
  o.className = 'wp-overlay'; o.id = 'rtOverlay'; o.hidden = true;
  o.innerHTML = `<div class="wp-modal rt-modal" role="dialog" aria-modal="true" aria-label="Hodnocení člena"><button class="wp-close" type="button" data-rt-close aria-label="Zavřít">×</button><div id="rtBody"></div></div>`;
  document.body.appendChild(o);
  o.addEventListener('click', e => { if (e.target === o || e.target.closest('[data-rt-close]')) rtClose(); });
  return o;
}
function rtClose(){
  const o = document.getElementById('rtOverlay');
  if (!o || o.hidden) return;
  o.hidden = true; document.body.classList.remove('wp-open');
}
async function openRating(nick){
  const o = rtEnsureModal();
  RT.member = nick; RT.page = 0; RT.stars = 0;
  o.hidden = false; document.body.classList.add('wp-open');
  document.getElementById('rtBody').innerHTML = '<div class="wp-loading">Načítám hodnocení…</div>';
  try{
    const res = await fetch(`${CONFIG.apiBase}/ratings.php?member=${encodeURIComponent(nick)}`, { credentials:'same-origin' });
    RT.data = await res.json();
    if (!RT.data.ok) throw new Error(RT.data.error);
    if (RT.data.mine) RT.stars = RT.data.mine.stars;
    renderRating();
  }catch(e){
    document.getElementById('rtBody').innerHTML = '<div class="wp-loading">Hodnocení se teď nepodařilo načíst.</div>';
  }
}
function rtFormHTML(d){
  const login = `${CONFIG.apiBase}/discord-login.php?ret=team`;
  if (!d.me) return `<div class="rt-gate"><b>Hodnotit mohou jen členové našeho Discordu</b><span>Přihlášení trvá pár vteřin a jméno se doplní samo.</span><a class="dc-btn" href="${login}" data-rt-login>Přihlásit přes Discord</a></div>`;
  if (!d.me.member) return `<div class="rt-gate"><b>Nejdřív se připoj na náš Discord</b><span>Hodnotit mohou jen členové Wylvarion Discordu.</span><a class="btn btn-ghost btn-sm" href="${CONFIG.discordInvite}" target="_blank" rel="noopener">Připojit se na Discord</a></div>`;
  if (d.self) return `<div class="rt-gate"><b>Sám sebe hodnotit nemůžeš</b><span>Hodnocení je pro ostatní členy teamu.</span></div>`;
  const m = d.mine;
  return `<form class="rt-form" id="rtForm">
    <div class="rt-form-head"><img src="${escapeHtml(d.me.avatar)}" alt=""><div><b>${escapeHtml(d.me.name)}</b><span>${m ? 'Upravit tvoje hodnocení' : 'Tvoje hodnocení'}</span></div></div>
    <div class="rt-pick" id="rtPick">${[1,2,3,4,5].map(i => `<button type="button" data-star="${i}" class="${i <= RT.stars ? 'on' : ''}" aria-label="${i} z 5">★</button>`).join('')}</div>
    <textarea name="text" maxlength="300" rows="3" placeholder="Jak ti pomohl/a? Napiš pár slov…">${m ? escapeHtml(m.text) : ''}</textarea>
    <div class="rt-form-foot"><span class="rt-msg" id="rtMsg"></span>
      ${m ? '<button type="button" class="btn btn-ghost btn-sm" data-rt-delete>Smazat</button>' : ''}
      <button type="submit" class="wb-btn">${m ? 'Uložit' : 'Odeslat'}</button></div>
  </form>`;
}
function renderRating(){
  const d = RT.data;
  const pages = Math.max(1, Math.ceil(d.reviews.length / RT.per));
  RT.page = Math.min(RT.page, pages - 1);
  const shown = d.reviews.slice(RT.page * RT.per, RT.page * RT.per + RT.per);
  const max = Math.max(1, ...Object.values(d.dist));
  const card = document.querySelector(`[data-rate="${CSS.escape(d.member)}"]`);
  const role = card ? card.querySelector('.crew-role')?.textContent : '';
  document.getElementById('rtBody').innerHTML = `
    <div class="rt-head">
      <img src="${card?.querySelector('.crew-seal img')?.src || `https://mc-heads.net/avatar/${encodeURIComponent(d.member)}/80`}" alt="">
      <div><h3>${escapeHtml(d.member)}</h3><span>${escapeHtml(role || '')}</span></div>
    </div>
    <div class="rt-summary">
      <div class="rt-avg"><span>Průměrné hodnocení</span><b>${d.count ? d.avg.toFixed(1) : '–'}</b>${rtStars(d.avg, 'lg')}<small>${d.count} ${d.count === 1 ? 'hodnocení' : d.count >= 2 && d.count <= 4 ? 'hodnocení' : 'hodnocení'}</small></div>
      <div class="rt-dist">${[5,4,3,2,1].map(s => `<div><span>${s}★</span><i><em style="width:${d.dist[s] / max * 100}%"></em></i><small>${d.dist[s]}</small></div>`).join('')}</div>
    </div>
    ${rtFormHTML(d)}
    <div class="rt-list">${shown.length ? shown.map(r => `
      <div class="rt-item">
        <img src="${escapeHtml(r.avatar)}" alt="" loading="lazy">
        <div class="rt-item-main">
          <div class="rt-item-top"><b>${escapeHtml(r.name)}</b>${r.edited ? '<em>(upraveno)</em>' : ''}${rtStars(r.stars)}</div>
          <small>${new Date(r.time).toLocaleDateString('cs-CZ', { day:'numeric', month:'long', year:'numeric' })}</small>
          <p>${escapeHtml(r.text)}</p>
        </div>
        ${d.admin ? `<button type="button" class="rt-remove" data-rt-remove="${escapeHtml(r.id)}" title="Smazat recenzi">×</button>` : ''}
      </div>`).join('') : '<div class="wp-clean">Zatím bez hodnocení. Buď první!</div>'}</div>
    ${pages > 1 ? `<div class="rt-pager"><button type="button" class="wb-page" data-rt-page="-1"${RT.page === 0 ? ' disabled' : ''}>‹</button><span>${RT.page + 1} / ${pages}</span><button type="button" class="wb-page" data-rt-page="1"${RT.page >= pages - 1 ? ' disabled' : ''}>›</button></div>` : ''}
  `;
  bindRating();
}
async function rtPost(body){
  const res = await fetch(`${CONFIG.apiBase}/ratings.php`, { method:'POST', credentials:'same-origin', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ member: RT.member, ...body }) });
  let d = {}; try{ d = await res.json(); }catch(e){}
  return d;
}
function bindRating(){
  const body = document.getElementById('rtBody');
  body.querySelectorAll('[data-rt-page]').forEach(b => b.addEventListener('click', () => { RT.page += Number(b.dataset.rtPage); renderRating(); }));
  body.querySelector('[data-rt-login]')?.addEventListener('click', () => { try{ sessionStorage.setItem('wylRateMember', RT.member); }catch(e){} });
  body.querySelectorAll('[data-rt-remove]').forEach(b => b.addEventListener('click', async () => {
    if (!confirm('Opravdu smazat tuhle recenzi?')) return;
    await rtPost({ action:'remove', id: b.dataset.rtRemove }); openRating(RT.member); loadRatingSummary();
  }));
  const pick = document.getElementById('rtPick');
  pick?.addEventListener('click', e => {
    const b = e.target.closest('[data-star]'); if (!b) return;
    RT.stars = Number(b.dataset.star);
    pick.querySelectorAll('[data-star]').forEach(x => x.classList.toggle('on', Number(x.dataset.star) <= RT.stars));
  });
  body.querySelector('[data-rt-delete]')?.addEventListener('click', async () => {
    await rtPost({ action:'delete' }); RT.stars = 0; openRating(RT.member); loadRatingSummary();
  });
  document.getElementById('rtForm')?.addEventListener('submit', async e => {
    e.preventDefault();
    const msg = document.getElementById('rtMsg');
    if (!RT.stars){ msg.textContent = 'Vyber počet hvězdiček.'; return; }
    const btn = e.target.querySelector('[type="submit"]'); btn.disabled = true;
    const r = await rtPost({ stars: RT.stars, text: e.target.text.value });
    btn.disabled = false;
    if (!r.ok){ msg.textContent = r.error || 'Uložení se nepovedlo.'; return; }
    openRating(RT.member); loadRatingSummary();
  });
}
document.addEventListener('click', e => {
  const c = e.target.closest('[data-rate]');
  if (c && !e.target.closest('a')) openRating(c.dataset.rate);
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') rtClose();
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches?.('[data-rate]')){ e.preventDefault(); openRating(e.target.dataset.rate); }
});
window.addEventListener('load', () => setTimeout(() => {
  let m = null; try{ m = sessionStorage.getItem('wylRateMember'); sessionStorage.removeItem('wylRateMember'); }catch(e){}
  if (m && location.hash.startsWith('#team')) { showPanel('team'); openRating(m); }
}, 300));

