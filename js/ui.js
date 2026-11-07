// ============================================================
// ui.js — HUD (DOM on top of the canvas): stats, kill feed,
// minimap, mode bar, build bar, hotbar, menus, death/spectate.
// ============================================================
MF.UI = (() => {
  const U = MF.U, C = MF.CFG;
  const $ = (id) => document.getElementById(id);
  let mini, miniCtx, mapImg = null, bigMapOpen = false, miniT = 0, hotSig = '', bannerT = 0, toastT = 0;
  let lastDuo = false;
  try { lastDuo = localStorage.getItem('mf3_duo') === '1'; } catch (e) {}

  function init() {
    mini = $('minimap'); miniCtx = mini.getContext('2d');
    mini.addEventListener('click', toggleMap);
    $('bigMap').addEventListener('click', toggleMap);

    $('playBtn').addEventListener('click', () => startGame(false));
    $('playDuoBtn').addEventListener('click', () => startGame(true));
    $('againBtn').addEventListener('click', () => startGame());
    $('specAgainBtn').addEventListener('click', () => startGame());
    $('winAgainBtn').addEventListener('click', () => startGame());
    $('menuBtn').addEventListener('click', toMenu);
    $('winMenuBtn').addEventListener('click', toMenu);
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

  // duo: true/false picks the mode, undefined = same mode as last time
  function startGame(duo) {
    if (typeof duo === 'boolean') lastDuo = duo;
    try { localStorage.setItem('mf3_duo', lastDuo ? '1' : '0'); } catch (e) {}
    ['menu', 'deathScreen', 'specBar', 'winScreen', 'rebootInfo'].forEach(hide);
    MF.Input.releaseAll();
    MF.Render.reset();
    MF.Match.start({ duo: lastDuo });
  }
  function toMenu() {
    ['deathScreen', 'specBar', 'winScreen', 'rebootInfo', 'hud'].forEach(hide);
    MF.Input.releaseAll();
    MF.G.phase = 'menu';
    show('menu');
  }

  const show = (id) => $(id).classList.remove('hidden');
  const hide = (id) => $(id).classList.add('hidden');

  // ---------- events from the match ----------
  function onMatchStart() {
    mapImg = MF.World.renderMinimap(300);
    hotSig = '';
    show('hud'); refreshMode();
    document.body.classList.toggle('duo', MF.G.duo);
    $('team').classList.toggle('hidden', !MF.G.duo);
    banner(MF.G.duo ? 'DUOS! TEAM UP WITH ' + MF.G.player.mate.name.toUpperCase() : 'BOARD THE BATTLE BUS!', '#59c3ff');
  }
  function onJump() { banner('GLIDE TO A GOOD SPOT!', '#ffe23d'); }
  function onLand() {}
  // Your run is over (solo death, or your whole duo is out)
  function onPlayerDeath(P) {
    MF.Input.releaseAll();
    $('deathPlace').textContent = '#' + P.placement;
    $('deathTitle').textContent = MF.G.duo ? 'TEAM ELIMINATED' : 'ELIMINATED';
    $('deathBy').textContent = P.killedBy ? `Eliminated by ${P.killedBy.name}` : 'Eliminated by the Storm';
    const k = MF.G.duo && P.mate ? `${P.kills} elimination${P.kills === 1 ? '' : 's'} • ${P.mate.name}: ${P.mate.kills}` : `${P.kills} elimination${P.kills === 1 ? '' : 's'}`;
    $('deathKills').textContent = k;
    setTimeout(() => { if (!P.alive && !MF.G.winner) { hide('specBar'); hide('rebootInfo'); show('deathScreen'); } }, 700);
  }
  // Duo: you're out, but your teammate can still reboot you
  function onPlayerWaiting(P) {
    MF.Input.releaseAll();
    MF.Input.setMode('fight');
    show('specBar'); show('rebootInfo'); refreshSpec();
    banner('YOUR TEAMMATE CAN REBOOT YOU!', '#59c3ff');
  }
  function onRebooted() {
    ['deathScreen', 'specBar', 'rebootInfo'].forEach(hide);
    MF.Input.releaseAll(); MF.Input.setMode('fight');
    banner("YOU'RE BACK! GLIDE DOWN", '#59c3ff');
  }
  function onWinner(w, members = [w]) {
    const G = MF.G, youWon = members.includes(G.player);
    const names = members.map((f) => f.name).join(' & ');
    $('winTitle').textContent = youWon ? '#1 VICTORY ROYALE' : `${names.toUpperCase()} WON!`;
    const kills = members.reduce((n, f) => n + f.kills, 0);
    $('winSub').textContent = youWon
      ? (G.duo ? `You: ${G.player.kills} • ${G.player.mate.name}: ${G.player.mate.kills} eliminations — GG!` : `${G.player.kills} eliminations — GG!`)
      : `${names} got ${kills} eliminations`;
    $('winScreen').classList.toggle('you', youWon);
    setTimeout(() => { hide('deathScreen'); hide('specBar'); hide('rebootInfo'); show('winScreen'); }, 1200);
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
    const hpv = watch.down ? Math.max(0, watch.downHp) : watch.hp;
    $('hpFill').style.width = Math.max(0, hpv) + '%';
    $('hpFill').parentElement.classList.toggle('downbar', !!watch.down);
    $('shFill').style.width = Math.max(0, watch.shield) + '%';
    $('hpNum').textContent = Math.ceil(hpv);
    $('shNum').textContent = Math.ceil(watch.shield);

    // materials
    for (const m of MF.MAT_ORDER) {
      $('mat_' + m).textContent = watch.mats[m];
      const bb = document.querySelector(`#buildBar .mat[data-mat="${m}"] b`);
      if (bb) bb.textContent = P.mats[m];
    }

    renderHotbar(watch);
    if (G.duo) updateTeam(P);

    // context buttons
    document.body.classList.toggle('dead', !P.alive);
    document.body.classList.toggle('knocked', P.alive && P.down);
    document.body.classList.toggle('inbus', P.state === 'bus');
    document.body.classList.toggle('gliding', P.state === 'glide');
    const act = $('actBtn');
    const sq = MF.Squad.option(P);
    const chest = P.alive && !P.down && P.state === 'ground' ? MF.Items.nearestChest(P) : null;
    act.classList.toggle('info', !!sq && sq.kind === 'info');
    act.classList.toggle('team', !!sq);
    if (sq) { act.dataset.kind = sq.kind; act.textContent = sq.label; act.classList.remove('hidden'); }
    else if (chest) { act.dataset.kind = 'open'; act.textContent = P.openProg > 0 ? 'OPENING…' : 'HOLD TO OPEN'; act.classList.remove('hidden'); }
    else if (P.alive && P.swapLoot) {
      act.dataset.kind = 'swap';
      const inst = P.swapLoot.inst;
      act.textContent = 'SWAP: ' + (inst.type === 'weapon' ? MF.WEAPONS[inst.id].short : MF.ITEMS[inst.id].name);
      act.classList.remove('hidden');
    } else act.classList.add('hidden');
    if (P.alive && P.down) {
      $('downFill').style.width = Math.max(0, P.downHp) + '%';
      $('downTxt').textContent = P.reviveProg > 0 ? `${P.reviveBy ? P.reviveBy.name : ''} IS REVIVING YOU…`
        : (MF.Squad.standing(P.mate) ? `CRAWL TO ${P.mate.name.toUpperCase()}` : '');
    }
    $('jumpBtn').classList.toggle('hidden', !(P.state === 'bus' && G.bus.t > 0.03));

    if (G.spectating) refreshSpec();

    // minimap at ~8 fps
    miniT -= dt;
    if (miniT <= 0) { miniT = 0.12; drawMap(mini, false); if (bigMapOpen) drawMap($('bigMapCanvas'), true); }
  }

  function updateTeam(P) {
    const m = P.mate;
    if (!m) return;
    $('mateName').textContent = m.name;
    let st = '', cls = '';
    if (!m.alive) {
      const c = MF.Squad.cardStatus(m);
      if (P.cards.includes(m)) { st = 'CARD: GO TO A REBOOT VAN!'; cls = 'card'; }
      else if (c && c.where === 'ground') { st = `💀 GRAB CARD ${U.fmtTime(c.left)}`; cls = 'card'; }
      else { st = '💀 OUT'; cls = 'out'; }
    } else if (m.down) { st = 'KNOCKED!'; cls = 'down'; }
    else if (m.state === 'bus') st = 'ON THE BUS';
    else if (m.state === 'glide') st = 'GLIDING';
    else st = Math.round(U.dist(P.x, P.y, m.x, m.y) / 10) + 'm';
    $('mateState').textContent = st;
    $('team').className = cls;
    $('mateHp').style.width = (m.alive ? (m.down ? m.downHp : m.hp) : 0) + '%';
    $('mateHp').parentElement.classList.toggle('downbar', m.down);
    $('mateSh').style.width = (m.alive && !m.down ? m.shield : 0) + '%';

    // waiting for a reboot
    if (!P.alive) {
      const c = MF.Squad.cardStatus(P);
      let t = '';
      if (!c || c.where === 'gone') t = 'Your reboot card is gone';
      else if (c.where === 'ground') t = `${m.name} must grab your reboot card (${U.fmtTime(c.left)})`;
      else if (!MF.Squad.rebootOpen()) t = 'Reboot vans are offline — cheer on ' + m.name + '!';
      else t = `${m.name} has your card — heading to a Reboot Van!`;
      $('rebootInfo').textContent = t;
    }
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
    // duo: reboot vans + your team's cards
    if (G.duo) {
      const vr = big ? 7 : 4;
      for (const v of G.vans) {
        g.fillStyle = v.cd > 0 || !MF.Squad.rebootOpen() ? '#7a8594' : '#3fb4ff';
        g.strokeStyle = '#fff'; g.lineWidth = 1.5;
        g.fillRect(v.x * k - vr, v.y * k - vr * 0.7, vr * 2, vr * 1.4); g.strokeRect(v.x * k - vr, v.y * k - vr * 0.7, vr * 2, vr * 1.4);
      }
      for (const c of G.cards) {
        if (c.team !== G.player.team) continue;
        g.fillStyle = '#59c3ff'; g.beginPath(); g.arc(c.x * k, c.y * k, big ? 6 : 3.5, 0, 7); g.fill();
        g.strokeStyle = '#fff'; g.stroke();
      }
    }
    // you, your teammate (and who you're spectating)
    const marks = [G.player];
    if (G.duo && G.player.mate) marks.push(G.player.mate);
    if (G.spectating && !marks.includes(G.spectating)) marks.push(G.spectating);
    for (const f of marks) {
      if (!f || (!f.alive && f !== G.player)) continue;
      const x = f.x * k, y = f.y * k, r = big ? 8 : 5;
      g.save(); g.translate(x, y); g.rotate(f.aim);
      g.fillStyle = f === G.player ? '#ffe23d' : (f.team === G.player.team ? '#59c3ff' : '#ff6bd5');
      g.strokeStyle = '#111'; g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(r * 1.4, 0); g.lineTo(-r, -r); g.lineTo(-r * 0.5, 0); g.lineTo(-r, r); g.closePath(); g.fill(); g.stroke();
      g.restore();
    }
  }

  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  return { init, onMatchStart, onJump, onLand, onPlayerDeath, onPlayerWaiting, onRebooted, onWinner, banner, toast, refreshMode, toggleMap, setSwap, update, startGame };
})();
