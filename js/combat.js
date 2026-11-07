// ============================================================
// combat.js — guns, bullets, rockets, explosions, pickaxe,
// throwables (grenade / port-a-fort / shockwave)
// ============================================================
MF.Combat = (() => {
  const U = MF.U, C = MF.CFG;

  // ---------- guns ----------
  function startReload(f) {
    const w = MF.F.activeWeapon(f);
    if (!w || f.reloadT > 0) return;
    if (w.ammo >= MF.WEAPONS[w.id].mag) return;
    f.reloadT = MF.WEAPONS[w.id].reload;
  }

  // Returns true when a shot went out
  function fire(f) {
    const w = MF.F.activeWeapon(f);
    if (!w || f.fireCd > 0 || f.reloadT > 0 || f.state !== 'ground') return false;
    if (w.ammo <= 0) { startReload(f); return false; }
    const def = MF.WEAPONS[w.id];
    const mult = MF.RARITIES[w.rarity].mult;
    const mx = f.x + Math.cos(f.aim) * (f.r + def.len * 0.6);
    const my = f.y + Math.sin(f.aim) * (f.r + def.len * 0.6);
    // If the muzzle pokes through a wall, start bullets at the body so they hit that wall
    const blocked = MF.Build.ray(f.x, f.y, mx, my);
    const sx = blocked ? f.x : mx, sy = blocked ? f.y : my;
    for (let p = 0; p < def.pellets; p++) {
      const a = f.aim + U.gauss() * def.spread;
      MF.G.bullets.push({
        x: sx, y: sy, px: sx, py: sy,
        vx: Math.cos(a) * def.speed, vy: Math.sin(a) * def.speed,
        life: def.range / def.speed, dmg: def.dmg * mult, struct: def.struct,
        owner: f, source: def.name, rocket: !!def.rocket, splash: def.splash, structDmg: def.structDmg,
        color: MF.RARITIES[w.rarity].color,
      });
    }
    w.ammo--;
    f.fireCd = def.rate;
    if (w.ammo <= 0) startReload(f);
    MF.G.noises.push({ x: f.x, y: f.y, t: MF.G.time, src: f });
    MF.Render && MF.Render.flash(mx, my, f.aim);
    return true;
  }

  function updateBullets(dt) {
    const out = [];
    for (const b of MF.G.bullets) {
      b.life -= dt;
      const nx = b.x + b.vx * dt, ny = b.y + b.vy * dt;
      const hit = traceHit(b.x, b.y, nx, ny, b.owner);
      b.px = b.x; b.py = b.y;
      if (hit) {
        const hx = b.x + (nx - b.x) * hit.t, hy = b.y + (ny - b.y) * hit.t;
        if (b.rocket) explode(hx, hy, b.splash, b.dmg, b.structDmg, b.owner, b.source);
        else applyHit(hit, b.dmg, b.struct, b.owner, b.source, hx, hy);
        continue;
      }
      b.x = nx; b.y = ny;
      if (b.life <= 0) { if (b.rocket) explode(b.x, b.y, b.splash, b.dmg, b.structDmg, b.owner, b.source); continue; }
      out.push(b);
    }
    MF.G.bullets = out;
  }

  // Nearest thing a segment hits: wall, prop or fighter
  function traceHit(x0, y0, x1, y1, owner) {
    let best = null;
    const w = MF.Build.ray(x0, y0, x1, y1);
    if (w) best = { kind: 'wall', t: w.t, w: w.w, i: w.i };
    const p = MF.World.propRay(x0, y0, x1, y1);
    if (p && (!best || p.t < best.t)) best = { kind: 'prop', t: p.t, p: p.p };
    for (const f of MF.G.fighters) {
      if (f === owner || !MF.F.isTargetable(f)) continue;
      if (f.state === 'glide' && f.z > 0.25) continue;   // too high up in the sky
      const t = U.segCircle(x0, y0, x1, y1, f.x, f.y, f.r);
      if (t >= 0 && (!best || t < best.t)) best = { kind: 'fighter', t, f };
    }
    return best;
  }

  function applyHit(hit, dmg, struct, owner, source, hx, hy) {
    if (hit.kind === 'fighter') {
      MF.F.hurt(hit.f, dmg, owner, source);
      MF.Render && MF.Render.burst(hx, hy, '#ff4d4d', 4, 90);
      if (owner && !owner.isBot) MF.Render && MF.Render.hitmarker();
    } else if (hit.kind === 'wall') {
      MF.Build.damage(hit.w, hit.i, dmg * struct);
      MF.Render && MF.Render.burst(hx, hy, MF.MATERIALS[hit.w.mat].light, 3, 80);
    } else if (hit.kind === 'prop') {
      damageProp(hit.p, dmg * 0.6, null);
      MF.Render && MF.Render.burst(hx, hy, '#d9c9a3', 3, 80);
    }
  }

  function damageProp(p, dmg, harvester) {
    if (p.dead) return;
    p.hp -= dmg; p.hitT = MF.G.time;
    if (harvester) harvester.mats[p.mat] = Math.min(C.MAT_MAX, harvester.mats[p.mat] + p.yield);
    if (p.hp <= 0) {
      MF.World.removeProp(p);
      MF.Render && MF.Render.burst(p.x, p.y, MF.MATERIALS[p.mat].color, 16, 200);
    }
  }

  function explode(x, y, radius, dmg, structDmg, owner, source) {
    for (const f of MF.G.fighters) {
      if (!MF.F.isTargetable(f)) continue;
      const d = U.dist(x, y, f.x, f.y);
      if (d < radius + f.r) MF.F.hurt(f, dmg * (1 - 0.5 * Math.min(1, d / radius)), owner, source);
    }
    MF.Build.forSegsInBox(x - radius, y - radius, x + radius, y + radius, (w, i, r) => {
      const d = U.dist(x, y, r.x + r.w / 2, r.y + r.h / 2);
      if (d < radius) MF.Build.damage(w, i, structDmg * (1 - 0.4 * d / radius));
    });
    const hitProps = [];
    MF.World.propsNear(x - radius, y - radius, x + radius, y + radius, (p) => {
      if (U.dist(x, y, p.x, p.y) < radius) hitProps.push(p);
    });
    for (const p of hitProps) damageProp(p, structDmg * 0.6, null);
    MF.G.noises.push({ x, y, t: MF.G.time, src: owner });
    MF.Render && MF.Render.explosion(x, y, radius);
  }

  // ---------- pickaxe ----------
  function swing(f) {
    if (f.fireCd > 0 || f.state !== 'ground') return false;
    const P = C.PICKAXE;
    f.fireCd = P.rate; f.swingT = 0.22;
    // 1) fighters in a short arc in front
    let target = null, bestD = 1e9;
    for (const o of MF.G.fighters) {
      if (o === f || !MF.F.isTargetable(o) || o.state !== 'ground') continue;
      const d = U.dist(f.x, f.y, o.x, o.y);
      if (d > f.r + P.reach + o.r) continue;
      const a = Math.atan2(o.y - f.y, o.x - f.x);
      if (Math.abs(U.angleDiff(f.aim, a)) > 0.85) continue;
      if (d < bestD) { bestD = d; target = o; }
    }
    if (target && !MF.Build.ray(f.x, f.y, target.x, target.y)) {
      MF.F.hurt(target, P.dmg, f, 'Pickaxe');
      if (!f.isBot) MF.Render && MF.Render.hitmarker();
      return true;
    }
    // 2) walls / props: harvest materials
    const ex = f.x + Math.cos(f.aim) * (f.r + P.reach), ey = f.y + Math.sin(f.aim) * (f.r + P.reach);
    const w = MF.Build.ray(f.x, f.y, ex, ey);
    const p = MF.World.propRay(f.x, f.y, ex, ey);
    if (w && (!p || w.t <= p.t)) {
      const mat = w.w.mat;
      MF.Build.damage(w.w, w.i, P.structDmg);
      f.mats[mat] = Math.min(C.MAT_MAX, f.mats[mat] + 5);
      MF.Render && MF.Render.burst(f.x + (ex - f.x) * w.t, f.y + (ey - f.y) * w.t, MF.MATERIALS[mat].color, 6, 120);
      return true;
    }
    if (p) {
      damageProp(p.p, P.structDmg, f);
      MF.Render && MF.Render.burst(f.x + (ex - f.x) * p.t, f.y + (ey - f.y) * p.t, MF.MATERIALS[p.p.mat].color, 6, 120);
      return true;
    }
    return false;
  }

  // ---------- throwables ----------
  function throwIt(f, type, power = 640) {
    MF.G.throwables.push({
      type, owner: f, x: f.x + Math.cos(f.aim) * (f.r + 6), y: f.y + Math.sin(f.aim) * (f.r + 6),
      vx: Math.cos(f.aim) * power, vy: Math.sin(f.aim) * power,
      fuse: MF.ITEMS[type].fuse, spin: 0,
    });
  }

  function updateThrowables(dt) {
    const keep = [];
    for (const t of MF.G.throwables) {
      t.fuse -= dt; t.spin += dt * 10;
      const fr = Math.pow(0.08, dt);
      t.vx *= fr; t.vy *= fr;
      const nx = t.x + t.vx * dt, ny = t.y + t.vy * dt;
      if (MF.Build.circleHit(nx, t.y, 6) || MF.World.propCircleHit(nx, t.y, 6)) t.vx *= -0.35; else t.x = nx;
      if (MF.Build.circleHit(t.x, ny, 6) || MF.World.propCircleHit(t.x, ny, 6)) t.vy *= -0.35; else t.y = ny;
      if (t.fuse > 0) { keep.push(t); continue; }
      detonate(t);
    }
    MF.G.throwables = keep;
  }

  function detonate(t) {
    const def = MF.ITEMS[t.type];
    if (t.type === 'grenade') {
      explode(t.x, t.y, def.radius, def.dmg, def.structDmg, t.owner, 'Grenade');
    } else if (t.type === 'portafort') {
      MF.Build.boxUp(t.x, t.y, 'metal', t.owner.id, { buildTime: 0.35 });
      MF.Render && MF.Render.burst(t.x, t.y, '#dbe8f3', 20, 220);
    } else if (t.type === 'shockwave') {
      for (const f of MF.G.fighters) {
        if (!f.alive || (f.state !== 'ground' && f.state !== 'air')) continue;
        const d = U.dist(t.x, t.y, f.x, f.y);
        if (d > def.radius) continue;
        const a = d < 4 ? (f.aim || 0) : Math.atan2(f.y - t.y, f.x - t.x);
        MF.F.launch(f, Math.cos(a) * 560, Math.sin(a) * 560, 1.35, 70);
      }
      MF.Render && MF.Render.shockwave(t.x, t.y, def.radius);
    }
  }

  return { fire, startReload, updateBullets, traceHit, explode, swing, throwIt, updateThrowables, damageProp };
})();
