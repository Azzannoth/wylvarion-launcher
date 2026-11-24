<?php /* banlist */ ?>
  <section class="panel" data-panel="banlist" id="panel-banlist" hidden>
    <div class="wrap section-head">
      <div class="eyebrow">Trestní statistiky</div>
      <h2>Banlist</h2>
      <p>Seznam trestů na serveru. Klikni na hlavu hráče a uvidíš jeho profil.</p>
    </div>
    <div class="wrap wb">
      <form class="wb-search" id="wbSearch" autocomplete="off">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
        <input id="wbQ" type="search" maxlength="36" placeholder="Vyhledat nick" aria-label="Vyhledat nick">
        <button class="wb-btn" type="submit">Hledat</button>
      </form>

      <div class="wb-tabs" id="banlistTypeTabs" role="tablist">
        <button class="wb-tab is-active" data-ban-type="BAN" role="tab"><span class="ic" data-mc="iron_sword"></span>Bany <span class="wb-count" data-count="BAN">–</span></button>
        <button class="wb-tab" data-ban-type="KICK" role="tab"><span class="ic" data-mc="leather_boots"></span>Kicky <span class="wb-count" data-count="KICK">–</span></button>
        <button class="wb-tab" data-ban-type="MUTE" role="tab"><span class="ic" data-mc="note_block"></span>Muty <span class="wb-count" data-count="MUTE">–</span></button>
        <button class="wb-tab" data-ban-type="WARN" role="tab"><span class="ic" data-mc="bell"></span>Warny <span class="wb-count" data-count="WARN">–</span></button>
      </div>

      <div class="wb-card">
        <table class="wb-table">
          <thead>
            <tr><th>Hráč</th><th>Důvod</th><th class="wb-hide-m">Admin</th><th>Datum</th><th class="wb-hide-m">Do</th><th>Stav</th></tr>
          </thead>
          <tbody id="banlist-rows">
            <tr><td colspan="6" class="wb-empty">Načítám tresty…</td></tr>
          </tbody>
        </table>
      </div>
      <div class="wb-pager" id="wbPager"></div>

      <div class="wb-appeal">
        <span>Myslíš, že je tvůj trest omyl?</span>
        <button class="btn btn-ghost" type="button" onclick="showPanel('zadosti')" id="banScrollToForm">Podej žádost →</button>
      </div>
      <div hidden><span id="banTotalNum"></span><div id="banStatsMount"></div></div>
    </div>

    <div class="wp-overlay" id="wpOverlay" hidden>
      <div class="wp-modal" role="dialog" aria-modal="true" aria-label="Profil hráče">
        <button class="wp-close" type="button" id="wpClose" aria-label="Zavřít">×</button>
        <div id="wpBody"></div>
      </div>
    </div>
  </section>
