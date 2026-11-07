// ============================================================
// fighter.js — shared logic for the player AND every bot:
// movement + collision, inventory, damage, healing.
// ============================================================
MF.F = (() => {
  const U = MF.U, C = MF.CFG;
  let nextId = 1;

  function create({ name, isBot, color }) {
    return {
      id: nextId++, name, isBot, color,
      x: 0, y: 0, r: C.PLAYER_R, vx: 0, vy: 0,
      hp: 100, shield: 0, alive: true,
      state: 'bus',               // bus | glide | ground | air | grapple | dead
      z: 0,                       // glide altitude 0..1 (render only)
      aim: 0,
      slots: [null, null, null, null, null],
      active: 0, pickaxe: true,
      mats: { wood: 0, brick: 0, metal: 0 }, buildMat: 'wood',
      fireCd: 0, reloadT: 0, use: null, swingT: 0, openProg: 0,
      air: null, grapple: null, padCd: 0,
      kills: 0, placement: 0, killedBy: null,
      lastHitBy: null, lastHurtT: -99, hurtFlash: 0,
      brain: null,
    };
  }

  // ---------- collision ----------
  function blockedAt(f, x, y) {
    const r = f.r;
    if (x < r || y < r || x > C.WORLD - r || y > C.WORLD - r) return { type: 'edge' };
    const wh = MF.Build.circleHit(x, y, r);
    if (wh) return { type: 'wall', w: wh.w, i: wh.i };
    const p = MF.World.propCircleHit(x, y, r);
    if (p) return { type: 'prop', p };
    return null;
  }

  // Axis-separated slide movement. Returns the first blocker hit (or null).
  function move(f, dx, dy) {
    // substep so fast movement never tunnels through thin walls
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / 6));
    const sx = dx / steps, sy = dy / steps;
    let blocker = null;
    for (let s = 0; s < steps; s++) {
      const bx = blockedAt(f, f.x + sx, f.y);
      if (!bx) f.x += sx; else blocker = blocker || bx;
      const by = blockedAt(f, f.x, f.y + sy);
      if (!by) f.y += sy; else blocker = blocker || by;
    }
    return blocker;
  }

  // After flying over walls, find a free spot to land
  function unstick(f) {
    if (!blockedAt(f, f.x, f.y)) return;
    for (let rad = 8; rad < 200; rad += 8) {
      for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) {
        const x = f.x + Math.cos(a) * rad, y = f.y + Math.sin(a) * rad;
        if (!blockedAt(f, x, y)) { f.x = x; f.y = y; return; }
      }
    }
  }

  function speedOf(f) {
    let s = C.RUN_SPEED;
    if (MF.World.isWater(f.x, f.y)) s *= C.WATER_SLOW;
    if (f.use) s *= C.USE_SLOW;
    return s;
  }

  // ---------- inventory ----------
  const activeSlot = (f) => (f.pickaxe ? null : f.slots[f.active]);
  function activeWeapon(f) {
    const s = activeSlot(f);
    return s && s.type === 'weapon' ? s : null;
  }

  function selectSlot(f, i) {
    if (f.active === i && !f.pickaxe) return;
    f.active = i; f.pickaxe = false;
    f.use = null; f.reloadT = 0;
    f.fireCd = Math.max(f.fireCd, 0.18);   // small swap delay
  }
  function selectPickaxe(f) { f.pickaxe = true; f.use = null; f.reloadT = 0; }

  // Try to put an item instance into the inventory. Returns true when fully taken.
  function give(f, inst) {
    if (inst.type === 'mats') {
      f.mats[inst.mat] = Math.min(C.MAT_MAX, f.mats[inst.mat] + inst.count);
      return true;
    }
    if (inst.type === 'item') {
      const def = MF.ITEMS[inst.id];
      for (const s of f.slots) {
        if (s && s.type === 'item' && s.id === inst.id && s.count < def.max) {
          const take = Math.min(def.max - s.count, inst.count);
          s.count += take; inst.count -= take;
          if (inst.count <= 0) return true;
        }
      }
    }
    const free = f.slots.indexOf(null);
    if (free < 0) return false;
    f.slots[free] = inst;
    if (f.pickaxe && inst.type === 'weapon' && !f.isBot) selectSlot(f, free);
    return true;
  }

  function dropAll(f) {
    for (let i = 0; i < 5; i++) if (f.slots[i]) { MF.World.dropLoot(f.x, f.y, f.slots[i]); f.slots[i] = null; }
    for (const m of MF.MAT_ORDER) {
      if (f.mats[m] > 0) MF.World.dropLoot(f.x, f.y, { type: 'mats', mat: m, count: f.mats[m] });
      f.mats[m] = 0;
    }
  }

  // ---------- damage ----------
  function hurt(f, dmg, attacker, source) {
    if (!f.alive || f.state === 'bus') return;
    dmg = Math.max(0, dmg);
    // Bots hit each other a bit softer so the lobby doesn't empty before you get to fight
    if (attacker && attacker.isBot && f.isBot) dmg *= 0.6;
    let toShield = Math.min(f.shield, dmg);
    f.shield -= toShield;
    const toHp = dmg - toShield;
    f.hp -= toHp;
    f.lastHurtT = MF.G.time; f.hurtFlash = 0.15;
    if (attacker && attacker !== f) f.lastHitBy = attacker;
    if (MF.Render) {
      const watched = MF.Match.camTarget();
      if (attacker === watched || f === watched) {
        if (toShield > 0) MF.Render.dmgNum(f.x, f.y - 20, toShield, '#59c3ff');
        if (toHp > 0) MF.Render.dmgNum(f.x + 10, f.y - 26, toHp, '#ffffff');
      }
    }
    if (f.hp <= 0) { f.hp = 0; MF.Match.kill(f, attacker, source); }
  }

  function heal(f, amount, cap) { if (f.hp < cap) f.hp = Math.min(cap, f.hp + amount); }
  function addShield(f, amount, cap) { if (f.shield < cap) f.shield = Math.min(cap, f.shield + amount); }

  // ---------- per-frame timers / physics ----------
  function update(f, dt) {
    if (!f.alive) return;
    f.fireCd = Math.max(0, f.fireCd - dt);
    f.swingT = Math.max(0, f.swingT - dt);
    f.hurtFlash = Math.max(0, f.hurtFlash - dt);
    f.padCd = Math.max(0, f.padCd - dt);

    // reload
    if (f.reloadT > 0) {
      f.reloadT -= dt;
      const w = activeWeapon(f);
      if (!w) f.reloadT = 0;
      else if (f.reloadT <= 0) { w.ammo = MF.WEAPONS[w.id].mag; f.reloadT = 0; }
    }

    // flying from launch pad / shockwave: ignore walls, land when done
    if (f.state === 'air') {
      const a = f.air;
      a.t += dt;
      f.x = U.clamp(f.x + a.vx * dt, f.r, C.WORLD - f.r);
      f.y = U.clamp(f.y + a.vy * dt, f.r, C.WORLD - f.r);
      f.z = Math.sin(Math.min(1, a.t / a.dur) * Math.PI) * a.height;
      if (a.t >= a.dur) { f.state = 'ground'; f.z = 0; f.air = null; unstick(f); }
    }
    if (f.state === 'grapple') {
      const g = f.grapple;
      const d = U.dist(f.x, f.y, g.tx, g.ty);
      const step = 980 * dt;
      if (d <= step || (g.t += dt) > 1.2) { f.x = g.tx; f.y = g.ty; f.state = 'ground'; f.grapple = null; unstick(f); }
      else { f.x += (g.tx - f.x) / d * step; f.y += (g.ty - f.y) / d * step; }
    }
  }

  function launch(f, vx, vy, dur, height) {
    if (!f.alive || f.state === 'bus' || f.state === 'glide') return;
    f.state = 'air'; f.use = null;
    f.air = { vx, vy, t: 0, dur, height };
  }

  const isTargetable = (f) => f.alive && f.state !== 'bus';
  const effHp = (f) => f.hp + f.shield;

  return { create, blockedAt, move, unstick, speedOf, activeSlot, activeWeapon, selectSlot, selectPickaxe,
           give, dropAll, hurt, heal, addShield, update, launch, isTargetable, effHp,
           reset() { nextId = 1; } };
})();
