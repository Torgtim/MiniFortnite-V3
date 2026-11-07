// ============================================================
// items.js — consumables, mobility items, launch pads,
// chests (hold to open) and picking up loot
// ============================================================
MF.Items = (() => {
  const U = MF.U;
  const CHEST_TIME = 1.1;     // seconds to hold
  const PICK_R = 30;

  // Called while the "fire" input is held and the active slot is an item.
  function useActive(f) {
    const s = MF.F.activeSlot(f);
    if (!s || s.type !== 'item' || f.state !== 'ground' || f.fireCd > 0) return false;
    const def = MF.ITEMS[s.id];

    if (def.kind === 'heal' || def.kind === 'shield') {
      if (f.use) return true;                       // already in progress
      if (def.kind === 'heal' && f.hp >= def.cap) return false;
      if (def.kind === 'shield' && f.shield >= def.cap) return false;
      f.use = { slot: f.active, id: s.id, t: 0, dur: def.time };
      return true;
    }
    if (def.kind === 'throw' || s.id === 'shockwave') {
      MF.Combat.throwIt(f, s.id);
      consume(f, f.active); f.fireCd = 0.6;
      return true;
    }
    if (s.id === 'launchpad') {
      const x = f.x + Math.cos(f.aim) * 46, y = f.y + Math.sin(f.aim) * 46;
      MF.G.pads.push({ x, y, r: 26, t: 0, owner: f });
      consume(f, f.active); f.fireCd = 0.6;
      return true;
    }
    if (s.id === 'grappler') {
      const range = def.range;
      const ex = f.x + Math.cos(f.aim) * range, ey = f.y + Math.sin(f.aim) * range;
      const hit = MF.Combat.traceHit(f.x, f.y, ex, ey, f);
      const t = hit ? hit.t : 1;
      const back = hit ? (f.r + 8) / range : 0;
      const tt = Math.max(0, t - back);
      f.state = 'grapple'; f.use = null;
      f.grapple = { tx: f.x + (ex - f.x) * tt, ty: f.y + (ey - f.y) * tt, t: 0, sx: f.x, sy: f.y };
      consume(f, f.active); f.fireCd = 0.5;
      return true;
    }
    return false;
  }

  function consume(f, slot) {
    const s = f.slots[slot];
    if (!s) return;
    s.count--;
    if (s.count <= 0) f.slots[slot] = null;
  }

  // Progress heals / shields; cancel if slot switched or item gone
  function update(f, dt) {
    const u = f.use;
    if (!u) return;
    const s = f.slots[u.slot];
    if (f.pickaxe || f.active !== u.slot || !s || s.id !== u.id || f.state !== 'ground') { f.use = null; return; }
    u.t += dt;
    if (u.t < u.dur) return;
    const def = MF.ITEMS[u.id];
    if (def.kind === 'heal') MF.F.heal(f, def.heal, def.cap);
    else MF.F.addShield(f, def.shield, def.cap);
    consume(f, u.slot);
    f.use = null;
    MF.Render && MF.Render.burst(f.x, f.y, def.kind === 'heal' ? '#7dff8a' : '#59c3ff', 12, 120);
  }

  // Launch pads: step on one and you fly
  function updatePads(dt) {
    for (const p of MF.G.pads) p.t += dt;
    for (const f of MF.G.fighters) {
      if (!f.alive || f.state !== 'ground' || f.padCd > 0) continue;
      for (const p of MF.G.pads) {
        if (U.dist(f.x, f.y, p.x, p.y) > p.r + f.r * 0.5) continue;
        let a = Math.hypot(f.vx, f.vy) > 20 ? Math.atan2(f.vy, f.vx) : f.aim;
        MF.F.launch(f, Math.cos(a) * 430, Math.sin(a) * 430, 2.4, 120);
        f.padCd = 1;
        MF.Render && MF.Render.burst(p.x, p.y, '#38e0ff', 16, 220);
        break;
      }
    }
  }

  // ---------- chests ----------
  function nearestChest(f, maxD = 48) {
    let best = null, bd = maxD;
    for (const c of MF.G.chests) {
      if (c.opened) continue;
      const d = U.dist(f.x, f.y, c.x, c.y);
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  }

  // Call every frame with whether "interact" is held
  function holdOpen(f, holding, dt) {
    const c = nearestChest(f);
    if (!c || !holding || f.state !== 'ground') { f.openProg = 0; f.openChest = null; return null; }
    if (f.openChest !== c) { f.openChest = c; f.openProg = 0; }
    f.openProg += dt;
    if (f.openProg >= CHEST_TIME) {
      MF.World.openChest(c);
      f.openProg = 0; f.openChest = null;
    }
    return c;
  }

  // ---------- loot ----------
  function nearestLoot(f, maxD = PICK_R + f.r) {
    let best = null, bd = maxD;
    for (const l of MF.G.loot) {
      const d = U.dist(f.x, f.y, l.x, l.y);
      if (d < bd) { bd = d; best = l; }
    }
    return best;
  }

  function removeLoot(l) {
    const i = MF.G.loot.indexOf(l);
    if (i >= 0) MF.G.loot.splice(i, 1);
  }

  // Walk over loot: take it if there is room. Returns the loot we could NOT take (for the swap button).
  function autoPickup(f) {
    if (f.state !== 'ground') return null;
    let blocked = null;
    for (const l of [...MF.G.loot]) {
      if (U.dist(f.x, f.y, l.x, l.y) > PICK_R + f.r) continue;
      if (MF.F.give(f, l.inst)) { removeLoot(l); MF.Render && MF.Render.pickupText(f, l.inst); }
      else if (!blocked) blocked = l;
    }
    return blocked;
  }

  // Swap the active slot with a loot item on the ground
  function swap(f, l) {
    const slot = f.pickaxe ? f.slots.indexOf(null) : f.active;
    const idx = slot < 0 ? f.active : slot;
    const old = f.slots[idx];
    if (old) MF.World.dropLoot(f.x, f.y, old);
    f.slots[idx] = l.inst;
    removeLoot(l);
    MF.F.selectSlot(f, idx);
    MF.Render && MF.Render.pickupText(f, l.inst);
  }

  const CHEST_TIME_S = CHEST_TIME;
  return { useActive, update, updatePads, nearestChest, holdOpen, nearestLoot, autoPickup, swap, removeLoot, CHEST_TIME: CHEST_TIME_S };
})();
