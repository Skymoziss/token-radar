// Token Radar radar-2 dashboard. Reads window.RADAR (beside dashboard/), renders the ranked board:
// dark theme, sticky header, chain badges, category chips, TVL range filter, sort on every column,
// implied-value bars, and a detail drawer with the full model breakdown and a 'Why ranked here'
// paragraph derived from the row's figures. No network, no framework, no external URLs.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', tab: 'pre-token', sort: 'implied', dir: -1, minTvl: '', maxTvl: '', selected: null };

  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    var abs = Math.abs(n);
    if (abs >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (abs >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (abs >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + Math.round(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  // The model in one function, mirroring lib/model.ts radar-2: sqrt growth, category-normalized TVL,
  // log scarcity and chain diversity. The page recomputes each row and checks board.json's number.
  function impliedOf(row, model) {
    var g = row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d;
    g = Math.min(model.growth_cap, Math.max(model.growth_floor, g));
    var growthMult = 1 + Math.sign(g) * Math.sqrt(Math.abs(g) / 100) * model.growth_weight;
    var median = row.category_median_tvl;
    var log2 = median !== null && median !== undefined && median > 0 && row.tvl_usd > 0 ? Math.log2(row.tvl_usd / median) : 0;
    var catMult = Math.min(2, Math.max(0.65, 1 + model.rel_weight * log2));
    var age = row.age_days === null || row.age_days === undefined ? model.unknown_age_days : row.age_days;
    var scarcity = 1 + model.scarcity_weight * Math.log2(1 + Math.min(Math.max(age, 0), model.scarcity_days) / 365);
    var chainMult = 1 + model.chain_weight * Math.min((row.chains || []).length, model.chain_cap);
    return Math.max(1, Math.round(row.tvl_usd * model.base_multiple * growthMult * catMult * scarcity * chainMult));
  }

  // Chain badge class, from the chain name's family: Ethereum, an L2 rollup, Solana, or other.
  function badgeClass(chain) {
    var c = chain.toLowerCase();
    if (c === 'ethereum') return 'eth';
    if (c.indexOf('solana') >= 0) return 'sol';
    if (c.indexOf('arbitrum') >= 0 || c.indexOf('optimism') >= 0 || c.indexOf('base') >= 0 || c.indexOf('polygon') >= 0 || c.indexOf('scroll') >= 0 || c.indexOf('linea') >= 0 || c.indexOf('zk') >= 0 || c.indexOf('mantle') >= 0 || c.indexOf('blast') >= 0) return 'l2';
    return 'alt';
  }
  function chainBadges(chains) {
    var list = chains || [];
    var wrap = el('div', { class: 'badges' });
    (list.length ? list.slice(0, 3) : ['unnamed']).forEach(function (c) {
      wrap.appendChild(el('span', { class: 'badge ' + badgeClass(c), text: c }));
    });
    if (list.length > 3) wrap.appendChild(el('span', { class: 'badge alt', text: '+' + (list.length - 3) }));
    return wrap;
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  // The farm plan is the same derivation main.ts writes to board.json: category, chains, TVL and age
  // decide the action, the capital, the hold, the gas and the weekly rhythm. No name is special-cased.
  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function gasFor(chain) {
    var c = chain.toLowerCase();
    if (c === 'ethereum') return { first: 'about $6 of Ethereum mainnet gas', weekly: '$4-8 of mainnet gas a week', note: 'batch weekly actions into one transaction on Ethereum mainnet to keep gas down' };
    if (c.indexOf('arbitrum') >= 0 || c.indexOf('optimism') >= 0 || c.indexOf('base') >= 0 || c.indexOf('polygon') >= 0 || c.indexOf('scroll') >= 0 || c.indexOf('linea') >= 0 || c.indexOf('zk') >= 0 || c.indexOf('mantle') >= 0 || c.indexOf('blast') >= 0) return { first: 'about $0.20 of L2 gas', weekly: 'under $1 of L2 gas a week', note: 'the L2 rollup keeps gas low, so weekly actions are cheap' };
    if (c.indexOf('solana') >= 0) return { first: 'under $0.05 of Solana fees', weekly: 'a few cents of Solana fees a week', note: 'Solana fees are negligible, so interact as often as the program rewards' };
    if (c.indexOf('avalanche') >= 0) return { first: 'about $0.30 of Avalanche gas', weekly: 'under $1 of gas a week', note: 'Avalanche gas is low but the C-Chain spikes, batch actions' };
    if (c.indexOf('bsc') >= 0 || c.indexOf('binance') >= 0) return { first: 'about $0.30 of BSC gas', weekly: 'under $1 of gas a week', note: 'BSC gas is cheap, weekly interactions cost little' };
    return { first: 'under $1 of gas', weekly: 'under $2 of gas a week', note: 'check the chain gas before each action and batch when it spikes' };
  }
  function capitalFor(p) {
    if (p.tvl_usd >= 5e9) return 250;
    if (p.tvl_usd >= 1e9) return 150;
    if (p.tvl_usd >= 1e8) return 100;
    return 50;
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  function actionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ' and keep the position open.';
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0) return "Provide $" + capital + " of liquidity to " + name + "'s main pool on " + chain + ' and keep the position open.';
    if (c.indexOf('bridge') >= 0) return 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + ' and use the bridged funds in its app.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return "Stake $" + capital + " of the chain's staking asset through " + name + ' and keep the receipt.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0 || c.indexOf('options') >= 0) return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small hedge.';
    if (c.indexOf('prediction') >= 0) return 'Fund $' + capital + ' and place one market position on ' + name + '.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0 || c.indexOf('liquidity manager') >= 0) return 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and keep the shares.';
    if (c.indexOf('stable') >= 0) return 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + '.';
    if (c.indexOf('rwa') >= 0) return "Mint $" + capital + " of the protocol's yield asset on " + chain + ' and hold it.';
    if (c.indexOf('insurance') >= 0) return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy.';
    if (c.indexOf('launchpad') >= 0 || c.indexOf('nft') >= 0) return 'Use $' + capital + ' on ' + name + ' on ' + chain + ' for one participation and keep the receipt.';
    return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
  }
  function weeklyFor(p, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Each week on ' + name + ' on ' + chain + ': toggle the deposit off and on, or borrow and repay a small amount, so the wallet shows repeatable supply-and-borrow activity.';
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0) return "Each week on " + name + " on " + chain + ': rebalance the position by withdrawing half and re-adding it, and make one swap through the pool, so both LP and swap volume are logged.';
    if (c.indexOf('bridge') >= 0) return "Each week: bridge a small amount through " + name + " in each direction the app supports, so the wallet's bridge history shows repeated usage of more than one route.";
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return 'Each week on ' + name + ' on ' + chain + ': top the stake up by a small amount and, if it offers them, claim and restake the rewards so the receipt history grows.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0 || c.indexOf('options') >= 0) return 'Each week on ' + name + ' on ' + chain + ': open and close one small position on each side, long then short, so trading volume accrues on the account.';
    if (c.indexOf('prediction') >= 0) return 'Each week: place one small market on ' + name + ' and resolve or roll it, so the account shows repeated forecasting activity.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0 || c.indexOf('liquidity manager') >= 0) return 'Each week on ' + name + ' on ' + chain + ': move the deposit between two of its vaults once, so allocation activity is logged on both vaults.';
    if (c.indexOf('stable') >= 0) return 'Each week on ' + name + ' on ' + chain + ': mint, then redeem, a small amount of the stable asset, so both sides of the mechanism appear in the history.';
    if (c.indexOf('rwa') >= 0) return "Each week on " + name + " on " + chain + ": hold the tokenized asset and make one small purchase or transfer, so the wallet's holding history is continuous.";
    if (c.indexOf('insurance') >= 0) return 'Each week on ' + name + ' on ' + chain + ': renew or extend a small cover policy, so the account shows repeated coverage rather than a one-off buy.';
    if (c.indexOf('launchpad') >= 0 || c.indexOf('nft') >= 0) return 'Each week on ' + name + ' on ' + chain + ': make one participation or small trade, so the account accrues usage volume rather than a single event.';
    return 'Each week on ' + name + ' on ' + chain + ': make one deposit, swap or interaction, varying the action so the history shows repeatable, varied usage.';
  }
  function stepText(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  }
  function farmSteps(p) {
    var chain = chainOf(p);
    var capital = capitalFor(p);
    var hold = holdDaysFor(p.age_days);
    var gas = gasFor(chain);
    var chains = p.chains && p.chains.length > 1 ? ' The protocol also runs on ' + p.chains.slice(1).slice(0, 3).join(', ') + ', so a second wallet can farm the same program there.' : '';
    return [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline. First gas on ' + chain + ': ' + gas.first + '.', cost: gas.first, time: '5 minutes' },
      { text: actionFor(p, capital, chain), cost: '$' + capital + ' of capital and ' + gas.first, time: '15 minutes to set up' },
      { text: weeklyFor(p, chain), cost: gas.weekly + ' (' + gas.note + ')', time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.' + chains, cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: "Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.", cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
      { text: 'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.', cost: 'nothing but the log', time: '5 minutes' }
    ].map(stepText);
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('category')) state.category = params.get('category');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    window.history.replaceState(null, '', next ? '#' + next : window.location.pathname + window.location.search);
  }

  function rows() {
    var q = state.q.trim().toLowerCase();
    var min = parseFloat(state.minTvl);
    var max = parseFloat(state.maxTvl);
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
      if (isFinite(min) && r.tvl_usd < min) return false;
      if (isFinite(max) && r.tvl_usd > max) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'category') { av = a.category || ''; bv = b.category || ''; }
      else if (key === 'chains') { av = (a.chains || []).length; bv = (b.chains || []).length; }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'mark' }), el('span', { class: 'brand-name', text: 'Token Radar' })),
      el('div', { class: 'top-meta' },
        el('span', { text: 'Snapshot ' + DATA.as_of }),
        el('span', { text: 'DefiLlama protocol index' }),
        el('span', { text: DATA.model_version + ' model' })
      )
    );
  }

  function lede() {
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', null, 'Watchlist covered, ranked by ', el('em', { text: 'implied value' })),
        el('p', { text: 'Every watchlist protocol with at least $' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL and no token on record, plus ' + DATA.early_size + ' early pre-token protocols below that floor. Implied value is a category-normalized model, not a promise: select any row for its full breakdown.' })
      ),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })),
        el('div', { class: 'fact' }, el('span', { text: 'Rows scored' }), el('b', { text: String(DATA.board_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Early rows' }), el('b', { text: String(DATA.early_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Live set aside' }), el('b', { text: String(DATA.live_size) }))
      )
    );
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); renderTable(); });
    var chips = el('div', { class: 'chips', role: 'group', 'aria-label': 'Filter by category' });
    var all = el('button', { class: 'chip', type: 'button', 'aria-pressed': state.category === 'all' ? 'true' : 'false', text: 'All', onclick: function () { state.category = 'all'; writeHash(); render(); } });
    chips.appendChild(all);
    categories.forEach(function (c) {
      chips.appendChild(el('button', {
        class: 'chip', type: 'button', 'aria-pressed': state.category === c ? 'true' : 'false', text: c,
        onclick: function () { state.category = c; writeHash(); render(); }
      }));
    });
    var min = el('input', { type: 'number', id: 'min-tvl', placeholder: 'Min', min: '0', value: state.minTvl, 'aria-label': 'Minimum TVL in dollars' });
    var max = el('input', { type: 'number', id: 'max-tvl', placeholder: 'Max', min: '0', value: state.maxTvl, 'aria-label': 'Maximum TVL in dollars' });
    min.addEventListener('input', function () { state.minTvl = min.value; renderTable(); });
    max.addEventListener('input', function () { state.maxTvl = max.value; renderTable(); });
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: function () { state.tab = 'pre-token'; render(); } });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { state.tab = 'live'; render(); } });
    var count = el('span', { class: 'count', id: 'count' });
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'min-tvl', text: 'TVL range ($)' }), el('div', { class: 'range' }, min, el('span', { class: 'dash', text: '–' }), max)),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Token status' }), el('div', { class: 'tabs' }, pre, live)),
      count,
      el('div', { class: 'field', style: 'flex:1 1 100%' }, el('span', { class: 'sub', text: 'Categories' }), chips)
    );
  }

  var countNode = null;
  function setCount() {
    if (!countNode) return;
    countNode.textContent = state.tab === 'pre-token' ? sortedRows(rows()).length + ' of ' + DATA.board_size + ' rows shown' : DATA.live.length + ' live-token protocols';
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col', 'aria-sort': state.sort === key ? (state.dir < 0 ? 'descending' : 'ascending') : 'none' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } },
        label,
        state.sort === key ? el('span', { class: 'arrow', 'aria-hidden': 'true', text: state.dir < 0 ? ' ↓' : ' ↑' }) : null
      )
    );
  }

  function boardTable() {
    var list = sortedRows(rows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search, the TVL range or pick another category to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.minTvl = ''; state.maxTvl = ''; writeHash(); render(); } })
      ));
    }
    var max = list[0].implied_value_usd || 1;
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        'aria-label': r.name + ', rank ' + r.rank + ', implied value ' + fmtUsd(r.implied_value_usd) + '. Open details.',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num rank', text: String(r.rank) }),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Other') })
        )),
        chainBadges(r.chains),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
        )),
        el('td', null, el('span', { class: 'status', text: 'no token' }))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. Every column sorts; select a row for its model breakdown and farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            el('th', { scope: 'col', text: 'Chains' }),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('implied', 'Implied value'),
            el('th', { scope: 'col', text: 'Token' })
          )),
          tbody
        )
      )
    );
  }

  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', { class: 'num', text: 'live' }),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') }))),
        chainBadges(r.chains),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', null, el('span', { class: 'status live', text: 'already trades' }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'Chains' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Token' }))),
          tbody
        )
      )
    );
  }

  function modelPanel() {
    var m = DATA.model;
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How implied value is computed (' + DATA.model_version + ')' }),
      el('p', { class: 'sub', text: 'Every row is scored by one deterministic function of the snapshot figures. No protocol name is special-cased, and no row is hand-picked.' }),
      el('div', { class: 'formula' },
        'implied = round( tvl_usd x ' + m.base_multiple + '\n' +
        '  x ( 1 + sign(g) x sqrt(|g|/100) x ' + m.growth_weight + ' )        g = clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ')\n' +
        '  x clamp(1 + ' + m.rel_weight + ' x log2(tvl / category_median_tvl), 0.65, 2)    median over pre-token rows of the category\n' +
        '  x ( 1 + ' + m.scarcity_weight + ' x log2(1 + min(age_days, ' + m.scarcity_days + ')/365) )    scarcity of a long no-token run\n' +
        '  x ( 1 + ' + m.chain_weight + ' x min(chains, ' + m.chain_cap + ') ) )       chain diversity bonus'
      ),
      el('ul', { class: 'model-list' },
        el('li', null, el('b', { text: 'base ' + m.base_multiple + 'x' }), ' — TVL x 0.25, capital locked is the core signal.'),
        el('li', null, el('b', { text: 'growth, weight ' + m.growth_weight }), ' — a sqrt curve: one strong week cannot outrank four steady ones.'),
        el('li', null, el('b', { text: 'category, weight ' + m.rel_weight }), ' — TVL against its category median, floored at 0.65x, capped at 2x.'),
        el('li', null, el('b', { text: 'scarcity, weight ' + m.scarcity_weight }), ' — years listed with no token, log curve, capped at ' + m.scarcity_days + ' days; unknown age uses ' + m.unknown_age_days + '.'),
        el('li', null, el('b', { text: 'chains, weight ' + m.chain_weight }), ' — each additional chain up to ' + m.chain_cap + ' is a broader farming surface.')
      )
    );
  }

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var steps = farmSteps(row);
    var recomputed = impliedOf(row, DATA.model);
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + DATA.board_size }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' · ' + ((row.chains || []).join(', ') || 'an unnamed chain') })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Model breakdown (' + DATA.model_version + ')' }),
      el('div', { class: 'equation' },
        el('span', { text: 'TVL' }), el('b', { text: fmtUsd(row.tvl_usd) }),
        el('span', { text: 'Seven-day growth (sqrt curve)' }), el('b', { text: fmtPct(row.change_7d) + ' → x' + row.growth_multiplier }),
        el('span', { text: 'Category median TVL' }), el('b', { text: row.category_median_tvl === null || row.category_median_tvl === undefined ? 'n/a' : fmtUsd(row.category_median_tvl) + ' → x' + row.category_multiplier }),
        el('span', { text: 'Age with no token (scarcity)' }), el('b', { text: fmtAge(row.age_days) + ' → x' + row.scarcity_multiplier }),
        el('span', { text: 'Chains (' + ((row.chains || []).length) + ')' }), el('b', { text: 'x' + row.chain_multiplier }),
        el('span', { text: 'Implied value' }), el('b', { class: 'total', text: fmtUsd(row.implied_value_usd) })
      ),
      el('p', { class: 'sub-note', text: 'The page recomputes this row as ' + fmtUsd(recomputed) + (recomputed === row.implied_value_usd ? ' — the same number board.json carries.' : ' — which differs from the board: the data would be stale.') + ' Implied value is an estimate of what a token would be worth at the base multiple, not a price.' })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Why ranked here' }),
      el('p', { class: 'why', text: row.why })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan' }),
      el('ol', { class: 'steps' }, steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
      }))
    ));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function renderTable() {
    var shell = app.querySelector('.shell');
    var old = document.getElementById('radar-table');
    if (old) old.remove();
    var table = state.tab === 'pre-token' ? boardTable() : liveTable();
    if (table.classList) table.id = 'radar-table';
    shell.insertBefore(table, shell.querySelector('.model'));
    setCount();
    if (state.selected) openDetail(state.selected);
  }

  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(lede());
    shell.appendChild(controls());
    shell.appendChild(state.tab === 'pre-token' ? boardTable() : liveTable());
    shell.lastChild.id = 'radar-table';
    if (state.tab === 'pre-token') shell.appendChild(modelPanel());
    app.appendChild(shell);
    countNode = document.getElementById('count');
    setCount();
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
    if (e.key === '/' && document.activeElement && document.activeElement.tagName !== 'INPUT') {
      var q = document.getElementById('q');
      if (q) { e.preventDefault(); q.focus(); }
    }
  });
})();
