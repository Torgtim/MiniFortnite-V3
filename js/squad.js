// ============================================================
// squad.js — DUO mode: knocked (DBNO), reviving, reboot cards
// and Reboot Vans. Works for the player and every bot team.
//
//  • Hit 0 HP while your teammate is still standing → KNOCKED.
//    You crawl slowly, can't shoot, and bleed out over time.
//  • A teammate holds next to you for REVIVE_TIME → back up at 30 HP.
//  • Eliminated → you drop a REBOOT CARD. Your teammate picks it
//    up and holds it at a Reboot Van → you drop back in.
//  • When the last standing member of a team goes down, the whole
//    team is eliminated (just like Fortnite).
// ============================================================
MF.Squad = (() => {
  const U = MF.U, C = MF.CFG;
  const S = {
    REVIVE_TIME: 5, REVIVE_R: 58,
    DOWN_HP: 100, BLEED: 3,              // knocked HP and HP lost per second
    DOWN_SPEED: 0.32,                    // crawl speed multiplier
    REVIVE_HP: 30,
    CARD_LIFE: 90,                       // seconds a card lies on the ground
    REBOOT_TIME: 4, VAN_R: 74, VAN_CD: 60,
    REBOOT_LAST_PHASE: 3,                // vans work during circles 1-4, then shut off
    RESPAWN_GLIDE: 3,                    // seconds of gliding after a reboot
  };

  const G = () => MF.G;
  const duo = () => !!MF.G.duo;
  const standing = (f) => f && f.alive && !f.down;

  // ---------- setup ----------
  function setupVans() {
    const g = G(); g.vans = []; g.cards = [];
    if (!duo()) return;
    const pois = [...g.pois].sort(() => Math.random() - 0.5);
    for (const p of pois) {
      if (g.vans.length >= 6) break;
      for (let i = 0; i < 40; i++) {
        const a = U.rand(Math.PI * 2), d = U.rand(300, 520);
        const x = p.x + Math.cos(a) * d, y = p.y + Math.sin(a) * d;
        if (!MF.World.isLand(x, y) || MF.World.isWater(x, y) || MF.Build.circleHit(x, y, 60)) continue;
        if (g.vans.some((v) => U.dist(v.x, v.y, x, y) < 700)) continue;
        // clear trees / rocks around the van so it's easy to reach
        const kill = [];
        MF.World.propsNear(x - 80, y - 80, x + 80, y + 80, (q) => { if (U.dist(x, y, q.x, q.y) < 80) kill.push(q); });
        kill.forEach((q) => MF.World.removeProp(q));
        g.vans.push({ x, y, cd: 0, prog: 0, by: null, seen: -9, poi: p.name });
        break;
      }
    }
  }

  // Pair up fighters that share a team
  function linkTeams() {
    const byTeam = new Map();
    for (const f of G().fighters) {
      if (!byTeam.has(f.team)) byTeam.set(f.team, []);
      byTeam.get(f.team).push(f);
    }
    for (const list of byTeam.values()) {
      if (list.length === 2) { list[0].mate = list[1]; list[1].mate = list[0]; }
    }
  }

  // ---------- knocked ----------
  function canKnock(f) {
    return duo() && standing(f.mate) && f.mate.state !== 'bus';
  }

  function knock(f, attacker, source) {
    f.down = true; f.downHp = S.DOWN_HP;
    f.hp = 0; f.shield = 0;
    f.use = null; f.reloadT = 0; f.openProg = 0;
    f.knockedBy = attacker && attacker !== f ? attacker : null;
    f.reviveProg = 0;
    const g = G();
    const by = f.knockedBy ? f.knockedBy.name : 'The Storm';
    g.feed.unshift({ t: g.time, text: `${by} knocked ${f.name}`, you: f === g.player || f.knockedBy === g.player || f.team === g.player.team, weapon: source, knock: true });
    g.feed.length = Math.min(g.feed.length, 6);
    MF.Render && MF.Render.burst(f.x, f.y, '#ff4d4d', 14, 180);
    if (f === g.player) MF.Input.setMode('fight');            // the KNOCKED panel explains the rest
    else if (f.mate === g.player) MF.UI && MF.UI.banner('TEAMMATE KNOCKED — REVIVE!', '#ff6b81');
    else if (f.knockedBy === g.player) MF.UI && MF.UI.banner(`KNOCKED ${f.name.toUpperCase()}`, '#ffb21e');
  }

  function revive(f) {
    const g = G(), by = f.reviveBy;
    f.down = false; f.hp = S.REVIVE_HP; f.shield = 0; f.reviveProg = 0; f.knockedBy = null; f.downHp = 0;
    g.feed.unshift({ t: g.time, text: `${by ? by.name : '?'} revived ${f.name}`, you: f.team === g.player.team, weapon: '' });
    g.feed.length = Math.min(g.feed.length, 6);
    MF.Render && MF.Render.burst(f.x, f.y, '#59c3ff', 20, 200);
    if (f === g.player) MF.UI && MF.UI.banner('REVIVED!', '#59c3ff');
    else if (by === g.player) MF.UI && MF.UI.banner(`REVIVED ${f.name.toUpperCase()}`, '#59c3ff');
  }

  // Called by Match.kill after a fighter is marked dead
  function onEliminated(f) {
    const g = G();
    if (!duo()) return;
    f.down = false;
    const carried = f.cards; f.cards = [];
    const m = f.mate;
    if (standing(m)) {
      // teammate still up: drop a reboot card
      g.cards.push({ x: f.x, y: f.y, f, team: f.team, expires: g.time + S.CARD_LIFE, t: U.rand(10) });
    } else if (m && m.alive && m.down) {
      // nobody left standing: the whole team is out
      MF.Match.kill(m, m.knockedBy, 'Team wiped');
    }
    // cards this fighter was carrying are lost
    if (carried && carried.length) g.cards = g.cards.filter((c) => !carried.includes(c.f));
  }

  // ---------- interaction (hold) ----------
  const rebootOpen = () => G().storm && G().storm.phase <= S.REBOOT_LAST_PHASE;

  function nearVan(f, maxD = S.VAN_R) {
    let best = null, bd = maxD;
    for (const v of G().vans) {
      const d = U.dist(f.x, f.y, v.x, v.y);
      if (d < bd) { bd = d; best = v; }
    }
    return best;
  }
  function nearestVan(f) { return nearVan(f, 1e9); }

  // What could this fighter do with the interact button right now?
  function option(f) {
    if (!duo() || !standing(f) || f.state !== 'ground') return null;
    const m = f.mate;
    if (m && m.alive && m.down && U.dist(f.x, f.y, m.x, m.y) < S.REVIVE_R)
      return { kind: 'revive', label: m.reviveProg > 0 ? 'REVIVING…' : 'HOLD TO REVIVE' };
    if (f.cards.length) {
      const v = nearVan(f);
      if (v) {
        if (!rebootOpen()) return { kind: 'info', label: 'REBOOT OFFLINE' };
        if (v.cd > 0) return { kind: 'info', label: 'REBOOT ' + U.fmtTime(v.cd) };
        return { kind: 'reboot', label: v.prog > 0 ? 'REBOOTING…' : 'HOLD TO REBOOT' };
      }
    }
    return null;
  }

  // Hold interact. Returns the action in progress ('revive' | 'reboot') or null.
  function holdInteract(f, holding, dt) {
    if (!holding) return null;
    const o = option(f);
    if (!o) return null;
    const g = G();
    if (o.kind === 'revive') {
      const m = f.mate;
      m.reviveProg += dt; m.reviveBy = f; m.reviveSeen = g.time;
      return 'revive';
    }
    if (o.kind === 'reboot') {
      const v = nearVan(f);
      v.prog += dt; v.by = f; v.seen = g.time;
      return 'reboot';
    }
    return null;
  }

  function reboot(v) {
    const g = G(), by = v.by;
    if (!by || !standing(by)) return;
    for (const f of by.cards) respawn(f, v);
    by.cards = [];
    v.prog = 0; v.cd = S.VAN_CD;
    g.cards = g.cards.filter((c) => c.f.alive === false);
  }

  function respawn(f, v) {
    const g = G();
    f.alive = true; f.state = 'glide'; f.down = false;
    f.x = U.clamp(v.x + U.rand(-30, 30), 60, C.WORLD - 60); f.y = U.clamp(v.y + U.rand(-30, 30), 60, C.WORLD - 60);
    f.z = 1; f.glideT = C.GLIDE_TIME - S.RESPAWN_GLIDE;
    f.hp = 100; f.shield = 0; f.use = null; f.reloadT = 0; f.fireCd = 0.5;
    f.slots = [MF.World.makeWeapon('pistol', 0), null, null, null, null];
    f.active = 0; f.pickaxe = false;
    f.mats = { wood: 50, brick: 0, metal: 0 };
    f.placement = 0; f.killedBy = null; f.knockedBy = null; f.lastHitBy = null; f.cards = [];
    if (f.isBot) MF.AI.onRespawn(f, v);
    g.feed.unshift({ t: g.time, text: `${f.name} was rebooted!`, you: f.team === g.player.team, weapon: '' });
    g.feed.length = Math.min(g.feed.length, 6);
    MF.Render && MF.Render.burst(v.x, v.y, '#59c3ff', 30, 300);
    if (f === g.player) { g.spectating = null; MF.UI && MF.UI.onRebooted(); }
    else if (f.mate === g.player) MF.UI && MF.UI.banner('TEAMMATE REBOOTED!', '#59c3ff');
  }

  // ---------- per frame ----------
  function update(dt) {
    if (!duo()) return;
    const g = G();
    for (const f of g.fighters) {
      if (!f.alive || !f.down) continue;
      f.downHp -= S.BLEED * dt;
      if (f.reviveProg > 0 && (g.time - f.reviveSeen > 0.2 || !standing(f.reviveBy))) f.reviveProg = 0;
      if (f.reviveProg >= S.REVIVE_TIME) { revive(f); continue; }
      if (f.downHp <= 0) MF.Match.kill(f, f.knockedBy, 'Bled out');
    }

    // reboot cards: expire, or get picked up by the teammate
    const keep = [];
    for (const c of g.cards) {
      if (g.time > c.expires || c.f.alive) continue;
      const m = c.f.mate;
      if (standing(m) && m.state === 'ground' && U.dist(m.x, m.y, c.x, c.y) < m.r + 26) {
        m.cards.push(c.f);
        if (m === g.player) MF.UI && MF.UI.banner('GOT THE CARD — FIND A REBOOT VAN!', '#59c3ff');
        continue;
      }
      keep.push(c);
    }
    g.cards = keep;

    for (const v of g.vans) {
      v.cd = Math.max(0, v.cd - dt);
      if (v.prog > 0 && (g.time - v.seen > 0.2 || !v.by || !standing(v.by) || !v.by.cards.length)) v.prog = 0;
      if (v.prog >= S.REBOOT_TIME) reboot(v);
    }
  }

  // ---------- queries (UI / AI) ----------
  function cardOf(f) { return G().cards.find((c) => c.f === f) || null; }
  function cardStatus(f) {
    // where is f's reboot card?  'ground' | 'carried' | 'gone'
    if (!f || f.alive) return null;
    const c = cardOf(f);
    if (c) return { where: 'ground', left: c.expires - G().time };
    if (f.mate && f.mate.alive && f.mate.cards.includes(f)) return { where: 'carried' };
    return { where: 'gone' };
  }

  return { S, setupVans, linkTeams, canKnock, knock, onEliminated, option, holdInteract, update,
           rebootOpen, nearestVan, cardOf, cardStatus, standing };
})();
