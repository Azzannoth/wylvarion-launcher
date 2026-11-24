<?php /* hráči – vyhledávání a veřejné profily */ ?>
  <section class="panel" data-panel="hraci" id="panel-hraci" hidden>
    <div class="wrap section-head">
      <div class="eyebrow">Komunita</div>
      <h2 id="hrHeading">Hráči</h2>
      <p id="hrSub">Vyhledej si profil kteréhokoli hráče Wylvarionu – odehraný čas, statistiky, odznaky a další.</p>
    </div>
    <div class="wrap cm">
      <div id="hrList">
        <div class="cm-search-wrap">
          <form class="wb-search" id="hrSearch" autocomplete="off">
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
            <input id="hrQ" type="search" maxlength="17" placeholder="Zadej nick hráče…" aria-label="Nick hráče">
            <button class="wb-btn" type="submit">Hledat</button>
          </form>
          <div class="cm-suggest" id="hrSuggest" hidden></div>
        </div>
        <div id="hrHome"></div>
      </div>
      <div id="hrProfile" hidden></div>
    </div>
  </section>
