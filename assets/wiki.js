const WIKI_CATS = {
  zaciname:['Začínáme','Návod'], 'jak-zacit-hrat':['Začínáme','Návod'], launcher:['Začínáme','Návod'], voicechat:['Začínáme','Návod'], ranky:['Začínáme','Informace'],
  ekonomika:['Ekonomika','Informace'], banka:['Ekonomika','Návod'], investice:['Ekonomika','Návod'], jobs:['Ekonomika','Návod'], 'hracske-shopy':['Ekonomika','Návod'],
  'shop-vip':['Ekonomika','Informace'], 'gemy-klice':['Ekonomika','Informace'], hlasovani:['Ekonomika','Informace'],
  residence:['Hraní','Návod'], 'minioni-peti':['Hraní','Informace'], 'mazlicci-mounti':['Hraní','Informace'], questy:['Hraní','Informace'], pribehy:['Hraní','Informace'],
  party:['Hraní','Návod'], tym:['Hraní','Návod'], 'pvp-duely':['Hraní','Informace'], dungeony:['Hraní','Informace']
};
const WIKI_CAT_IC = { 'Začínáme':'🧭', 'Ekonomika':'💰', 'Hraní':'⚔️', 'Návod':'📕', 'Informace':'❔' };
let wikiFilter = { cat:'Vše', q:'' };
function wikiText(id){
  const a = (typeof WIKI_ARTICLES !== 'undefined' && WIKI_ARTICLES[id]) || null;
  return a && a.html ? a.html.replace(/<[^>]+>/g, ' ') : '';
}
function wikiNorm(s){ return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }
function renderWikiGrid(){
  const mount = document.getElementById('wikiGridMount');
  const q = wikiNorm(wikiFilter.q);
  const items = WIKI_HUB.filter(w => {
    const cats = WIKI_CATS[w.id] || ['Hraní','Informace'];
    if (wikiFilter.cat !== 'Vše' && cats[0] !== wikiFilter.cat) return false;
    return !q || wikiNorm(w.title + ' ' + w.teaser + ' ' + wikiText(w.id)).includes(q);
  });
  mount.innerHTML = items.length ? items.map(w => {
    const cats = WIKI_CATS[w.id] || ['Hraní','Informace'];
    const words = wikiText(w.id).split(/\s+/).filter(Boolean).length;
    const min = Math.max(1, Math.round(words / 200));
    return `<button type="button" class="wk-card" data-wiki-open="${w.id}">
      <div class="wk-tags">${cats.map(c => `<span class="wk-tag">${WIKI_CAT_IC[c] || ''} ${c}</span>`).join('')}</div>
      <h3><span class="wk-ic">${wikiIcon(w.id, w.icon)}</span>${w.title}</h3>
      <p>${w.teaser}</p>
      <div class="wk-foot"><span>${min} min čtení</span><span class="wk-arrow">→</span></div>
    </button>`;
  }).join('') : `<div class="wk-empty">Nic jsme nenašli. Zkus jiné slovo nebo se zeptej na Discordu.</div>`;
  mount.querySelectorAll('[data-wiki-open]').forEach(b => b.addEventListener('click', () => openWikiArticle(b.dataset.wikiOpen)));
  if (typeof hydrateMcIcons === 'function') hydrateMcIcons(mount);
}
function buildWiki(){
  const mount = document.getElementById('wikiGridMount');
  mount.className = 'wk-grid';
  if (!document.getElementById('wkBar')){
    const cats = ['Vše', 'Začínáme', 'Ekonomika', 'Hraní'];
    const bar = document.createElement('div');
    bar.className = 'wk-bar'; bar.id = 'wkBar';
    bar.innerHTML = `
      <label class="wb-search wk-search"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
        <input id="wkQ" type="search" placeholder="Hledat ve wiki…" aria-label="Hledat ve wiki"></label>
      <div class="wk-chips">${cats.map(c => `<button type="button" class="wk-chip${c === 'Vše' ? ' is-active' : ''}" data-wk-cat="${c}">${c === 'Vše' ? '' : (WIKI_CAT_IC[c] + ' ')}${c}</button>`).join('')}</div>`;
    mount.parentNode.insertBefore(bar, mount);
    bar.querySelector('#wkQ').addEventListener('input', e => { wikiFilter.q = e.target.value; renderWikiGrid(); });
    bar.addEventListener('click', e => {
      const b = e.target.closest('[data-wk-cat]'); if (!b) return;
      wikiFilter.cat = b.dataset.wkCat;
      bar.querySelectorAll('[data-wk-cat]').forEach(x => x.classList.toggle('is-active', x === b));
      renderWikiGrid();
    });
  }
  renderWikiGrid();
  document.getElementById('faqMount').innerHTML = FAQ.map(f => `<details class="faq-item"><summary>${f.q}</summary><p>${f.a}</p></details>`).join('');
  const backBtn = document.getElementById('wikiBackBtn');
  if (backBtn && !backBtn.dataset.bound){ backBtn.dataset.bound = '1'; backBtn.addEventListener('click', closeWikiArticle); }
}
