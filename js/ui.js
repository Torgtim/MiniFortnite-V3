// ============================================================
// ui.js — HUD (DOM on top of the canvas): stats, kill feed,
// minimap, mode bar, build bar, hotbar, menus, death/spectate.
// ============================================================
MF.UI = (() => {
  const U = MF.U, C = MF.CFG;
  const $ = (id) => document.getElementById(id);
  let mini, miniCtx, mapImg = null, bigMapOpen = false, miniT = 0, hotSig = '', bannerT = 0, toastT = 0;

  function init() {
    mini = $('minimap'); miniCtx = mini.getContext('2d');
    mini.addEventListener('click', toggleMap);
    $('bigMap').addEventListener('click', toggleMap);

    $('playBtn').addEventListener('click', startGame);
    $('againBtn').addEventListener('click', startGame);
    $('specAgainBtn').addEventListener('click', startGame);
    $('winAgainBtn').addEventListener('click', startGame);
    $('specBtn').addEventListener('click', () => {
      MF.Match.spectate(MF.G.player.killedBy);
      hide('deathScreen'); show('specBar'); refreshSpec();
    });
    $('specPrev').addEventListener('click', () => { MF.Match.cycleSpectate(-1); refreshSpec(); });
    $('specNext').addEventListener('click', () => { MF.Match.cycleSpectate(1); refreshSpec(); });
    $('jumpBtn').addEventListener('click', () => MF.Match.jump(MF.G.player));

    document.querySelectorAll('#modeBar button').forEach((b) => b.addEventListener('click', () => MF.Input.setMode(b.dataset.mode)));
    $('rotBtn').addEventListener('click', () => MF.Input.rotate());
    $('placeBtn').addEventListener('click', () => MF.Input.placeGhost());
    document.querySelectorAll('#buildBar .mat').forEach((b) => b.addEventListener('click', () => MF.Input.setMat(b.dataset.mat)));

    // hold-to-open button (also taps "swap")
    const act = $('actBtn');
    const down = (e) => {
      e.preventDefault();
      const P = MF.G.player;
      if (act.dataset.kind === 'swap' && P.swapLoot) MF.Items.swap(P, P.swapLoot);
      else MF.Input.setInteract(true);
    };
    const up = (e) => { e.preventDefault(); MF.Input.setInteract(false); };
    act.addEventListener('pointerdown', down);
    act.addEventListener('pointerup', up);
    act.addEventListener('pointerleave', up);
    act.addEventListener('pointercancel', up);

    $('pickBtn').addEventListener('click', () => { MF.F.selectPickaxe(MF.G.player); MF.Input.setMode('fight'); });
    $('hotbar').addEventListener('click', (e) => {
      const el = e.target.closest('.slot');
      if (!el) return;
      const P = MF.G.player, i = +el.dataset.i;
      if (i < 0) MF.F.selectPickaxe(P);
      else if (!P.pickaxe && P.active === i) MF.Combat.startReload(P);
      else MF.F.selectSlot(P, i);
      MF.Input.setMode('fight');
    });
    // stop HUD touches from reaching the canvas joysticks
    document.querySelectorAll('.hud-touch').forEach((el) => el.addEventListener('pointerdown', (e) => e.stopPropagation()));
  }

  function startGame() {
    ['menu', 'deathScreen', 'specBar', 'winScreen'].forEach(hide);
    MF.Input.releaseAll();
    MF.Render.reset();
    MF.Match.start();
  }

  const show = (id) => $(id).classList.remove('hidden');
  const hide = (id) => $(id).classList.add('hidden');

  // ---------- events from the match ----------
  function onMatchStart() {
    mapImg = MF.World.renderMinimap(300);
    hotSig = '';
    show('hud'); refreshMode();
    banner('BOARD THE BATTLE BUS!', '#59c3ff');
  }
  function onJump() { banner('GLIDE TO A GOOD SPOT!', '#ffe23d'); }
  function onLand() {}
  function onPlayerDeath(P) {
    MF.Input.releaseAll();
    $('deathPlace').textContent = '#' + P.placement;
    $('deathBy').textContent = P.killedBy ? `Eliminated by ${P.killedBy.name}` : 'Eliminated by the Storm';
    $('deathKills').textContent = `${P.kills} elimination${P.kills === 1 ? '' : 's'}`;
    setTimeout(() => show('deathScreen'), 700);
  }
  function onWinner(w) {
    const youWon = w === MF.G.player;
    $('winTitle').textContent = youWon ? '#1 VICTORY ROYALE' : `${w.name.toUpperCase()} WON!`;
    $('winSub').textContent = youWon ? `${MF.G.player.kills} eliminations — GG!` : `${w.name} got ${w.kills} eliminations`;
    $('winScreen').classList.toggle('you', youWon);
    setTimeout(() => { hide('deathScreen'); hide('specBar'); show('winScreen'); }, 1200);
  }

  function banner(text, color = '#fff') {
    const b = $('banner');
    b.textContent = text; b.style.color = color;
    b.classList.remove('pop'); void b.offsetWidth; b.classList.add('pop');
    bannerT = 2.6;
  }
  function toast(text) {
    const t = $('toast');
    t.textContent = text; t.classList.add('on'); toastT = 1.1;
  }

  function refreshMode() {
    const m = MF.G.mode;
    document.querySelectorAll('#modeBar button').forEach((b) => b.classList.toggle('on', b.dataset.mode === m));
    document.body.dataset.mode = m;
    const P = MF.G.player;
    if (P) document.querySelectorAll('#buildBar .mat').forEach((b) => b.classList.toggle('on', b.dataset.mat === P.buildMat));
  }
  function refreshSpec() {
    const s = MF.G.spectating;
    $('specName').textContent = s ? s.name : '—';
    $('specKills').textContent = s ? `${s.kills} kills • ${Math.ceil(s.hp)} HP • ${Math.ceil(s.shield)} shield` : '';
  }

  function toggleMap() {
    bigMapOpen = !bigMapOpen;
    $('bigMap').classList.toggle('hidden', !bigMapOpen);
    if (bigMapOpen) drawMap($('bigMapCanvas'), true);
  }

  function setSwap(loot) {
    const P = MF.G.player;
    if (P) P.swapLoot = loot;
  }

  // ---------- per frame ----------
  function update(dt) {
    const G = MF.G, P = G.player;
    if (G.phase === 'menu' || !P) return;
    bannerT -= dt; if (bannerT <= 0) $('banner').classList.remove('pop');
    toastT -= dt; if (toastT <= 0) $('toast').classList.remove('on');

    $('aliveTxt').textContent = MF.Match.aliveCount();
    $('killTxt').textContent = P.kills;
    const s = G.storm;
    $('stormTxt').textContent = s.phase >= MF.STORM.length ? 'FINAL' : (s.shrinking ? 'SHRINKING ' : 'STORM IN ') + U.fmtTime(s.timer);
    $('stormTxt').parentElement.classList.toggle('warn', s.shrinking || !MF.Match.inSafe(P.x, P.y));

    // kill feed
    const feed = G.feed.filter((f) => G.time - f.t < 7).map((f) => `<div class="${f.you ? 'you' : ''}">${esc(f.text)} <i>${esc(f.weapon || '')}</i></div>`).join('');
    if ($('feed').dataset.v !== feed) { $('feed').innerHTML = feed; $('feed').dataset.v = feed; }

    // health
    const watch = MF.Match.camTarget() || P;
    $('hpFill').style.width = Math.max(0, watch.hp) + '%';
    $('shFill').style.width = Math.max(0, watch.shield) + '%';
    $('hpNum').textContent = Math.ceil(watch.hp);
    $('shNum').textContent = Math.ceil(watch.shield);

    // materials
    for (const m of MF.MAT_ORDER) {
      $('mat_' + m).textContent = watch.mats[m];
      const bb = document.querySelector(`#buildBar .mat[data-mat="${m}"] b`);
      if (bb) bb.textContent = P.mats[m];
    }

    renderHotbar(watch);

    // context buttons
    document.body.classList.toggle('dead', !P.alive);
    document.body.classList.toggle('inbus', P.state === 'bus');
    document.body.classList.toggle('gliding', P.state === 'glide');
    const act = $('actBtn');
    const chest = P.alive && P.state === 'ground' ? MF.Items.nearestChest(P) : null;
    if (chest) { act.dataset.kind = 'open'; act.textContent = P.openProg > 0 ? 'OPENING…' : 'HOLD TO OPEN'; act.classList.remove('hidden'); }
    else if (P.alive && P.swapLoot) {
      act.dataset.kind = 'swap';
      const inst = P.swapLoot.inst;
      act.textContent = 'SWAP: ' + (inst.type === 'weapon' ? MF.WEAPONS[inst.id].short : MF.ITEMS[inst.id].name);
      act.classList.remove('hidden');
    } else act.classList.add('hidden');
    $('jumpBtn').classList.toggle('hidden', !(P.state === 'bus' && G.bus.t > 0.03));

    if (G.spectating) refreshSpec();

    // minimap at ~8 fps
    miniT -= dt;
    if (miniT <= 0) { miniT = 0.12; drawMap(mini, false); if (bigMapOpen) drawMap($('bigMapCanvas'), true); }
  }

  function renderHotbar(f) {
    const parts = [`<div class="slot pick ${f.pickaxe ? 'on' : ''}" data-i="-1"><span class="ic">⛏</span><small>PICK</small></div>`];
    for (let i = 0; i < 5; i++) {
      const s = f.slots[i];
      const on = !f.pickaxe && f.active === i ? 'on' : '';
      if (!s) { parts.push(`<div class="slot empty ${on}" data-i="${i}"><small>${i + 1}</small></div>`); continue; }
      if (s.type === 'weapon') {
        const def = MF.WEAPONS[s.id], rar = MF.RARITIES[s.rarity];
        const reloading = on && f.reloadT > 0;
        parts.push(`<div class="slot ${on}" data-i="${i}" style="--rc:${rar.color}"><span class="nm">${def.short}</span><small>${reloading ? 'RELOAD' : s.ammo + '/' + def.mag}</small></div>`);
      } else {
        const def = MF.ITEMS[s.id];
        parts.push(`<div class="slot item ${on}" data-i="${i}" style="--rc:${def.color}"><span class="nm">${def.name}</span><small>x${s.count}</small></div>`);
      }
    }
    const html = parts.join('');
    if (html !== hotSig) { $('hotbar').innerHTML = html; hotSig = html; }
  }

  function drawMap(canvas, big) {
    const G = MF.G;
    if (!mapImg) return;
    const size = big ? Math.min(window.innerWidth, window.innerHeight) * 0.86 : 150;
    if (canvas.width !== Math.round(size)) { canvas.width = canvas.height = Math.round(size); }
    const g = canvas.getContext('2d'), k = size / C.WORLD;
    g.drawImage(mapImg, 0, 0, size, size);
    const s = G.storm;
    // storm
    g.save();
    g.beginPath(); g.rect(0, 0, size, size); g.arc(s.cx * k, s.cy * k, Math.max(0, s.r * k), 0, Math.PI * 2, true);
    g.fillStyle = 'rgba(122,40,214,0.45)'; g.fill('evenodd');
    g.strokeStyle = '#fff'; g.setLineDash([4, 3]); g.lineWidth = big ? 2 : 1.2;
    g.beginPath(); g.arc(s.nx * k, s.ny * k, Math.max(0, s.nr * k), 0, Math.PI * 2); g.stroke(); g.setLineDash([]);
    g.restore();
    // bus route
    if (!G.bus.done) {
      g.strokeStyle = 'rgba(255,255,255,0.8)'; g.lineWidth = big ? 3 : 2; g.setLineDash([6, 4]);
      g.beginPath(); g.moveTo(G.bus.x0 * k, G.bus.y0 * k); g.lineTo(G.bus.x1 * k, G.bus.y1 * k); g.stroke(); g.setLineDash([]);
      g.fillStyle = '#2f7bff'; g.beginPath(); g.arc(G.bus.x * k, G.bus.y * k, big ? 7 : 4, 0, 7); g.fill();
    }
    // POI names
    if (big) {
      g.font = `bold ${Math.round(size / 40)}px "Bebas Neue", Impact, sans-serif`; g.textAlign = 'center';
      for (const p of G.pois) {
        g.lineWidth = 3; g.strokeStyle = 'rgba(0,0,0,0.7)'; g.strokeText(p.name.toUpperCase(), p.x * k, p.y * k);
        g.fillStyle = '#fff'; g.fillText(p.name.toUpperCase(), p.x * k, p.y * k);
      }
    }
    // you (and who you're spectating)
    const marks = [G.player];
    if (G.spectating) marks.push(G.spectating);
    for (const f of marks) {
      if (!f || (!f.alive && f !== G.player)) continue;
      const x = f.x * k, y = f.y * k, r = big ? 8 : 5;
      g.save(); g.translate(x, y); g.rotate(f.aim);
      g.fillStyle = f === G.player ? '#ffe23d' : '#ff6bd5';
      g.strokeStyle = '#111'; g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(r * 1.4, 0); g.lineTo(-r, -r); g.lineTo(-r * 0.5, 0); g.lineTo(-r, r); g.closePath(); g.fill(); g.stroke();
      g.restore();
    }
  }

  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  return { init, onMatchStart, onJump, onLand, onPlayerDeath, onWinner, banner, toast, refreshMode, toggleMap, setSwap, update, startGame };
})();
