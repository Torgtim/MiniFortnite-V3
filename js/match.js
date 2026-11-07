// ============================================================
// match.js — one battle royale round: battle bus, gliding,
// storm circles, eliminations, victory, spectating.
// ============================================================
MF.Match = (() => {
  const U = MF.U, C = MF.CFG;

  function newState() {
    MF.G = {
      time: 0, phase: 'menu',
      fighters: [], player: null,
      walls: new Map(), bullets: [], throwables: [], pads: [], noises: [],
      loot: [], chests: [], props: [], propGrid: new Map(), pois: [], houses: [], tiles: null,
      bus: null, storm: null, feed: [], winner: null,
      spectating: null, mode: 'fight',          // fight | build | edit (player)
      ghost: null, buildSide: 0,
    };
  }
  newState();

  function start() {
    newState();
    MF.Build.reset(); MF.F.reset();
    MF.World.generate((Math.random() * 1e9) | 0);
    const G = MF.G;

    // Fighters
    const names = [...MF.BOT_NAMES].sort(() => Math.random() - 0.5);
    const player = MF.F.create({ name: 'YOU', isBot: false, color: '#ffe066' });
    G.player = player;
    G.fighters.push(player);
    for (let i = 0; i < C.BOTS; i++) {
      const bot = MF.F.create({ name: names[i % names.length], isBot: true, color: MF.SKIN_COLORS[i % MF.SKIN_COLORS.length] });
      MF.AI.init(bot);
      G.fighters.push(bot);
    }

    // Battle bus: across the island through (roughly) the middle
    const a = U.rand(Math.PI * 2), off = U.rand(-700, 700);
    const cx = C.WORLD / 2 + Math.cos(a + Math.PI / 2) * off, cy = C.WORLD / 2 + Math.sin(a + Math.PI / 2) * off;
    const L = C.WORLD * 0.62;
    G.bus = { x0: cx - Math.cos(a) * L, y0: cy - Math.sin(a) * L, x1: cx + Math.cos(a) * L, y1: cy + Math.sin(a) * L,
              t: 0, x: 0, y: 0, angle: a, len: L * 2, done: false };
    for (const f of G.fighters) { if (f.isBot) MF.AI.planDrop(f, G.bus); }

    // Storm starts big; first circle is chosen right away
    G.storm = { phase: -1, timer: 0, shrinking: false,
                cx: C.WORLD / 2, cy: C.WORLD / 2, r: C.WORLD,
                fromX: 0, fromY: 0, fromR: 0, nx: C.WORLD / 2, ny: C.WORLD / 2, nr: C.WORLD, dps: 1 };
    nextCircle();
    G.storm.timer = MF.STORM[0].wait + 20;     // extra time for the bus ride
    G.phase = 'bus';
    G.mode = 'fight';
    MF.UI && MF.UI.onMatchStart();
  }

  // ---------- storm ----------
  function nextCircle() {
    const s = MF.G.storm;
    s.phase++;
    const def = MF.STORM[Math.min(s.phase, MF.STORM.length - 1)];
    s.fromX = s.cx; s.fromY = s.cy; s.fromR = s.r;
    const room = Math.max(0, s.r - def.r);
    for (let i = 0; i < 30; i++) {
      const a = U.rand(Math.PI * 2), d = U.rand(room * 0.85);
      const x = U.clamp(s.cx + Math.cos(a) * d, 500, C.WORLD - 500), y = U.clamp(s.cy + Math.sin(a) * d, 500, C.WORLD - 500);
      s.nx = x; s.ny = y;
      if (MF.World.isLand(x, y)) break;
    }
    s.nr = def.r; s.dps = def.dps; s.timer = def.wait; s.shrinking = false;
  }

  function updateStorm(dt) {
    const s = MF.G.storm;
    if (s.phase < MF.STORM.length) updateCircle(s, dt);
    // damage (ticks once per second)
    s.tick = (s.tick || 0) + dt;
    if (s.tick >= 1) {
      s.tick -= 1;
      for (const f of MF.G.fighters) {
        if (f.alive && f.state !== 'bus' && f.state !== 'glide' && !inSafe(f.x, f.y, 0)) MF.F.hurt(f, s.dps, null, 'Storm');
      }
    }
  }

  function updateCircle(s, dt) {
    s.timer -= dt;
    const def = MF.STORM[s.phase];
    if (!s.shrinking && s.timer <= 0) {
      s.shrinking = true; s.timer = def.shrink;
      MF.UI && MF.UI.banner('THE STORM IS SHRINKING!', '#c77dff');
    } else if (s.shrinking) {
      const k = 1 - Math.max(0, s.timer) / def.shrink;
      s.cx = U.lerp(s.fromX, s.nx, k); s.cy = U.lerp(s.fromY, s.ny, k); s.r = U.lerp(s.fromR, s.nr, k);
      if (s.timer <= 0) {
        if (s.phase < MF.STORM.length - 1) nextCircle();
        else { s.phase = MF.STORM.length; s.r = 0; }
      }
    }
  }

  function inSafe(x, y, pad = 0) {
    const s = MF.G.storm;
    return U.dist(x, y, s.cx, s.cy) <= s.r - pad;
  }
  function shouldRotate(f) {
    const s = MF.G.storm;
    const outsideNext = U.dist(f.x, f.y, s.nx, s.ny) > s.nr * 0.85;
    return outsideNext && (s.shrinking || s.timer < 25);
  }
  function safePoint(f) {
    const s = MF.G.storm;
    const r = Math.max(10, s.nr * 0.6);
    const a = U.rand(Math.PI * 2), d = U.rand(r);
    return { x: s.nx + Math.cos(a) * d, y: s.ny + Math.sin(a) * d };
  }

  // ---------- bus + glide ----------
  function updateBus(dt) {
    const b = MF.G.bus;
    if (b.done) return;
    b.t = Math.min(1, b.t + (C.BUS_SPEED * dt) / b.len);
    b.x = U.lerp(b.x0, b.x1, b.t); b.y = U.lerp(b.y0, b.y1, b.t);
    for (const f of MF.G.fighters) {
      if (f.state !== 'bus') continue;
      f.x = U.clamp(b.x, 20, C.WORLD - 20); f.y = U.clamp(b.y, 20, C.WORLD - 20);
      if (f.isBot && b.t >= f.brain.jumpAt) jump(f);
    }
    if (b.t >= 1) {
      for (const f of MF.G.fighters) if (f.state === 'bus') jump(f);   // everyone out!
      b.done = true;
    }
  }

  function jump(f) {
    if (f.state !== 'bus') return;
    f.state = 'glide'; f.z = 1; f.glideT = 0;
    f.x = U.clamp(f.x, 60, C.WORLD - 60); f.y = U.clamp(f.y, 60, C.WORLD - 60);
    if (!f.isBot) MF.UI && MF.UI.onJump();
  }

  function updateGlide(f, dt, dir) {
    f.glideT += dt;
    f.z = Math.max(0, 1 - f.glideT / C.GLIDE_TIME);
    f.x = U.clamp(f.x + dir.x * C.GLIDE_SPEED * dt, 30, C.WORLD - 30);
    f.y = U.clamp(f.y + dir.y * C.GLIDE_SPEED * dt, 30, C.WORLD - 30);
    if (Math.hypot(dir.x, dir.y) > 0.1) f.aim = Math.atan2(dir.y, dir.x);
    if (f.z <= 0) { f.state = 'ground'; f.z = 0; MF.F.unstick(f); if (!f.isBot) MF.UI && MF.UI.onLand(); }
  }

  // ---------- eliminations ----------
  function kill(victim, killer, source) {
    if (!victim.alive) return;
    const G = MF.G;
    victim.alive = false; victim.state = 'dead';
    victim.use = null;
    victim.placement = aliveCount() + 1;
    victim.killedBy = killer && killer !== victim ? killer : null;
    if (victim.killedBy) victim.killedBy.kills++;
    MF.F.dropAll(victim);
    MF.Render && MF.Render.burst(victim.x, victim.y, victim.color, 26, 260);
    const by = victim.killedBy ? victim.killedBy.name : (source === 'Storm' ? 'The Storm' : 'Fall');
    G.feed.unshift({ t: G.time, text: victim.killedBy ? `${by} ⟶ ${victim.name}` : `${victim.name} was eliminated by ${by}`,
                     you: victim === G.player || victim.killedBy === G.player, weapon: source });
    G.feed.length = Math.min(G.feed.length, 6);

    if (victim === G.player) MF.UI && MF.UI.onPlayerDeath(victim);
    else if (victim.killedBy === G.player) MF.UI && MF.UI.banner(`ELIMINATED ${victim.name.toUpperCase()}`, '#ffe23d');
    if (G.spectating === victim) G.spectating = pickSpectate(victim.killedBy);

    if (aliveCount() <= 1 && !G.winner) {
      G.winner = G.fighters.find((f) => f.alive) || victim;
      G.winner.placement = 1;
      MF.UI && MF.UI.onWinner(G.winner);
    }
  }

  const aliveCount = () => MF.G.fighters.reduce((n, f) => n + (f.alive ? 1 : 0), 0);

  // ---------- spectating ----------
  function pickSpectate(pref) {
    if (pref && pref.alive) return pref;
    const alive = MF.G.fighters.filter((f) => f.alive);
    return alive.length ? U.pick(alive) : null;
  }
  function spectate(pref) { MF.G.spectating = pickSpectate(pref); }
  function cycleSpectate(dir) {
    const alive = MF.G.fighters.filter((f) => f.alive && f.isBot);
    if (!alive.length) return;
    let i = alive.indexOf(MF.G.spectating);
    i = (i + dir + alive.length) % alive.length;
    MF.G.spectating = alive[i];
  }
  // Whose eyes is the camera looking through?
  function camTarget() {
    const G = MF.G;
    if (G.spectating) return G.spectating;
    return G.player;
  }

  // ---------- main update ----------
  function update(dt) {
    const G = MF.G;
    if (G.phase === 'menu') return;
    G.time += dt;
    updateBus(dt);
    if (G.bus.done || G.bus.t > 0.3) updateStorm(dt);

    // player input -> movement / actions
    MF.Input && MF.Input.applyToPlayer(G.player, dt);

    for (const f of G.fighters) {
      if (!f.alive) continue;
      if (f.state === 'glide') {
        if (f.isBot) updateGlide(f, dt, MF.AI.glideDir(f));
        else updateGlide(f, dt, MF.Input.moveVector());
        continue;
      }
      if (f.isBot) MF.AI.update(f, dt);
      MF.F.update(f, dt);
    }
    MF.Build.update(dt);
    MF.Combat.updateBullets(dt);
    MF.Combat.updateThrowables(dt);
    MF.Items.updatePads(dt);
    if (G.noises.length > 40) G.noises = G.noises.filter((n) => G.time - n.t < 5);
  }

  return { start, update, kill, inSafe, shouldRotate, safePoint, jump, aliveCount, spectate, cycleSpectate, camTarget, newState };
})();
