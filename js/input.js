// ============================================================
// input.js — mobile first: left stick moves, right stick aims +
// shoots (tap = quick auto-aim shot). Taps place / edit builds.
// PC: WASD, mouse aim + click, keys for modes (see menu).
// ============================================================
MF.Input = (() => {
  const U = MF.U, C = MF.CFG;
  const STICK_R = 60, MOVE_DEAD = 10, AIM_FIRE = 26;

  const keys = {};
  const mouse = { x: 0, y: 0, down: false, used: false };
  const touches = new Map();     // pointerId -> touch info
  let moveStick = null, aimStick = null;
  let interactHeld = false, tapFireT = 0, pcRot = 0;
  let canvas;

  function init(cv) {
    canvas = cv;
    cv.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    cv.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', (e) => { keys[e.key.toLowerCase()] = false; if (e.key.toLowerCase() === 'e') interactHeld = false; });
    window.addEventListener('wheel', (e) => {
      const P = MF.G.player; if (!P || MF.G.phase === 'menu') return;
      const i = ((P.pickaxe ? 0 : P.active) + (e.deltaY > 0 ? 1 : 4)) % 5;
      MF.F.selectSlot(P, i);
    }, { passive: true });
  }

  // ---------- pointer ----------
  function onDown(e) {
    if (MF.G.phase === 'menu') return;
    e.preventDefault();
    if (e.pointerType === 'mouse') {
      document.body.classList.add('pc'); mouse.used = true;
      mouse.x = e.clientX; mouse.y = e.clientY;
      if (e.button !== 0) return;
      mouse.down = true;
      const w = MF.Render.screenToWorld(e.clientX, e.clientY);
      if (MF.G.mode === 'build') placeGhost();
      else if (MF.G.mode === 'edit') editAt(w.x, w.y);
      return;
    }
    document.body.classList.remove('pc');
    const left = e.clientX < window.innerWidth * 0.5;
    const t = { id: e.pointerId, sx: e.clientX, sy: e.clientY, x: e.clientX, y: e.clientY, t0: performance.now(), kind: null, left };
    if (!left && MF.G.mode === 'fight' && !aimStick && isPlaying()) { t.kind = 'aim'; aimStick = t; }
    touches.set(e.pointerId, t);
  }

  function onMove(e) {
    if (e.pointerType === 'mouse') { mouse.x = e.clientX; mouse.y = e.clientY; return; }
    const t = touches.get(e.pointerId);
    if (!t) return;
    t.x = e.clientX; t.y = e.clientY;
    if (!t.kind && t.left && Math.hypot(t.x - t.sx, t.y - t.sy) > MOVE_DEAD && !moveStick) { t.kind = 'move'; moveStick = t; }
  }

  function onUp(e) {
    if (e.pointerType === 'mouse') { mouse.down = false; return; }
    const t = touches.get(e.pointerId);
    if (!t) return;
    touches.delete(e.pointerId);
    const moved = Math.hypot(t.x - t.sx, t.y - t.sy), dur = performance.now() - t.t0;
    if (t === moveStick) moveStick = null;
    if (t === aimStick) {
      aimStick = null;
      if (moved < 14 && dur < 260) quickShot();
      return;
    }
    if (!t.kind && moved < 14 && dur < 400) tap(t.sx, t.sy);
  }

  const isPlaying = () => MF.G.phase !== 'menu' && MF.G.player && MF.G.player.alive && !MF.G.spectating;

  function tap(sx, sy) {
    if (!isPlaying()) return;
    const w = MF.Render.screenToWorld(sx, sy);
    if (MF.G.mode === 'build') buildTap(w.x, w.y);
    else if (MF.G.mode === 'edit') editAt(w.x, w.y);
  }

  // Tap on the right side in fight mode: snap to the closest enemy you can see and shoot
  function quickShot() {
    const P = MF.G.player;
    let best = null, bd = 700;
    for (const o of MF.G.fighters) {
      if (o === P || !MF.F.isTargetable(o) || o.state === 'glide') continue;
      const d = U.dist(P.x, P.y, o.x, o.y);
      if (d < bd && !MF.Build.ray(P.x, P.y, o.x, o.y)) { bd = d; best = o; }
    }
    if (best) P.aim = Math.atan2(best.y - P.y, best.x - P.x);
    tapFireT = 0.12;
  }

  // ---------- keyboard ----------
  function onKey(e) {
    const k = e.key.toLowerCase();
    keys[k] = true;
    if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) document.body.classList.add('pc');
    const G = MF.G, P = G.player;
    if (G.phase === 'menu' || !P) return;
    if (k === ' ') { e.preventDefault(); if (P.state === 'bus') MF.Match.jump(P); }
    if (k === 'm') MF.UI.toggleMap();
    if (!P.alive) return;
    if (k >= '1' && k <= '5') { MF.F.selectSlot(P, +k - 1); setMode('fight'); }
    if (k === 'f') { MF.F.selectPickaxe(P); setMode('fight'); }
    if (k === 'q') setMode(G.mode === 'build' ? 'fight' : 'build');
    if (k === 'g') setMode(G.mode === 'edit' ? 'fight' : 'edit');
    if (k === 'e') interactHeld = true;
    if (k === 'r') { if (G.mode === 'build') rotate(); else MF.Combat.startReload(P); }
    if (k === 'z') setMat('wood');
    if (k === 'x') setMat('brick');
    if (k === 'c') setMat('metal');
  }

  // ---------- modes / building ----------
  function setMode(m) {
    MF.G.mode = m;
    if (m !== 'build') MF.G.ghost = null;
    pcRot = 0;
    MF.UI.refreshMode();
  }
  function setMat(m) { MF.G.player.buildMat = m; MF.UI.refreshMode(); }

  function buildTap(wx, wy) {
    const e = MF.Build.edgeFromPoint(wx, wy);
    const g = MF.G.ghost;
    if (g && g.k === e.k && g.cx === e.cx && g.cy === e.cy) { placeGhost(); return; }
    MF.G.ghost = e;
  }
  function rotate() {
    const g = MF.G.ghost;
    if (mouse.used && document.body.classList.contains('pc')) { pcRot = (pcRot + 1) % 4; return; }
    if (!g) return;
    MF.G.ghost = MF.Build.edgeOf(g.cell[0], g.cell[1], (g.side + 1) % 4);
  }

  // Why a ghost can't be placed (null = OK)
  function ghostProblem(g) {
    const P = MF.G.player;
    if (!g) return 'none';
    const c = MF.Build.edgeCenter(g);
    if (U.dist(P.x, P.y, c.x, c.y) > C.BUILD_RANGE) return 'TOO FAR';
    if (!MF.Build.canPlace(g)) return 'BLOCKED';
    if (P.mats[P.buildMat] < C.WALL_COST) return 'NO ' + MF.MATERIALS[P.buildMat].name.toUpperCase();
    return null;
  }
  function placeGhost() {
    const P = MF.G.player, g = MF.G.ghost;
    if (!isPlaying() || P.state !== 'ground') return false;
    const why = ghostProblem(g);
    if (why) { if (why !== 'none') MF.UI.toast(why); return false; }
    MF.Build.place(g, P.buildMat, P.id);
    P.mats[P.buildMat] -= C.WALL_COST;
    return true;
  }
  function editAt(wx, wy) {
    const P = MF.G.player;
    if (U.dist(P.x, P.y, wx, wy) > C.EDIT_RANGE) { MF.UI.toast('TOO FAR'); return; }
    const hit = MF.Build.nearestOwnSeg(wx, wy, P.id, 34);
    if (!hit) return;
    if (!MF.Build.toggleEdit(hit.w, hit.i)) MF.UI.toast('KEEP ONE PIECE');
  }

  // ---------- per frame ----------
  function moveVector() {
    let x = 0, y = 0;
    if (moveStick) {
      const dx = moveStick.x - moveStick.sx, dy = moveStick.y - moveStick.sy;
      const d = Math.hypot(dx, dy);
      const m = Math.min(1, d / STICK_R);
      if (d > 4) { x = dx / d * m; y = dy / d * m; }
    }
    if (keys.w || keys.arrowup) y -= 1;
    if (keys.s || keys.arrowdown) y += 1;
    if (keys.a || keys.arrowleft) x -= 1;
    if (keys.d || keys.arrowright) x += 1;
    const l = Math.hypot(x, y);
    if (l > 1) { x /= l; y /= l; }
    return { x, y };
  }

  function applyToPlayer(P, dt) {
    if (!P || !P.alive || MF.G.phase === 'menu') return;
    tapFireT = Math.max(0, tapFireT - dt);
    const pc = document.body.classList.contains('pc');

    // PC build ghost follows the mouse
    if (pc && MF.G.mode === 'build' && P.state === 'ground') {
      const w = MF.Render.screenToWorld(mouse.x, mouse.y);
      const e = MF.Build.edgeFromPoint(w.x, w.y);
      MF.G.ghost = pcRot ? MF.Build.edgeOf(e.cell[0], e.cell[1], (e.side + pcRot) % 4) : e;
    }

    if (P.state !== 'ground') { MF.UI.setSwap(null); return; }

    // move
    const mv = moveVector();
    const sp = MF.F.speedOf(P);
    const ox = P.x, oy = P.y;
    MF.F.move(P, mv.x * sp * dt, mv.y * sp * dt);
    P.vx = (P.x - ox) / dt; P.vy = (P.y - oy) / dt;

    // aim
    let firing = false;
    if (pc && mouse.used) {
      const w = MF.Render.screenToWorld(mouse.x, mouse.y);
      P.aim = Math.atan2(w.y - P.y, w.x - P.x);
      firing = mouse.down && MF.G.mode === 'fight';
    }
    if (aimStick) {
      const dx = aimStick.x - aimStick.sx, dy = aimStick.y - aimStick.sy;
      const d = Math.hypot(dx, dy);
      if (d > 8) P.aim = Math.atan2(dy, dx);
      if (d > AIM_FIRE) firing = true;
    } else if (!pc && Math.hypot(mv.x, mv.y) > 0.2) {
      P.aim = Math.atan2(mv.y, mv.x);
    }
    if (tapFireT > 0) firing = true;

    // act
    if (firing && MF.G.mode === 'fight') {
      const s = MF.F.activeSlot(P);
      if (P.pickaxe || !s) MF.Combat.swing(P);
      else if (s.type === 'weapon') MF.Combat.fire(P);
      else MF.Items.useActive(P);
    }

    // chests + loot
    MF.Items.holdOpen(P, interactHeld, dt);
    MF.UI.setSwap(MF.Items.autoPickup(P));
    MF.Items.update(P, dt);
  }

  function setInteract(v) { interactHeld = v; }
  const sticks = () => ({ move: moveStick, aim: aimStick, R: STICK_R });

  return { init, moveVector, applyToPlayer, setMode, setMat, rotate, placeGhost, ghostProblem, setInteract, sticks,
           releaseAll() { touches.clear(); moveStick = aimStick = null; mouse.down = false; interactHeld = false; } };
})();
