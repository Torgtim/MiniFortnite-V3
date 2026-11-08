// ============================================================
// settings.js — player settings, lifetime stats and PC key
// binds. Everything is saved in the browser (localStorage).
// ============================================================
MF.Settings = (() => {
  const KEY_SETTINGS = 'mf3_settings', KEY_STATS = 'mf3_stats';

  // action → [label, default key]   (keys are KeyboardEvent.key, lower-case)
  const ACTIONS = {
    up: ['Move up', 'w'], down: ['Move down', 's'], left: ['Move left', 'a'], right: ['Move right', 'd'],
    slot1: ['Slot 1', '1'], slot2: ['Slot 2', '2'], slot3: ['Slot 3', '3'], slot4: ['Slot 4', '4'], slot5: ['Slot 5', '5'],
    pickaxe: ['Pickaxe', 'f'], build: ['Build mode', 'q'], edit: ['Edit mode', 'g'],
    reload: ['Reload', 'r'], rotate: ['Rotate build', 'r'],
    wood: ['Wood', 'z'], brick: ['Brick', 'x'], metal: ['Metal', 'c'],
    interact: ['Open / revive / reboot', 'e'], jump: ['Jump from bus', ' '], map: ['Map', 'm'],
  };
  // reload + rotate may share a key (rotate only works in build mode)
  const SHAREABLE = [['reload', 'rotate']];

  const defaults = () => ({
    buildMode: 'classic',          // classic = tap to preview, tap again to place · insta = place on first tap
    minimap: true,
    autoMat: true,                 // out of the chosen material → use one you have
    binds: Object.fromEntries(Object.entries(ACTIONS).map(([a, [, k]]) => [a, k])),
  });
  const emptyStats = () => ({ matches: 0, kills: 0, wins: 0, soloWins: 0, duoWins: 0, top5: 0 });

  let s = defaults(), stats = emptyStats();

  function load() {
    try {
      const raw = JSON.parse(localStorage.getItem(KEY_SETTINGS) || 'null');
      if (raw) s = { ...defaults(), ...raw, binds: { ...defaults().binds, ...(raw.binds || {}) } };
    } catch (e) {}
    try {
      const raw = JSON.parse(localStorage.getItem(KEY_STATS) || 'null');
      if (raw) stats = { ...emptyStats(), ...raw };
    } catch (e) {}
  }
  const save = () => { try { localStorage.setItem(KEY_SETTINGS, JSON.stringify(s)); } catch (e) {} };
  const saveStats = () => { try { localStorage.setItem(KEY_STATS, JSON.stringify(stats)); } catch (e) {} };

  const get = (k) => s[k];
  function set(k, v) { s[k] = v; save(); apply(); }

  // ---------- key binds ----------
  const keyOf = (action) => s.binds[action];
  // all actions bound to this key
  const actionsFor = (key) => Object.keys(s.binds).filter((a) => s.binds[a] === key);
  function bind(action, key) {
    const old = s.binds[action];
    for (const a of actionsFor(key)) {
      if (a === action) continue;
      const shared = SHAREABLE.some((p) => p.includes(a) && p.includes(action));
      if (!shared) s.binds[a] = old;          // swap so nothing ends up unbound
    }
    s.binds[action] = key;
    save();
  }
  function resetBinds() { s.binds = defaults().binds; save(); }
  const keyName = (k) => (k === ' ' ? 'SPACE' : k.startsWith('arrow') ? k.slice(5).toUpperCase() + ' ↕' : k.length === 1 ? k.toUpperCase() : k.toUpperCase());

  // ---------- stats ----------
  // Called once per match when your run ends (or you leave it)
  function recordMatch({ won, duo, kills, place }) {
    stats.matches++;
    stats.kills += kills;
    if (won) { stats.wins++; if (duo) stats.duoWins++; else stats.soloWins++; }
    if (place && place <= 5) stats.top5++;
    saveStats();
  }
  const getStats = () => ({ ...stats });

  // ---------- apply to the page ----------
  function apply() {
    document.body.classList.toggle('nomini', !s.minimap);
  }

  // ---------- settings screen ----------
  const $ = (id) => document.getElementById(id);
  const isPC = () => window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  let listening = null;   // action waiting for a key press

  function initUI() {
    $('settingsBtn').addEventListener('click', open);
    $('setClose').addEventListener('click', close);
    $('setBuild').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-v]'); if (!b) return;
      set('buildMode', b.dataset.v); render();
    });
    $('setMini').addEventListener('click', () => { set('minimap', !s.minimap); render(); });
    $('setAutoMat').addEventListener('click', () => { set('autoMat', !s.autoMat); render(); });
    $('setShowBinds').addEventListener('click', () => { $('bindBox').classList.toggle('hidden'); render(); });
    $('bindReset').addEventListener('click', () => { listening = null; resetBinds(); render(); });
    $('bindList').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-a]'); if (!b) return;
      listening = listening === b.dataset.a ? null : b.dataset.a; render();
    });
    // capture the next key while rebinding (before the game sees it)
    window.addEventListener('keydown', (e) => {
      if (!listening) return;
      e.preventDefault(); e.stopImmediatePropagation();
      const k = e.key.toLowerCase();
      if (k !== 'escape') bind(listening, k);
      listening = null; render();
    }, true);
    apply();
  }

  function open() { listening = null; render(); $('settings').classList.remove('hidden'); }
  function close() { listening = null; $('settings').classList.add('hidden'); }

  function render() {
    for (const b of $('setBuild').querySelectorAll('button')) b.classList.toggle('on', b.dataset.v === s.buildMode);
    $('setBuildHint').textContent = s.buildMode === 'insta'
      ? 'Instabuild: the wall is built the moment you tap.'
      : 'Classic: tap to show a preview, tap again (or ✓) to build.';
    toggleBtn($('setMini'), s.minimap);
    toggleBtn($('setAutoMat'), s.autoMat);

    const st = stats;
    $('statGrid').innerHTML = [
      ['🏆', 'Victory Royales', st.wins],
      ['👤', 'Solo wins', st.soloWins],
      ['👥', 'Duo wins', st.duoWins],
      ['💀', 'Eliminations', st.kills],
      ['🎮', 'Matches', st.matches],
      ['⭐', 'Top 5', st.top5],
    ].map(([i, l, v]) => `<div class="stat"><b>${v}</b><span>${i} ${l}</span></div>`).join('');

    $('pcOnly').classList.toggle('hidden', !isPC());
    const shown = !$('bindBox').classList.contains('hidden');
    $('setShowBinds').textContent = shown ? 'HIDE KEY BINDS' : 'SHOW KEY BINDS';
    $('bindList').innerHTML = Object.entries(ACTIONS).map(([a, [label]]) =>
      `<div class="bindRow"><span>${label}</span><button data-a="${a}" class="${listening === a ? 'listen' : ''}">${listening === a ? 'PRESS A KEY…' : keyName(s.binds[a])}</button></div>`).join('');
  }
  function toggleBtn(el, on) { el.classList.toggle('on', on); el.textContent = on ? 'ON' : 'OFF'; }

  load();
  return { get, set, keyOf, actionsFor, bind, resetBinds, keyName, recordMatch, getStats, initUI, open, close, apply };
})();
