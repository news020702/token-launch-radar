// Token Radar dashboard: renders window.RADAR (written by main.ts) with no network.
// Sortable board, filters, a detail view per protocol, live-token comparables, and the
// model's own workings. No fetch, no external resources: everything is already in data.js.
(function () {
  'use strict';
  var D = window.RADAR;
  if (!D || !Array.isArray(D.rows)) {
    document.getElementById('rows').innerHTML =
      '<tr><td colspan="8">No radar data loaded.</td></tr>';
    return;
  }

  var rows = D.rows;
  var state = { q: '', cat: '', chain: '', wl: false, sort: 'rank', dir: 1, sel: null };

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function money(n) {
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + Math.round(n);
  }
  function commas(n) { return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function pct(v) {
    if (v === null || v === undefined) return '<span class="flat">—</span>';
    var cls = v > 0 ? 'pos' : v < 0 ? 'neg' : 'flat';
    return '<span class="' + cls + '">' + (v > 0 ? '+' : '') + v.toFixed(1) + '%</span>';
  }
  function bySlug(a, b) { return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0; }

  function filtered() {
    var q = state.q.trim().toLowerCase();
    return rows.filter(function (r) {
      if (state.wl && !r.watchlist) return false;
      if (state.cat && r.category !== state.cat) return false;
      if (state.chain && r.chains.indexOf(state.chain) < 0) return false;
      if (q && r.name.toLowerCase().indexOf(q) < 0 && r.slug.indexOf(q) < 0) return false;
      return true;
    });
  }

  function sorted(list) {
    var k = state.sort, d = state.dir;
    return list.slice().sort(function (a, b) {
      var x = a[k], y = b[k];
      if (x === null || x === undefined) return 1;
      if (y === null || y === undefined) return -1;
      var c = typeof x === 'string' ? (x < y ? -1 : x > y ? 1 : 0) : x - y;
      return c * d || bySlug(a, b);
    });
  }

  function renderBoard() {
    var list = sorted(filtered());
    var tb = document.getElementById('rows');
    tb.innerHTML = list.map(function (r) {
      return '<tr data-slug="' + esc(r.slug) + '"' + (state.sel === r.slug ? ' class="sel"' : '') + '>' +
        '<td class="num">' + r.rank + '</td>' +
        '<td><span class="nm">' + esc(r.name) + '</span><br><span class="slug">' + esc(r.slug) + '</span></td>' +
        '<td>' + esc(r.category || '—') + '</td>' +
        '<td>' + esc(r.chains.slice(0, 3).join(', ')) + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '') + '</td>' +
        '<td class="num">' + money(r.tvl_usd) + '</td>' +
        '<td class="num">' + pct(r.change_7d) + '</td>' +
        '<td class="num"><b>' + money(r.implied_value_usd) + '</b></td>' +
        '<td>' + (r.watchlist ? '<span class="badge">Watchlist</span>' : '') + '</td></tr>';
    }).join('');
    document.getElementById('count').textContent =
      'Showing ' + list.length + ' of ' + rows.length + ' ranked protocols';
    document.getElementById('board-note').textContent =
      'Implied value = TVL × category multiple × growth factor × age factor, ' +
      'rounded to the dollar. Values strictly decrease with rank; equal raw values are nudged down by $1 to break ties.';
    var heads = document.querySelectorAll('#board th[data-sort]');
    for (var i = 0; i < heads.length; i++) {
      var h = heads[i];
      h.classList.toggle('sorted', h.getAttribute('data-sort') === state.sort);
      h.textContent = h.textContent.replace(/ [▲▼]$/, '') +
        (h.getAttribute('data-sort') === state.sort ? (state.dir > 0 ? ' ▲' : ' ▼') : '');
    }
  }

  function renderDetail() {
    var el = document.getElementById('detail');
    if (!state.sel) { el.innerHTML = ''; return; }
    var r = null;
    for (var i = 0; i < rows.length; i++) if (rows[i].slug === state.sel) r = rows[i];
    if (!r) { el.innerHTML = ''; return; }
    var age = r.age_days === null ? 'unknown' : r.age_days + ' days';
    var listed = r.listed_at || 'unknown';
    var base = r.tvl_usd * r.category_multiple;
    var steps = r.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('');
    el.innerHTML =
      '<div class="detail-head"><h2>' + esc(r.name) + '</h2>' +
      '<span class="sub">' + esc(r.slug) + ' &middot; rank #' + r.rank + ' of ' + rows.length + '</span>' +
      (r.watchlist ? '<span class="badge">On the watchlist</span>' : '<span class="badge live">Below the floor — early find</span>') +
      '</div>' +
      '<dl class="kv">' +
      '<div><dt>Implied value</dt><dd>' + money(r.implied_value_usd) + '</dd></div>' +
      '<div><dt>TVL</dt><dd>$' + commas(r.tvl_usd) + '</dd></div>' +
      '<div><dt>7-day change</dt><dd>' + (r.change_7d === null ? '—' : (r.change_7d > 0 ? '+' : '') + r.change_7d.toFixed(2) + '%') + '</dd></div>' +
      '<div><dt>Category</dt><dd>' + esc(r.category || '—') + '</dd></div>' +
      '<div><dt>Chains</dt><dd>' + esc(r.chains.join(', ')) + '</dd></div>' +
      '<div><dt>Tracked since</dt><dd>' + esc(listed) + ' (' + age + ')</dd></div>' +
      '</dl>' +
      '<h3>How the value is built</h3>' +
      '<div class="model">' +
      'TVL              $' + commas(r.tvl_usd) + '\n' +
      '× category multiple  ' + r.category_multiple.toFixed(4) + '  (' + esc(r.category || 'Unknown') + ' median, see below)\n' +
      '× growth factor      ' + r.growth_factor.toFixed(4) + '  (7d ' + (r.change_7d === null ? 'unreported' : r.change_7d.toFixed(2) + '%') + ', clamped to −50…+100, half weight)\n' +
      '× age factor         ' + r.age_factor.toFixed(4) + '  (' + age + ' with no token)\n' +
      '= raw implied      <b>' + money(r.raw_implied) + '</b>  →  ranked value ' + money(r.implied_value_usd) + '</div>' +
      '<h3>Farm plan — what to do about it</h3>' +
      '<ol class="steps">' + steps + '</ol>' +
      '<p class="why"><b>Why it ranks here:</b> ' + esc(r.name) + ' holds $' + commas(r.tvl_usd) +
      ' of TVL with no token recorded, in a category the market pays ' + r.category_multiple.toFixed(2) +
      '× TVL for, after ' + age + ' running without one. The farm plan above is sized to its TVL tier and its chain.</p>';
  }

  function renderLive() {
    document.getElementById('live-rows').innerHTML = D.live.map(function (r) {
      return '<tr><td><span class="nm">' + esc(r.name) + '</span><br><span class="slug">' + esc(r.slug) + '</span></td>' +
        '<td>' + esc(r.category || '—') + '</td>' +
        '<td class="num">' + money(r.tvl_usd) + '</td>' +
        '<td class="num">' + (r.mcap_usd === null ? '—' : money(r.mcap_usd)) + '</td>' +
        '<td class="num">' + (r.mcap_tvl === null ? '—' : r.mcap_tvl.toFixed(3) + '×') + '</td></tr>';
    }).join('');
  }

  function renderMethod() {
    var m = D.multiples;
    var cats = Object.keys(m.by_category).sort(function (a, b) {
      return m.by_category[b].multiple - m.by_category[a].multiple;
    });
    var table = '<table class="mult-table"><thead><tr><th>Category</th><th class="num">Multiple</th><th class="num">Tokenized n</th></tr></thead><tbody>' +
      cats.map(function (c) {
        var x = m.by_category[c];
        return '<tr><td>' + esc(c) + '</td><td class="num">' + x.multiple.toFixed(3) + '×</td><td class="num">' + x.n + '</td></tr>';
      }).join('') +
      '<tr><td>Global fallback (categories with fewer than ' + D.model.min_category_samples +
      ' tokenized protocols)</td><td class="num">' + m.global.multiple.toFixed(3) + '×</td><td class="num">' + m.global.n + '</td></tr>' +
      '</tbody></table>';
    document.getElementById('method').innerHTML =
      '<p class="lede">The model is <b>radar-cat-median-1</b>. Implied value = TVL × category multiple × growth factor × age factor.</p>' +
      '<p class="lede" style="margin-top:10px">The category multiple is the median market-cap / TVL ratio of the snapshot&rsquo;s own tokenized protocols in that category (at least ' +
      D.model.min_category_samples + ' of them), clamped to ' + D.model.multiple_floor + '–' + D.model.multiple_cap +
      '. Categories with too few tokenized protocols use the global median. The growth factor is 1 + clamp(7-day change, −' +
      Math.abs(D.model.growth_floor) + '…+' + D.model.growth_cap + ') / 100 × ' + D.model.growth_weight +
      '. The age factor is ' + D.model.age_floor + ' + ' + D.model.age_range + ' × min(age, ' + D.model.age_cap_days +
      ' days) / ' + D.model.age_cap_days + '; an unknown listing date counts as ' + D.model.unknown_age_days + ' days.</p>' +
      '<p class="lede" style="margin-top:10px">“Pre-token” means the snapshot records no token for the protocol (no CoinGecko id, no symbol, no market cap), and the board leaves out wrapped, staked and bridged products of tokens that already trade, versioned names and exchange products — the same rule the watchlist uses. The watchlist (40 protocols at or above $50M TVL) is a floor, never a ceiling: the board also ranks clean pre-token protocols below it, found early by the same score.</p>' +
      '<h3 style="margin-top:16px">Category multiples derived from this snapshot</h3>' + table;
  }

  function renderStats() {
    var top = rows[0];
    document.getElementById('stats').innerHTML =
      '<div><dt>Ranked</dt><dd>' + rows.length + '</dd></div>' +
      '<div><dt>Watchlist</dt><dd>' + D.watchlist_size + '</dd></div>' +
      '<div><dt>Early finds</dt><dd>' + D.early_size + '</dd></div>' +
      '<div><dt>Top implied</dt><dd>' + money(top ? top.implied_value_usd : 0) + '</dd></div>';
    document.getElementById('asof').textContent = D.as_of;
    document.getElementById('modelver').textContent = D.model_version;
  }

  function renderAll() { renderBoard(); renderDetail(); }

  function fillSelects() {
    var cats = [], chains = [];
    rows.forEach(function (r) {
      if (cats.indexOf(r.category) < 0 && r.category) cats.push(r.category);
      r.chains.forEach(function (c) { if (chains.indexOf(c) < 0) chains.push(c); });
    });
    cats.sort(); chains.sort();
    document.getElementById('cat').innerHTML = '<option value="">All categories</option>' +
      cats.map(function (c) { return '<option>' + esc(c) + '</option>'; }).join('');
    document.getElementById('chain').innerHTML = '<option value="">All chains</option>' +
      chains.map(function (c) { return '<option>' + esc(c) + '</option>'; }).join('');
  }

  function selectRow(slug, scroll) {
    state.sel = slug;
    try { history.replaceState(null, '', slug ? '#detail=' + slug : '#'); } catch (e) {}
    renderAll();
    if (scroll) {
      var el = document.getElementById('detail');
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  document.getElementById('q').addEventListener('input', function (e) { state.q = e.target.value; renderBoard(); });
  document.getElementById('cat').addEventListener('change', function (e) { state.cat = e.target.value; renderBoard(); });
  document.getElementById('chain').addEventListener('change', function (e) { state.chain = e.target.value; renderBoard(); });
  document.getElementById('wl').addEventListener('change', function (e) { state.wl = e.target.checked; renderBoard(); });
  document.getElementById('reset').addEventListener('click', function () {
    state.q = ''; state.cat = ''; state.chain = ''; state.wl = false; state.sort = 'rank'; state.dir = 1;
    document.getElementById('q').value = '';
    document.getElementById('cat').value = '';
    document.getElementById('chain').value = '';
    document.getElementById('wl').checked = false;
    renderBoard();
  });
  document.querySelectorAll('#board th[data-sort]').forEach(function (th) {
    th.addEventListener('click', function () {
      var k = th.getAttribute('data-sort');
      if (state.sort === k) state.dir = -state.dir;
      else { state.sort = k; state.dir = k === 'name' || k === 'category' ? 1 : -1; }
      renderBoard();
    });
  });
  document.getElementById('rows').addEventListener('click', function (e) {
    var tr = e.target.closest('tr[data-slug]');
    if (tr) selectRow(tr.getAttribute('data-slug'), true);
  });

  fillSelects();
  renderStats();
  renderLive();
  renderMethod();
  var hash = location.hash || '';
  var dm = hash.match(/detail=([^&]+)/);
  if (dm) state.sel = decodeURIComponent(dm[1]);
  if (/watchlist/.test(hash)) { state.wl = true; document.getElementById('wl').checked = true; }
  var cm = hash.match(/cat=([^&]+)/);
  if (cm) { state.cat = decodeURIComponent(cm[1]); document.getElementById('cat').value = state.cat; }
  renderAll();
})();
