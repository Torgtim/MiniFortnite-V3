// ============================================================
// ai.js — bot brains.
//
// Every bot has a personality (aggressive / cautious / builder)
// and a skill value. A "think" step (~4x per second) decides
// WHAT to do; the "act" step runs every frame and does it.
//
// Modes: fight, chase, investigate, rotate, heal, loot, harvest, hunt
// Duo modes: revive (teammate knocked), card (grab their reboot card),
// reboot (carry it to a Reboot Van), regroup (stay near teammate).
// Knocked bots crawl towards their teammate.
// In fights bots: pick the right gun for the range, strafe, lead
// their shots, build walls when shot, box up to heal, edit-peek
// out of their own walls, and pickaxe through walls in their way.
// ============================================================
MF.AI = (() => {
  const U = MF.U, C = MF.CFG;

  const PERS = {
    aggressive: { rangeMul: 0.7,  buildChance: 0.45, boxHp: 45, healAt: 50, peek: 0.35 },
    cautious:   { rangeMul: 1.25, buildChance: 0.85, boxHp: 85, healAt: 85, peek: 0.6 },
    builder:    { rangeMul: 1.0,  buildChance: 0.95, boxHp: 70, healAt: 70, peek: 0.95 },
  };
  const WEAPON_VALUE = { ar: 10, shotgun: 10, smg: 8, sniper: 7, pistol: 5, rocket: 6 };

  function init(bot) {
    const pers = U.pick(Object.keys(PERS));
    bot.brain = {
      pers, P: PERS[pers], skill: U.rand(0.35, 0.92),
      mode: 'loot', goal: null, goalT: 0, think: U.rand(0.3),
      target: null, seenT: -99, firstSeenT: 0, lastSeen: null, los: false,
      strafe: U.chance(0.5) ? 1 : -1, strafeT: 0,
      stuckT: 0, detourT: 0, detourDir: 1, breakIt: null, breakT: 0,
      buildCd: U.rand(1), peek: null, aimErr: 0, aimErrT: 0,
      huntPlayer: U.chance(0.55), lootUntil: null, dropAt: null, jumpAt: 0.5, burstT: 0, bursting: true,
    };
  }

  // ---------- bus / glide ----------
  function planDrop(bot, bus) {
    const b = bot.brain;
    const poi = MF.G.pois.length && U.chance(0.5) ? U.pick(MF.G.pois) : null;
    const pt = poi ? { x: poi.x + U.rand(-250, 250), y: poi.y + U.rand(-250, 250) } : (MF.World.randomLandPoint(400) || { x: C.WORLD / 2, y: C.WORLD / 2 });
    b.dropAt = pt;
    const ax = bus.x1 - bus.x0, ay = bus.y1 - bus.y0;
    const t = ((pt.x - bus.x0) * ax + (pt.y - bus.y0) * ay) / (ax * ax + ay * ay);
    b.jumpAt = U.clamp(t + U.rand(-0.12, 0.04), 0.08, 0.95);
  }
  // Duo: both bots of a team land together; your teammate follows YOU
  function planTeamDrops() {
    for (const f of MF.G.fighters) {
      if (!f.isBot || !f.mate) continue;
      const m = f.mate;
      if (!m.isBot) { f.brain.jumpAt = 99; f.brain.followPlayer = true; continue; }
      if (m.id < f.id) {
        f.brain.dropAt = { x: m.brain.dropAt.x + U.rand(-90, 90), y: m.brain.dropAt.y + U.rand(-90, 90) };
        f.brain.jumpAt = m.brain.jumpAt + U.rand(0, 0.01);
      }
    }
  }
  function onRespawn(bot, van) {
    const b = bot.brain;
    b.mode = 'loot'; b.target = null; b.goal = null; b.breakIt = null; b.peek = null;
    b.dropAt = { x: van.x + U.rand(-260, 260), y: van.y + U.rand(-260, 260) };
    b.lootUntil = now() + MF.Squad.S.RESPAWN_GLIDE + U.rand(5, 9);
  }
  function glideDir(bot) {
    if (bot.brain.followPlayer && bot.mate && bot.mate.state === 'glide') {
      const P = bot.mate, tx = P.x + 60, ty = P.y + 40;
      const d = U.dist(bot.x, bot.y, tx, ty);
      return d < 20 ? { x: 0, y: 0 } : { x: (tx - bot.x) / d, y: (ty - bot.y) / d };
    }
    if (bot.brain.followPlayer && bot.mate && bot.mate.state === 'ground') bot.brain.dropAt = { x: bot.mate.x + 70, y: bot.mate.y + 50 };
    const t = bot.brain.dropAt;
    const d = U.dist(bot.x, bot.y, t.x, t.y);
    if (d < 20) return { x: 0, y: 0 };
    return { x: (t.x - bot.x) / d, y: (t.y - bot.y) / d };
  }

  // ---------- helpers ----------
  const now = () => MF.G.time;
  function los(a, o) {
    return !MF.Build.ray(a.x, a.y, o.x, o.y) && !MF.World.propRay(a.x, a.y, o.x, o.y);
  }
  const totalMats = (f) => f.mats.wood + f.mats.brick + f.mats.metal;
  function pickMat(bot) {
    const order = bot.brain.pers === 'cautious' ? ['metal', 'brick', 'wood'] : ['wood', 'brick', 'metal'];
    for (const m of order) if (bot.mats[m] >= C.WALL_COST) return m;
    return null;
  }
  function weaponCount(f) { return f.slots.filter((s) => s && s.type === 'weapon').length; }
  function healSlot(f) {
    let best = -1, bestScore = 0;
    f.slots.forEach((s, i) => {
      if (!s || s.type !== 'item') return;
      const d = MF.ITEMS[s.id];
      let sc = 0;
      if (d.kind === 'heal' && f.hp < d.cap) sc = Math.min(d.heal, d.cap - f.hp);
      if (d.kind === 'shield' && f.shield < d.cap) sc = Math.min(d.shield, d.cap - f.shield) + 5;
      if (sc > bestScore) { bestScore = sc; best = i; }
    });
    return best;
  }

  function chooseWeapon(bot, d, hasLos) {
    let best = -1, bs = -1e9;
    bot.slots.forEach((s, i) => {
      if (!s || s.type !== 'weapon') return;
      const def = MF.WEAPONS[s.id];
      let sc = MF.RARITIES[s.rarity].mult * 6 - Math.abs(d - def.pref) / 90;
      if (d > def.range * 0.95) sc -= 50;
      if (s.ammo <= 0) sc -= 4;
      if (def.rocket) sc += hasLos ? -2 : 4;
      if (sc > bs) { bs = sc; best = i; }
    });
    return best;
  }

  function weaponValue(inst) { return WEAPON_VALUE[inst.id] * (1 + inst.rarity * 0.12); }

  // Bots grab loot they walk over, and upgrade weapons when full
  function pickup(bot) {
    for (const l of [...MF.G.loot]) {
      if (U.dist(bot.x, bot.y, l.x, l.y) > bot.r + 30) continue;
      if (MF.F.give(bot, l.inst)) { MF.Items.removeLoot(l); continue; }
      if (l.inst.type === 'weapon') {
        let worst = -1, wv = 1e9;
        bot.slots.forEach((s, i) => { if (s && s.type === 'weapon' && weaponValue(s) < wv) { wv = weaponValue(s); worst = i; } });
        if (worst >= 0 && weaponValue(l.inst) > wv + 1) {
          MF.World.dropLoot(bot.x, bot.y, bot.slots[worst]);
          bot.slots[worst] = l.inst; MF.Items.removeLoot(l);
        }
      }
    }
  }

  // ---------- building ----------
  function wallToward(bot, tx, ty) {
    const mat = pickMat(bot);
    if (!mat) return false;
    const cx = Math.floor(bot.x / MF.Build.G), cy = Math.floor(bot.y / MF.Build.G);
    const e = MF.Build.edgeFacing(cx, cy, Math.atan2(ty - bot.y, tx - bot.x));
    if (!MF.Build.place(e, mat, bot.id)) return false;
    bot.mats[mat] -= C.WALL_COST;
    return true;
  }
  function boxUp(bot) {
    const cx = Math.floor(bot.x / MF.Build.G), cy = Math.floor(bot.y / MF.Build.G);
    let n = 0;
    for (let s = 0; s < 4; s++) {
      const mat = pickMat(bot);
      if (!mat) break;
      if (MF.Build.place(MF.Build.edgeOf(cx, cy, s), mat, bot.id)) { bot.mats[mat] -= C.WALL_COST; n++; }
    }
    return n;
  }

  // ---------- movement ----------
  function moveTo(bot, tx, ty, dt, mul = 1, face = true) {
    const b = bot.brain;
    const dx = tx - bot.x, dy = ty - bot.y;
    const d = Math.hypot(dx, dy);
    if (d < 8) { bot.vx = bot.vy = 0; return true; }
    let a = Math.atan2(dy, dx);
    if (b.detourT > 0) { a += b.detourDir * 1.25; b.detourT -= dt; }
    const sp = MF.F.speedOf(bot) * mul;
    const ox = bot.x, oy = bot.y;
    const blk = MF.F.move(bot, Math.cos(a) * sp * dt, Math.sin(a) * sp * dt);
    bot.vx = (bot.x - ox) / dt; bot.vy = (bot.y - oy) / dt;
    const moved = Math.hypot(bot.x - ox, bot.y - oy);
    if (blk && moved < sp * dt * 0.4) {
      b.stuckT += dt;
      if (b.stuckT > 0.3) {
        if ((blk.type === 'wall' || blk.type === 'prop') && U.chance(0.65)) { b.breakIt = blk; b.breakT = 0; }
        else { b.detourT = U.rand(0.4, 0.9); b.detourDir = U.chance(0.5) ? 1 : -1; }
        b.stuckT = 0;
      }
    } else b.stuckT = Math.max(0, b.stuckT - dt);
    if (face) bot.aim = a;
    return false;
  }

  // Pickaxe (or edit, if it's our own wall) whatever blocks the path
  function breakBlocker(bot, dt) {
    const b = bot.brain, k = b.breakIt;
    b.breakT += dt;
    let cx, cy, alive;
    if (k.type === 'wall') {
      alive = MF.G.walls.has(k.w.key) && k.w.segs[k.i].state === 'solid';
      const r = MF.Build.segRect(k.w, k.i); cx = r.x + r.w / 2; cy = r.y + r.h / 2;
      if (alive && k.w.owner === bot.id) { MF.Build.toggleEdit(k.w, k.i); b.breakIt = null; return; }
    } else { alive = !k.p.dead; cx = k.p.x; cy = k.p.y; }
    if (!alive || b.breakT > 4) { b.breakIt = null; return; }
    bot.aim = Math.atan2(cy - bot.y, cx - bot.x);
    if (!bot.pickaxe) MF.F.selectPickaxe(bot);
    if (U.dist(bot.x, bot.y, cx, cy) > bot.r + C.PICKAXE.reach - 4) moveTo(bot, cx, cy, dt, 1, false);
    MF.Combat.swing(bot);
  }

  // ---------- think ----------
  function think(bot) {
    const b = bot.brain, t = now();
    // 1) who can I see?
    let best = null, bestScore = 1e9;
    const calm = t < b.lootUntil;   // freshly landed: loot first, fight only if pushed
    for (const o of MF.G.fighters) {
      if (!MF.F.isEnemy(bot, o) || !MF.F.isTargetable(o) || o.state === 'glide') continue;
      const d = U.dist(bot.x, bot.y, o.x, o.y);
      if (d > C.VISION) continue;
      if (calm && d > 170 && !(o === bot.lastHitBy && t - bot.lastHurtT < 3)) continue;
      if (!los(bot, o)) continue;
      let sc = d;
      if (o === b.target) sc -= 220;
      if (o === bot.lastHitBy && t - bot.lastHurtT < 3) sc -= 320;
      if (o.team === MF.G.player.team && b.huntPlayer) sc -= 120;
      if (o.down) sc += d < 260 ? 60 : 280;                     // finish close knocks, else focus standing enemies
      const m = bot.mate;
      if (m && m.alive && ((o === m.lastVictim && t - m.lastDmgT < 4) || (o === m.lastHitBy && t - m.lastHurtT < 4))) sc -= 200;  // help my teammate
      if (sc < bestScore) { bestScore = sc; best = o; }
    }
    b.los = !!best;
    if (best) {
      if (b.target !== best) { b.firstSeenT = t; }
      b.target = best; b.seenT = t; b.lastSeen = { x: best.x, y: best.y };
    } else if (bot.lastHitBy && bot.lastHitBy.alive && bot.lastHitBy.team !== bot.team && t - bot.lastHurtT < 1.5) {
      // shot by someone I can't see (behind builds): fight towards them
      const a = bot.lastHitBy;
      if (b.target !== a) b.firstSeenT = t;
      b.target = a; b.seenT = t; b.lastSeen = { x: a.x, y: a.y };
    }

    // 2) duo duties come first unless an enemy is right in my face
    if (squadThink(bot, t)) return;

    // 3) decide mode
    const inStorm = !MF.Match.inSafe(bot.x, bot.y, 0);
    const hasHeal = healSlot(bot) >= 0;
    // No gun yet? Loot first — only pickaxe-fight if someone is right on top of me
    const unarmed = weaponCount(bot) === 0;
    if (unarmed && b.target) {
      const close = U.dist(bot.x, bot.y, b.target.x, b.target.y) < 90 && bot.lastHitBy === b.target && t - bot.lastHurtT < 2;
      if (!close) { const g = findLoot(bot); if (g) { b.target = null; b.mode = 'loot'; b.goal = g; return; } }
    }
    if (b.target && b.target.alive && t - b.seenT < 0.6) b.mode = 'fight';
    else if (b.target && b.target.alive && t - b.seenT < 5 && !inStorm) b.mode = 'chase';
    else {
      b.target = null;
      const recentNoise = MF.G.noises.filter((n) => n.src !== bot && t - n.t < 4 && U.dist(n.x, n.y, bot.x, bot.y) < C.HEAR);
      if (inStorm || MF.Match.shouldRotate(bot)) { b.mode = 'rotate'; b.goal = MF.Match.safePoint(bot); }
      else if (hasHeal && MF.F.effHp(bot) < b.P.healAt) b.mode = 'heal';
      else if (tooFarFromMate(bot)) { b.mode = 'regroup'; b.goal = { x: bot.mate.x, y: bot.mate.y }; }
      else if (needsLoot(bot) && (b.goal = findLoot(bot))) b.mode = 'loot';
      else if (recentNoise.length) { b.mode = 'investigate'; const n = recentNoise[recentNoise.length - 1]; b.goal = { x: n.x + U.rand(-80, 80), y: n.y + U.rand(-80, 80) }; }
      else if (totalMats(bot) < 120 && (b.goal = findHarvest(bot))) b.mode = 'harvest';
      else {
        if (b.mode !== 'hunt' || t > b.goalT || !b.goal) { b.goal = huntGoal(bot); b.goalT = t + U.rand(6, 11); }
        b.mode = 'hunt';
      }
    }
  }

  // ---------- duo ----------
  function squadThink(bot, t) {
    const b = bot.brain, m = bot.mate;
    if (!MF.G.duo || !m) return false;
    const tg = b.target;
    const threat = tg && tg.alive && !tg.down && t - b.seenT < 0.6 && U.dist(bot.x, bot.y, tg.x, tg.y) < 460;
    if (threat) return false;
    if (m.alive && m.down) { setMode(b, 'revive'); b.goal = m; return true; }
    if (!m.alive) {
      const card = MF.Squad.cardOf(m);
      if (card) { setMode(b, 'card'); b.goal = card; return true; }
      if (bot.cards.length && MF.Squad.rebootOpen()) {
        const v = MF.Squad.nearestVan(bot);
        if (v) { setMode(b, 'reboot'); b.goal = v; return true; }
      }
    }
    return false;
  }
  function setMode(b, mode) { if (b.mode !== mode) b.boxed = false; b.mode = mode; }
  function tooFarFromMate(bot) {
    const m = bot.mate;
    if (!MF.G.duo || !m || !MF.Squad.standing(m) || m.state !== 'ground') return false;
    const leash = m.isBot ? 750 : 380;
    return U.dist(bot.x, bot.y, m.x, m.y) > leash;
  }

  function crawl(bot, dt) {
    const m = bot.mate, b = bot.brain;
    bot.pickaxe = true;
    if (!MF.Match.inSafe(bot.x, bot.y, 0)) { const g = b.goal && b.mode === 'crawl' ? b.goal : (b.goal = MF.Match.safePoint(bot)); b.mode = 'crawl'; moveTo(bot, g.x, g.y, dt); return; }
    if (MF.Squad.standing(m) && U.dist(bot.x, bot.y, m.x, m.y) > 30) moveTo(bot, m.x, m.y, dt);
    else bot.vx = bot.vy = 0;
  }

  function reviveMate(bot, dt) {
    const b = bot.brain, m = bot.mate;
    if (!m || !m.alive || !m.down) { b.think = 0; return; }
    const d = U.dist(bot.x, bot.y, m.x, m.y);
    if (d > MF.Squad.S.REVIVE_R - 14) { moveTo(bot, m.x, m.y, dt); holdGun(bot); return; }
    bot.vx = bot.vy = 0;
    // builders / careful bots wall up before reviving if someone shot at us recently
    if (!b.boxed && now() - b.seenT < 8 && totalMats(bot) >= 40 && b.pers !== 'aggressive') { boxUp(bot); b.boxed = true; }
    MF.Squad.holdInteract(bot, true, dt);
  }

  function needsLoot(bot) {
    return weaponCount(bot) < 2 || bot.slots.includes(null) || healSlot(bot) < 0;
  }
  function findLoot(bot) {
    let best = null, bd = 1100;
    for (const c of MF.G.chests) {
      if (c.opened) continue;
      const d = U.dist(bot.x, bot.y, c.x, c.y);
      if (d < bd) { bd = d; best = { x: c.x, y: c.y, chest: c }; }
    }
    const lim = Math.min(bd, 800);
    for (const l of MF.G.loot) {
      const d = U.dist(bot.x, bot.y, l.x, l.y);
      if (d < lim && d < (best ? bd * 0.7 : 1e9)) {
        if (l.inst.type === 'weapon' && weaponCount(bot) >= 3 && weaponValue(l.inst) < 9) continue;
        if (!best || d < U.dist(bot.x, bot.y, best.x, best.y)) best = { x: l.x, y: l.y, loot: l };
      }
    }
    return best;
  }
  function findHarvest(bot) {
    let best = null, bd = 600;
    MF.World.propsNear(bot.x - 600, bot.y - 600, bot.x + 600, bot.y + 600, (p) => {
      const d = U.dist(bot.x, bot.y, p.x, p.y);
      if (d < bd) { bd = d; best = { x: p.x, y: p.y, prop: p }; }
    });
    return best;
  }
  function huntGoal(bot) {
    const b = bot.brain, P = MF.G.player;
    // Your duo teammate sticks with you
    if (b.followPlayer && MF.Squad.standing(P) && P.state === 'ground') return { x: P.x + U.rand(-140, 140), y: P.y + U.rand(-140, 140) };
    // Some bots go looking for YOU, the others hunt each other
    if (b.huntPlayer && P && P.alive && P.team !== bot.team && P.state === 'ground') return { x: P.x + U.rand(-350, 350), y: P.y + U.rand(-350, 350) };
    const others = MF.G.fighters.filter((o) => MF.F.isEnemy(bot, o) && o.alive && o.state === 'ground');
    if (others.length) {
      others.sort((a, c) => U.dist(bot.x, bot.y, a.x, a.y) - U.dist(bot.x, bot.y, c.x, c.y));
      const o = others[Math.min(others.length - 1, U.randi(0, 2))];
      return { x: o.x + U.rand(-400, 400), y: o.y + U.rand(-400, 400) };
    }
    return MF.Match.safePoint(bot);
  }

  // ---------- act (every frame) ----------
  function update(bot, dt) {
    if (!bot.alive || bot.state !== 'ground') { if (bot.brain) bot.brain.peek = updatePeek(bot, dt); return; }
    const b = bot.brain;
    if (b.lootUntil == null) b.lootUntil = now() + U.rand(14, 32);
    if (bot.down) { if (b.peek) b.peek = updatePeek(bot, 99); crawl(bot, dt); return; }
    b.buildCd -= dt;
    b.think -= dt;
    if (b.think <= 0) { b.think = U.rand(0.2, 0.32); think(bot); }
    pickup(bot);
    b.peek = updatePeek(bot, dt);

    if (b.breakIt && b.mode !== 'fight') { breakBlocker(bot, dt); return; }

    switch (b.mode) {
      case 'fight': fight(bot, dt); break;
      case 'chase': {
        const g = b.lastSeen;
        if (g) moveTo(bot, g.x, g.y, dt);
        holdGun(bot);
        break;
      }
      case 'heal': healUp(bot, dt); break;
      case 'revive': reviveMate(bot, dt); break;
      case 'card': {
        const c = b.goal;
        if (!c || !MF.G.cards.includes(c)) { b.think = 0; break; }
        moveTo(bot, c.x, c.y, dt); holdGun(bot);
        break;
      }
      case 'reboot': {
        const v = b.goal;
        if (!v || !bot.cards.length) { b.think = 0; break; }
        if (U.dist(bot.x, bot.y, v.x, v.y) > MF.Squad.S.VAN_R - 24) { moveTo(bot, v.x, v.y, dt); holdGun(bot); }
        else { bot.vx = bot.vy = 0; MF.Squad.holdInteract(bot, true, dt); }
        break;
      }
      case 'loot': {
        const g = b.goal;
        if (!g || (g.chest && g.chest.opened) || (g.loot && !MF.G.loot.includes(g.loot))) { b.think = 0; break; }
        if (g.chest && U.dist(bot.x, bot.y, g.x, g.y) < 40) { bot.vx = bot.vy = 0; MF.Items.holdOpen(bot, true, dt); }
        else moveTo(bot, g.x, g.y, dt);
        break;
      }
      case 'harvest': {
        const g = b.goal;
        if (!g || g.prop.dead || totalMats(bot) > 300) { b.think = 0; break; }
        const reach = bot.r + (g.prop.r || 30) + C.PICKAXE.reach * 0.6;
        if (U.dist(bot.x, bot.y, g.x, g.y) > reach) moveTo(bot, g.x, g.y, dt);
        else { bot.aim = Math.atan2(g.y - bot.y, g.x - bot.x); if (!bot.pickaxe) MF.F.selectPickaxe(bot); MF.Combat.swing(bot); }
        break;
      }
      default: { // rotate / hunt / investigate
        const g = b.goal;
        if (!g) { b.think = 0; break; }
        if (moveTo(bot, g.x, g.y, dt)) b.goal = null;
        // grab chests on the way
        const c = MF.Items.nearestChest(bot, 44);
        if (c && b.mode !== 'rotate') MF.Items.holdOpen(bot, true, dt);
        holdGun(bot);
      }
    }
    MF.Items.update(bot, dt);
  }

  function holdGun(bot) {
    if (!bot.pickaxe && MF.F.activeWeapon(bot)) return;
    const i = chooseWeapon(bot, 400, true);
    if (i >= 0) MF.F.selectSlot(bot, i);
  }

  function healUp(bot, dt) {
    const b = bot.brain;
    const i = healSlot(bot);
    if (i < 0) { b.think = 0; return; }
    bot.vx = bot.vy = 0;
    if (b.pers === 'cautious' && !bot.use && totalMats(bot) >= 40 && b.buildCd <= 0) { boxUp(bot); b.buildCd = 5; }
    if (bot.active !== i || bot.pickaxe) MF.F.selectSlot(bot, i);
    MF.Items.useActive(bot);
  }

  function fight(bot, dt) {
    const b = bot.brain, t = b.target, P = b.P;
    if (!t || !t.alive) { b.think = 0; return; }
    const d = U.dist(bot.x, bot.y, t.x, t.y);
    const tNow = now();

    // Heal inside a box when low (and the enemy isn't in my face)
    const hs = healSlot(bot);
    if (bot.use || (hs >= 0 && MF.F.effHp(bot) < P.boxHp && d > 220 && !b.los)) { healUp(bot, dt); return; }

    // Weapon choice
    const wi = chooseWeapon(bot, d, b.los);
    if (wi >= 0) { if (bot.pickaxe || bot.active !== wi) MF.F.selectSlot(bot, wi); }
    else if (!bot.pickaxe) MF.F.selectPickaxe(bot);
    const w = MF.F.activeWeapon(bot);
    const def = w ? MF.WEAPONS[w.id] : null;

    // Aim with lead + human-ish error
    const speed = def ? def.speed : 1e9;
    const lead = (d / speed) * b.skill;
    const px = t.x + (t.vx || 0) * lead, py = t.y + (t.vy || 0) * lead;
    b.aimErrT -= dt;
    if (b.aimErrT <= 0) { b.aimErr = U.gauss() * ((1 - b.skill) * 0.85 + 0.07); b.aimErrT = U.rand(0.2, 0.4); }
    const want = Math.atan2(py - bot.y, px - bot.x) + b.aimErr;
    const turn = (5 + b.skill * 9) * dt;
    bot.aim += U.clamp(U.angleDiff(bot.aim, want), -turn, turn);

    // Shoot
    const reacted = tNow - b.firstSeenT > 0.95 - b.skill * 0.5;
    const onTarget = Math.abs(U.angleDiff(bot.aim, want)) < 0.22;
    b.burstT -= dt;
    if (b.burstT <= 0) { b.bursting = !b.bursting; b.burstT = b.bursting ? U.rand(0.5, 1.1) : U.rand(0.3, 0.7); }
    const burstOk = b.bursting || (def && def.rate > 0.5);
    if (reacted && onTarget && burstOk) {
      if (w) {
        if (w.ammo > 0 || bot.reloadT > 0) MF.Combat.fire(bot); else MF.Combat.startReload(bot);
      } else if (d < bot.r + t.r + C.PICKAXE.reach) MF.Combat.swing(bot);
    }

    // Build reactions
    const recentlyHurt = tNow - bot.lastHurtT < 0.5;
    if (b.buildCd <= 0 && pickMat(bot)) {
      if (recentlyHurt && U.chance(P.buildChance)) {
        if (MF.F.effHp(bot) < P.boxHp && hs >= 0 && totalMats(bot) >= 40) { boxUp(bot); b.buildCd = U.rand(3, 5); }
        else { wallToward(bot, t.x, t.y); b.buildCd = U.rand(0.9, 2.0) * (b.pers === 'builder' ? 0.6 : 1); }
      } else if (bot.reloadT > 0.6 && d < 600 && U.chance(0.5)) { wallToward(bot, t.x, t.y); b.buildCd = 2; }
      else if (b.pers === 'builder' && d < 550 && U.chance(0.04)) { wallToward(bot, t.x, t.y); b.buildCd = 1.5; }
    }

    // Edit-peek: my own wall blocks my shot -> open the part I need, shoot, close it again
    if (!b.peek && w && w.ammo > 0 && bot.reloadT <= 0 && U.chance(P.peek * 0.25)) {
      const hit = MF.Build.ray(bot.x, bot.y, t.x, t.y);
      if (hit && hit.w.owner === bot.id && hit.t * d < 70 && MF.Build.toggleEdit(hit.w, hit.i)) {
        b.peek = { w: hit.w, i: hit.i, t: U.rand(0.7, 1.3) };
      }
    }

    // Movement: hold preferred range and strafe
    if (b.peek && d > 150) { bot.vx = bot.vy = 0; return; }   // stay in the box while peeking
    if (b.breakIt && !b.los) { breakBlocker(bot, dt); return; }
    const pref = (def ? def.pref : 30) * P.rangeMul;
    b.strafeT -= dt;
    if (b.strafeT <= 0) { b.strafe = -b.strafe; b.strafeT = U.rand(0.45, 1.3); }
    const a = Math.atan2(t.y - bot.y, t.x - bot.x);
    const radial = U.clamp((d - pref) / 150, -1, 1);
    let mx = Math.cos(a) * radial + Math.cos(a + Math.PI / 2 * b.strafe) * 0.75;
    let my = Math.sin(a) * radial + Math.sin(a + Math.PI / 2 * b.strafe) * 0.75;
    if (!b.los) { mx = Math.cos(a); my = Math.sin(a); }   // push towards them
    const m = Math.hypot(mx, my) || 1;
    moveTo(bot, bot.x + mx / m * 60, bot.y + my / m * 60, dt, 1, false);
  }

  function updatePeek(bot, dt) {
    const p = bot.brain && bot.brain.peek;
    if (!p) return null;
    p.t -= dt;
    if (p.t > 0 && bot.alive) return p;
    if (MF.G.walls.has(p.w.key) && p.w.segs[p.i].state === 'open') MF.Build.toggleEdit(p.w, p.i);
    return null;
  }

  return { init, planDrop, planTeamDrops, onRespawn, glideDir, update };
})();
