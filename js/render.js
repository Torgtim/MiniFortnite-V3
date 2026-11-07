// ============================================================
// render.js — everything you see on the canvas: terrain, builds,
// props, fighters, storm, bus, effects.
// ============================================================
MF.Render = (() => {
  const U = MF.U, C = MF.CFG;
  let cv, ctx, W = 0, H = 0, dpr = 1, zoom = 1;
  const cam = { x: C.WORLD / 2, y: C.WORLD / 2 };
  let shake = 0, hitT = -9;
  let particles = [], nums = [], rings = [], flashes = [], texts = [];

  function init(canvas) {
    cv = canvas; ctx = cv.getContext('2d');
    resize();
    window.addEventListener('resize', resize);
  }
  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = window.innerWidth; H = window.innerHeight;
    cv.width = W * dpr; cv.height = H * dpr;
    cv.style.width = W + 'px'; cv.style.height = H + 'px';
  }
  const baseZoom = () => Math.min(W, H) / 740;
  function screenToWorld(sx, sy) { return { x: cam.x + (sx - W / 2) / zoom, y: cam.y + (sy - H / 2) / zoom }; }
  function worldToScreen(x, y) { return { x: (x - cam.x) * zoom + W / 2, y: (y - cam.y) * zoom + H / 2 }; }

  // ---------- effects API (used by game code) ----------
  function burst(x, y, color, n = 10, sp = 150) {
    if (particles.length > 900) return;
    for (let i = 0; i < n; i++) {
      const a = U.rand(Math.PI * 2), v = U.rand(sp * 0.3, sp);
      particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: U.rand(0.3, 0.7), max: 0.7, color, s: U.rand(2, 5) });
    }
  }
  function flash(x, y, a) { flashes.push({ x, y, a, life: 0.06 }); }
  function explosion(x, y, r) {
    rings.push({ x, y, r, life: 0.45, max: 0.45, color: '255,170,40' });
    burst(x, y, '#ffb347', 26, 320); burst(x, y, '#555', 14, 160);
    const t = MF.Match.camTarget();
    if (t && U.dist(t.x, t.y, x, y) < 700) shake = Math.max(shake, 10);
  }
  function shockwave(x, y, r) { rings.push({ x, y, r, life: 0.5, max: 0.5, color: '140,100,255' }); }
  function dmgNum(x, y, v, color) { nums.push({ x: x + U.rand(-8, 8), y, v: Math.round(v), color, life: 0.9 }); }
  function hitmarker() { hitT = MF.G.time; }
  function pickupText(f, inst) {
    if (f.isBot) return;
    let name, color = '#fff';
    if (inst.type === 'mats') name = `+${inst.count} ${MF.MATERIALS[inst.mat].name}`;
    else if (inst.type === 'weapon') { name = MF.WEAPONS[inst.id].name; color = MF.RARITIES[inst.rarity].color; }
    else { name = MF.ITEMS[inst.id].name + (inst.count > 1 ? ' x' + inst.count : ''); color = MF.ITEMS[inst.id].color; }
    texts.push({ x: f.x, y: f.y - 34, text: name, color, life: 1.2 });
  }

  // ---------- main draw ----------
  function draw(dt) {
    const G = MF.G;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#1b6fc2';
    ctx.fillRect(0, 0, cv.width, cv.height);
    if (G.phase === 'menu' || !G.tiles) return;

    // camera
    const t = MF.Match.camTarget();
    let tx = cam.x, ty = cam.y, zMul = 1;
    if (t) {
      if (t.state === 'bus') { tx = G.bus.x; ty = G.bus.y; zMul = 0.5; }
      else { tx = t.x; ty = t.y; if (t.state === 'glide') zMul = 0.55 + 0.45 * (1 - t.z); }
    }
    const k = 1 - Math.pow(0.0005, dt);
    cam.x = U.lerp(cam.x, tx, Math.min(1, k * 1.6)); cam.y = U.lerp(cam.y, ty, Math.min(1, k * 1.6));
    zoom = U.lerp(zoom || baseZoom(), baseZoom() * zMul, Math.min(1, k));
    shake = Math.max(0, shake - dt * 30);
    const sx = (Math.random() - 0.5) * shake, sy = (Math.random() - 0.5) * shake;

    ctx.setTransform(dpr * zoom, 0, 0, dpr * zoom, dpr * (W / 2 - cam.x * zoom + sx), dpr * (H / 2 - cam.y * zoom + sy));
    const v = { x0: cam.x - W / 2 / zoom - 60, y0: cam.y - H / 2 / zoom - 60, x1: cam.x + W / 2 / zoom + 60, y1: cam.y + H / 2 / zoom + 60 };

    drawTerrain(v);
    if (G.mode === 'build' && G.player.alive && !G.spectating) drawGrid(v);
    drawPads();
    drawChests(v);
    drawLoot(v);
    drawShadows(v);
    drawPropsLow(v);
    drawWalls(v);
    for (const f of G.fighters) if (f.alive && f.state !== 'glide' && f.state !== 'air' && f.state !== 'bus' && inView(f, v)) drawFighter(f);
    drawPropsHigh(v);
    drawThrowables();
    drawBullets();
    updateDrawParticles(dt);
    for (const f of G.fighters) if (f.alive && (f.state === 'glide' || f.state === 'air') && inView(f, v)) drawFighter(f);
    drawGhost();
    drawReticle();
    drawTextsAndNums(dt);
    if (!G.bus.done) drawBus();

    // screen space
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawStorm();
    drawSticks();
    if (t && t.alive && G.time - t.lastHurtT < 0.35) {
      ctx.fillStyle = `rgba(255,0,0,${0.22 * (1 - (G.time - t.lastHurtT) / 0.35)})`;
      ctx.fillRect(0, 0, W, H);
    }
  }
  const inView = (f, v) => f.x > v.x0 && f.x < v.x1 && f.y > v.y0 && f.y < v.y1;

  // ---------- terrain ----------
  function drawTerrain(v) {
    const T = C.TILE, NT = MF.World.NT, tiles = MF.G.tiles, TT = MF.World.T;
    const tx0 = Math.max(0, Math.floor(v.x0 / T)), ty0 = Math.max(0, Math.floor(v.y0 / T));
    const tx1 = Math.min(NT - 1, Math.floor(v.x1 / T)), ty1 = Math.min(NT - 1, Math.floor(v.y1 / T));
    const time = MF.G.time;
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const type = tiles[ty * NT + tx];
        const h = U.hash2(tx, ty);
        ctx.fillStyle = MF.World.COLORS[type][Math.floor(h * 3)];
        ctx.fillRect(tx * T, ty * T, T + 0.6, T + 0.6);
        const x = tx * T, y = ty * T;
        if (type === TT.WATER) {
          ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 2;
          const o = Math.sin(time * 1.5 + tx * 0.7 + ty * 0.4) * 6;
          ctx.beginPath(); ctx.moveTo(x + 8 + o, y + 18 + h * 10); ctx.lineTo(x + 26 + o, y + 18 + h * 10); ctx.stroke();
        } else if ((type === TT.GRASS || type === TT.FOREST) && h > 0.55) {
          ctx.strokeStyle = 'rgba(20,80,20,0.35)'; ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(x + h * 30 + 6, y + 30); ctx.lineTo(x + h * 30 + 3, y + 22);
          ctx.moveTo(x + h * 30 + 10, y + 30); ctx.lineTo(x + h * 30 + 12, y + 21);
          ctx.stroke();
          if (h > 0.93) { ctx.fillStyle = U.hash2(ty, tx) > 0.5 ? '#ffd8f0' : '#fff3a0'; ctx.beginPath(); ctx.arc(x + 30, y + 12, 3, 0, 7); ctx.fill(); }
        } else if (type === TT.FLOOR) {
          ctx.strokeStyle = 'rgba(90,50,20,0.35)'; ctx.lineWidth = 1.5;
          for (let i = 1; i < 4; i++) { ctx.beginPath(); ctx.moveTo(x, y + i * 12); ctx.lineTo(x + T, y + i * 12); ctx.stroke(); }
        } else if (type === TT.ROAD) {
          if (h > 0.5) { ctx.fillStyle = 'rgba(255,255,255,0.05)'; ctx.fillRect(x + 6, y + 6, 10, 4); }
        } else if (type === TT.BRIDGE) {
          ctx.strokeStyle = 'rgba(60,35,10,0.5)'; ctx.lineWidth = 2;
          for (let i = 1; i < 4; i++) { ctx.beginPath(); ctx.moveTo(x + i * 12, y); ctx.lineTo(x + i * 12, y + T); ctx.stroke(); }
        } else if (type === TT.SAND && h > 0.8) {
          ctx.fillStyle = 'rgba(180,140,60,0.25)'; ctx.beginPath(); ctx.arc(x + 14, y + 30, 2, 0, 7); ctx.fill();
        }
      }
    }
    // POI names on the ground
    ctx.font = 'bold 34px "Luckiest Guy", Impact, sans-serif'; ctx.textAlign = 'center';
    for (const p of MF.G.pois) {
      if (p.x < v.x0 - 300 || p.x > v.x1 + 300 || p.y < v.y0 - 100 || p.y > v.y1 + 100) continue;
      ctx.fillStyle = 'rgba(0,0,0,0.18)'; ctx.fillText(p.name.toUpperCase(), p.x + 2, p.y - 300 + 2);
      ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.fillText(p.name.toUpperCase(), p.x, p.y - 300);
    }
  }

  function drawGrid(v) {
    const G = C.CELL, P = MF.G.player;
    const r = C.BUILD_RANGE + G;
    ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let x = Math.floor((P.x - r) / G) * G; x <= P.x + r; x += G) { ctx.moveTo(x, P.y - r); ctx.lineTo(x, P.y + r); }
    for (let y = Math.floor((P.y - r) / G) * G; y <= P.y + r; y += G) { ctx.moveTo(P.x - r, y); ctx.lineTo(P.x + r, y); }
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.2)'; ctx.setLineDash([8, 8]);
    ctx.beginPath(); ctx.arc(P.x, P.y, C.BUILD_RANGE, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
  }

  // ---------- objects ----------
  function drawPads() {
    for (const p of MF.G.pads) {
      ctx.fillStyle = '#1a3d55'; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 7); ctx.fill();
      ctx.strokeStyle = '#38e0ff'; ctx.lineWidth = 4; ctx.stroke();
      const pulse = (p.t * 1.5) % 1;
      ctx.strokeStyle = `rgba(56,224,255,${1 - pulse})`; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r * (0.3 + pulse * 0.7), 0, 7); ctx.stroke();
      ctx.fillStyle = '#38e0ff'; ctx.font = 'bold 22px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('▲', p.x, p.y + 8);
    }
  }

  function drawChests(v) {
    const P = MF.G.player;
    for (const c of MF.G.chests) {
      if (c.opened || c.x < v.x0 || c.x > v.x1 || c.y < v.y0 || c.y > v.y1) continue;
      const glow = 0.5 + 0.5 * Math.sin(MF.G.time * 4 + c.sparkle);
      ctx.fillStyle = `rgba(255,215,60,${0.18 + glow * 0.18})`;
      ctx.beginPath(); ctx.arc(c.x, c.y, 30 + glow * 4, 0, 7); ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(c.x - 16, c.y - 8, 36, 24);
      ctx.fillStyle = '#8a5a1c'; ctx.fillRect(c.x - 18, c.y - 12, 36, 24);
      ctx.fillStyle = '#ffcf3a'; ctx.fillRect(c.x - 18, c.y - 12, 36, 9);
      ctx.strokeStyle = '#5a3a10'; ctx.lineWidth = 2; ctx.strokeRect(c.x - 18, c.y - 12, 36, 24);
      ctx.fillStyle = '#fff3b0'; ctx.fillRect(c.x - 3, c.y - 5, 6, 7);
      if (P.openChest === c && P.openProg > 0) progressRing(c.x, c.y, 26, P.openProg / MF.Items.CHEST_TIME, '#ffe23d');
    }
  }

  function lootLabel(inst) {
    if (inst.type === 'mats') return { t: MF.MATERIALS[inst.mat].name.toUpperCase(), c: MF.MATERIALS[inst.mat].color };
    if (inst.type === 'weapon') return { t: MF.WEAPONS[inst.id].short, c: MF.RARITIES[inst.rarity].color };
    return { t: MF.ITEMS[inst.id].name.split(' ')[0].toUpperCase(), c: MF.ITEMS[inst.id].color };
  }
  function drawLoot(v) {
    ctx.textAlign = 'center';
    for (const l of MF.G.loot) {
      if (l.x < v.x0 || l.x > v.x1 || l.y < v.y0 || l.y > v.y1) continue;
      const lb = lootLabel(l.inst);
      const bob = Math.sin(MF.G.time * 3 + l.t) * 2;
      ctx.fillStyle = lb.c + '44';
      ctx.beginPath(); ctx.arc(l.x, l.y, 16, 0, 7); ctx.fill();
      ctx.font = 'bold 11px "Bebas Neue", Impact, sans-serif';
      const w = Math.max(30, ctx.measureText(lb.t).width + 10);
      roundRect(l.x - w / 2, l.y - 9 + bob, w, 17, 5);
      ctx.fillStyle = 'rgba(10,15,30,0.85)'; ctx.fill();
      ctx.strokeStyle = lb.c; ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = lb.c; ctx.fillText(lb.t, l.x, l.y + 4 + bob);
    }
  }

  function drawShadows(v) {
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    MF.Build.forSegsInBox(v.x0, v.y0, v.x1, v.y1, (w, i, r) => { ctx.fillRect(r.x + 5, r.y + 7, r.w, r.h); });
    MF.World.propsNear(v.x0, v.y0, v.x1, v.y1, (p) => {
      if (p.shape === 'rect') ctx.fillRect(p.x - p.w / 2 + 5, p.y - p.h / 2 + 7, p.w, p.h);
      else { const r = p.type === 'tree' ? 36 : p.type === 'pine' ? 30 : p.r; ctx.beginPath(); ctx.ellipse(p.x + 8, p.y + 10, r, r * 0.8, 0, 0, 7); ctx.fill(); }
    });
  }

  function drawWalls(v) {
    const G = MF.G, editing = G.mode === 'edit' && G.player.alive && !G.spectating;
    MF.Build.forSegsInBox(v.x0, v.y0, v.x1, v.y1, (w, i, r) => {
      const s = w.segs[i], m = MF.MATERIALS[w.mat];
      if (s.state === 'open') {
        if (editing && w.owner === G.player.id) {
          ctx.setLineDash([5, 5]); ctx.strokeStyle = '#7fd3ff'; ctx.lineWidth = 2;
          ctx.strokeRect(r.x, r.y, r.w, r.h); ctx.setLineDash([]);
        }
        return;
      }
      const built = w.buildT > 0 ? 1 - w.buildT / w.buildDur : 1;
      const hpk = s.hp / s.max;
      ctx.globalAlpha = 0.45 + 0.55 * built;
      ctx.fillStyle = G.time - w.hitT < 0.08 ? '#ffffff' : (hpk < 0.35 ? m.dark : m.color);
      ctx.fillRect(r.x, r.y, r.w, r.h);
      // texture
      ctx.strokeStyle = m.dark; ctx.lineWidth = 1.5;
      ctx.beginPath();
      if (w.mat === 'wood') {
        if (w.k === 'h') { ctx.moveTo(r.x, r.y + r.h / 2); ctx.lineTo(r.x + r.w, r.y + r.h / 2); }
        else { ctx.moveTo(r.x + r.w / 2, r.y); ctx.lineTo(r.x + r.w / 2, r.y + r.h); }
      } else if (w.mat === 'brick') {
        for (let k = 8; k < 32; k += 8) {
          if (w.k === 'h') { ctx.moveTo(r.x + k, r.y); ctx.lineTo(r.x + k, r.y + r.h); }
          else { ctx.moveTo(r.x, r.y + k); ctx.lineTo(r.x + r.w, r.y + k); }
        }
      }
      ctx.stroke();
      if (w.mat === 'metal') {
        ctx.fillStyle = m.dark;
        const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
        ctx.fillRect(cx - 1.5, cy - 1.5, 3, 3);
      }
      ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.lineWidth = 1.5; ctx.strokeRect(r.x, r.y, r.w, r.h);
      ctx.globalAlpha = 1;
      // edit mode: two bright lines splitting YOUR walls into 3
      if (editing && w.owner === G.player.id) {
        ctx.strokeStyle = '#7fd3ff'; ctx.lineWidth = 2.5; ctx.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
        ctx.fillStyle = '#ffffff';
        if (w.k === 'h') { if (i > 0) ctx.fillRect(r.x - 1.5, r.y - 6, 3, r.h + 12); }
        else if (i > 0) ctx.fillRect(r.x - 6, r.y - 1.5, r.w + 12, 3);
      }
      if (hpk < 0.999 && G.time - w.hitT < 2) {
        ctx.fillStyle = '#111'; ctx.fillRect(r.x + r.w / 2 - 11, r.y + r.h / 2 - 2, 22, 4);
        ctx.fillStyle = '#7dff8a'; ctx.fillRect(r.x + r.w / 2 - 11, r.y + r.h / 2 - 2, 22 * hpk, 4);
      }
    }, MF.Build.SOLID_OPEN);
  }

  function drawPropsLow(v) {
    MF.World.propsNear(v.x0, v.y0, v.x1, v.y1, (p) => {
      if (p.type === 'tree' || p.type === 'pine') {
        ctx.fillStyle = '#6b4423'; ctx.beginPath(); ctx.arc(p.x, p.y, p.r * 0.7, 0, 7); ctx.fill();
      } else if (p.type === 'rock') {
        const hit = MF.G.time - p.hitT < 0.08;
        ctx.fillStyle = hit ? '#fff' : '#8d95a0';
        ctx.beginPath();
        for (let i = 0; i < 7; i++) {
          const a = i / 7 * Math.PI * 2, rr = p.r * (0.85 + 0.25 * U.hash2(i, Math.floor(p.seed * 999)));
          i ? ctx.lineTo(p.x + Math.cos(a) * rr, p.y + Math.sin(a) * rr) : ctx.moveTo(p.x + Math.cos(a) * rr, p.y + Math.sin(a) * rr);
        }
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#b3bac4'; ctx.beginPath(); ctx.arc(p.x - 6, p.y - 7, p.r * 0.4, 0, 7); ctx.fill();
        ctx.strokeStyle = '#59606b'; ctx.lineWidth = 2; ctx.stroke();
      } else if (p.type === 'car') {
        const hit = MF.G.time - p.hitT < 0.08;
        ctx.fillStyle = hit ? '#fff' : p.color;
        roundRect(p.x - p.w / 2, p.y - p.h / 2, p.w, p.h, 8); ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 2; ctx.stroke();
        ctx.fillStyle = '#9fd4ff';
        if (p.w > p.h) { ctx.fillRect(p.x - p.w * 0.18, p.y - p.h / 2 + 5, p.w * 0.36, p.h - 10); }
        else { ctx.fillRect(p.x - p.w / 2 + 5, p.y - p.h * 0.18, p.w - 10, p.h * 0.36); }
      } else if (p.type === 'cactus') {
        ctx.fillStyle = '#3f9b3a';
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 7); ctx.fill();
        ctx.fillRect(p.x - p.r - 8, p.y - 4, 10, 8); ctx.fillRect(p.x + p.r - 2, p.y - 10, 10, 8);
        ctx.strokeStyle = '#2b6e28'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 7); ctx.stroke();
      }
    });
  }

  function drawPropsHigh(v) {
    const t = MF.Match.camTarget();
    MF.World.propsNear(v.x0, v.y0, v.x1, v.y1, (p) => {
      if (p.type !== 'tree' && p.type !== 'pine') return;
      const R = p.type === 'tree' ? 38 : 30;
      const under = t && U.dist(t.x, t.y, p.x, p.y) < R + 6;
      const hit = MF.G.time - p.hitT < 0.08;
      ctx.globalAlpha = under ? 0.4 : 1;
      if (p.type === 'tree') {
        ctx.fillStyle = hit ? '#fff' : '#2f8a2f'; ctx.beginPath(); ctx.arc(p.x, p.y, R, 0, 7); ctx.fill();
        ctx.fillStyle = '#3fa63c'; ctx.beginPath(); ctx.arc(p.x - 6, p.y - 6, R * 0.72, 0, 7); ctx.fill();
        ctx.fillStyle = '#5cc455'; ctx.beginPath(); ctx.arc(p.x - 12, p.y - 12, R * 0.38, 0, 7); ctx.fill();
      } else {
        ctx.fillStyle = hit ? '#fff' : '#1f6b45';
        ctx.beginPath();
        for (let i = 0; i < 16; i++) { const a = i / 16 * Math.PI * 2, rr = i % 2 ? R * 0.6 : R; ctx.lineTo(p.x + Math.cos(a) * rr, p.y + Math.sin(a) * rr); }
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#f2f8ff'; ctx.beginPath(); ctx.arc(p.x - 4, p.y - 4, R * 0.35, 0, 7); ctx.fill();
      }
      ctx.globalAlpha = 1;
    });
  }

  // ---------- fighters ----------
  function drawFighter(f) {
    const G = MF.G;
    const lift = f.state === 'glide' ? f.z * 1.0 : (f.state === 'air' ? f.z / 120 : 0);
    const sc = 1 + lift * 0.6;
    // shadow
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.beginPath(); ctx.ellipse(f.x + 4 + lift * 30, f.y + 6 + lift * 40, f.r * (1 - lift * 0.3), f.r * 0.75 * (1 - lift * 0.3), 0, 0, 7); ctx.fill();
    ctx.save();
    ctx.translate(f.x, f.y); ctx.scale(sc, sc);

    if (f.state === 'glide') {
      ctx.save(); ctx.rotate(f.aim + Math.PI / 2);
      ctx.fillStyle = f.isBot ? '#ff6bd5' : '#ffe23d';
      ctx.beginPath(); ctx.moveTo(0, -36); ctx.lineTo(34, 8); ctx.lineTo(-34, 8); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.lineWidth = 2; ctx.stroke();
      ctx.restore();
    }
    if (!f.isBot) { ctx.strokeStyle = 'rgba(255,226,61,0.8)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(0, 0, f.r + 6, 0, 7); ctx.stroke(); }

    ctx.save(); ctx.rotate(f.aim);
    // weapon / pickaxe
    const w = MF.F.activeWeapon(f), slot = MF.F.activeSlot(f);
    if (f.pickaxe || !slot) {
      const sw = f.swingT > 0 ? Math.sin((f.swingT / 0.22) * Math.PI) * 1.3 : 0;
      ctx.save(); ctx.rotate(-0.6 + sw);
      ctx.strokeStyle = '#7a4a1e'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(6, 6); ctx.lineTo(f.r + 18, 6); ctx.stroke();
      ctx.strokeStyle = '#c9d3dc'; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(f.r + 14, -6); ctx.quadraticCurveTo(f.r + 22, 6, f.r + 14, 16); ctx.stroke();
      ctx.restore();
    } else if (w) {
      const def = MF.WEAPONS[w.id];
      ctx.fillStyle = '#222'; ctx.fillRect(f.r - 4, -4, def.len, 8);
      ctx.fillStyle = MF.RARITIES[w.rarity].color; ctx.fillRect(f.r - 4, -4, def.len * 0.55, 8);
    } else {
      ctx.fillStyle = MF.ITEMS[slot.id].color; ctx.beginPath(); ctx.arc(f.r + 4, 0, 6, 0, 7); ctx.fill();
    }
    // hands
    ctx.fillStyle = shade(f.color, -25);
    ctx.beginPath(); ctx.arc(f.r - 2, -8, 5, 0, 7); ctx.arc(f.r - 2, 8, 5, 0, 7); ctx.fill();
    // backpack
    ctx.fillStyle = shade(f.color, -45);
    roundRect(-f.r - 4, -9, 10, 18, 4); ctx.fill();
    ctx.restore();

    // body
    ctx.fillStyle = f.hurtFlash > 0 ? '#ffffff' : f.color;
    ctx.beginPath(); ctx.arc(0, 0, f.r, 0, 7); ctx.fill();
    ctx.strokeStyle = shade(f.color, -60); ctx.lineWidth = 2.5; ctx.stroke();
    // face direction dots
    ctx.fillStyle = '#1b1b2b';
    const ex = Math.cos(f.aim), ey = Math.sin(f.aim);
    ctx.beginPath();
    ctx.arc(ex * 8 - ey * 5, ey * 8 + ex * 5, 2.2, 0, 7);
    ctx.arc(ex * 8 + ey * 5, ey * 8 - ex * 5, 2.2, 0, 7);
    ctx.fill();
    ctx.restore();

    // heal progress
    if (f.use) progressRing(f.x, f.y, f.r + 10, f.use.t / f.use.dur, MF.ITEMS[f.use.id].kind === 'heal' ? '#7dff8a' : '#59c3ff');
    if (f.reloadT > 0 && f === MF.Match.camTarget()) {
      const def = MF.WEAPONS[MF.F.activeWeapon(f) ? MF.F.activeWeapon(f).id : 'ar'];
      progressRing(f.x, f.y, f.r + 10, 1 - f.reloadT / def.reload, '#ffffff');
    }

    // name + bars
    if (f.isBot) {
      ctx.font = 'bold 12px "Bebas Neue", Impact, sans-serif'; ctx.textAlign = 'center';
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.7)';
      const ny = f.y - f.r * sc - 16;
      ctx.strokeText(f.name, f.x, ny); ctx.fillStyle = G.spectating === f ? '#ffe23d' : '#ffffff'; ctx.fillText(f.name, f.x, ny);
      if (G.time - f.lastHurtT < 3 || G.spectating === f) {
        ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(f.x - 20, ny + 3, 40, 6);
        ctx.fillStyle = '#5be35b'; ctx.fillRect(f.x - 20, ny + 3, 40 * f.hp / 100, 3);
        ctx.fillStyle = '#4fb4ff'; ctx.fillRect(f.x - 20, ny + 6, 40 * f.shield / 100, 3);
      }
    }
  }

  function drawReticle() {
    const G = MF.G, P = G.player;
    if (!P.alive || G.spectating || P.state !== 'ground' || G.mode !== 'fight') return;
    const d = 115;
    const x = P.x + Math.cos(P.aim) * d, y = P.y + Math.sin(P.aim) * d;
    ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 2; ctx.setLineDash([4, 8]);
    ctx.beginPath(); ctx.moveTo(P.x + Math.cos(P.aim) * 30, P.y + Math.sin(P.aim) * 30); ctx.lineTo(x, y); ctx.stroke(); ctx.setLineDash([]);
    ctx.beginPath(); ctx.arc(x, y, 9, 0, 7); ctx.stroke();
    if (G.time - hitT < 0.18) {
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(x - 12, y - 12); ctx.lineTo(x - 5, y - 5); ctx.moveTo(x + 12, y - 12); ctx.lineTo(x + 5, y - 5);
      ctx.moveTo(x - 12, y + 12); ctx.lineTo(x - 5, y + 5); ctx.moveTo(x + 12, y + 12); ctx.lineTo(x + 5, y + 5);
      ctx.stroke();
    }
  }

  function drawGhost() {
    const G = MF.G, g = G.ghost;
    if (!g || G.mode !== 'build' || !G.player.alive || G.spectating) return;
    const r = MF.Build.edgeRect(g);
    const bad = MF.Input.ghostProblem(g);
    const m = MF.MATERIALS[G.player.buildMat];
    ctx.globalAlpha = 0.55 + 0.2 * Math.sin(G.time * 8);
    ctx.fillStyle = bad ? '#ff4d4d' : m.color;
    ctx.fillRect(r.x - 2, r.y - 2, r.w + 4, r.h + 4);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = bad ? '#ff4d4d' : '#ffffff'; ctx.lineWidth = 2; ctx.setLineDash([6, 4]);
    ctx.strokeRect(r.x - 3, r.y - 3, r.w + 6, r.h + 6); ctx.setLineDash([]);
    const c = MF.Build.edgeCenter(g);
    ctx.font = 'bold 14px "Bebas Neue", Impact, sans-serif'; ctx.textAlign = 'center';
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    const label = bad || (document.body.classList.contains('pc') ? 'CLICK TO BUILD' : 'TAP AGAIN / ✓ TO BUILD');
    ctx.strokeText(label, c.x, c.y - 18); ctx.fillStyle = bad ? '#ff8a8a' : '#fff'; ctx.fillText(label, c.x, c.y - 18);
  }

  function drawThrowables() {
    for (const t of MF.G.throwables) {
      ctx.fillStyle = MF.ITEMS[t.type].color;
      ctx.beginPath(); ctx.arc(t.x, t.y, 7, 0, 7); ctx.fill();
      ctx.strokeStyle = '#111'; ctx.lineWidth = 2; ctx.stroke();
      if (t.type === 'grenade' && Math.sin(t.fuse * 25) > 0) { ctx.fillStyle = '#ff3b3b'; ctx.beginPath(); ctx.arc(t.x, t.y - 2, 2.5, 0, 7); ctx.fill(); }
    }
  }

  function drawBullets() {
    ctx.lineCap = 'round';
    for (const b of MF.G.bullets) {
      if (b.rocket) {
        ctx.fillStyle = '#ff6b2b'; ctx.beginPath(); ctx.arc(b.x, b.y, 6, 0, 7); ctx.fill();
        if (Math.random() < 0.6) particles.push({ x: b.x, y: b.y, vx: U.rand(-20, 20), vy: U.rand(-20, 20), life: 0.5, max: 0.5, color: '#aaaaaa', s: 5 });
        continue;
      }
      ctx.strokeStyle = b.color; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(b.px, b.py); ctx.lineTo(b.x, b.y); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo((b.px + b.x) / 2, (b.py + b.y) / 2); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    ctx.lineCap = 'butt';
    for (const f of flashes) {
      ctx.fillStyle = 'rgba(255,230,140,0.9)';
      ctx.beginPath(); ctx.arc(f.x, f.y, 7, 0, 7); ctx.fill();
    }
    flashes = flashes.filter((f) => (f.life -= 1 / 60) > 0);
  }

  function updateDrawParticles(dt) {
    for (const p of particles) {
      p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.92; p.vy *= 0.92;
      ctx.globalAlpha = Math.max(0, p.life / p.max);
      ctx.fillStyle = p.color; ctx.fillRect(p.x - p.s / 2, p.y - p.s / 2, p.s, p.s);
    }
    ctx.globalAlpha = 1;
    particles = particles.filter((p) => p.life > 0);
    for (const r of rings) {
      r.life -= dt;
      const k = 1 - r.life / r.max;
      ctx.strokeStyle = `rgba(${r.color},${1 - k})`; ctx.lineWidth = 8 * (1 - k) + 2;
      ctx.beginPath(); ctx.arc(r.x, r.y, r.r * (0.3 + k * 0.7), 0, 7); ctx.stroke();
      if (k < 0.3) { ctx.fillStyle = `rgba(${r.color},${0.4 - k})`; ctx.beginPath(); ctx.arc(r.x, r.y, r.r * k * 2, 0, 7); ctx.fill(); }
    }
    rings = rings.filter((r) => r.life > 0);
  }

  function drawTextsAndNums(dt) {
    ctx.textAlign = 'center';
    for (const n of nums) {
      n.life -= dt; n.y -= 40 * dt;
      ctx.globalAlpha = Math.min(1, n.life * 2);
      ctx.font = 'bold 20px "Luckiest Guy", Impact, sans-serif';
      ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,0.75)'; ctx.strokeText(n.v, n.x, n.y);
      ctx.fillStyle = n.color; ctx.fillText(n.v, n.x, n.y);
    }
    nums = nums.filter((n) => n.life > 0);
    for (const t of texts) {
      t.life -= dt; t.y -= 26 * dt;
      ctx.globalAlpha = Math.min(1, t.life * 2);
      ctx.font = 'bold 15px "Bebas Neue", Impact, sans-serif';
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.75)'; ctx.strokeText(t.text, t.x, t.y);
      ctx.fillStyle = t.color; ctx.fillText(t.text, t.x, t.y);
    }
    texts = texts.filter((t) => t.life > 0);
    ctx.globalAlpha = 1;
  }

  function drawBus() {
    const b = MF.G.bus;
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.fillStyle = 'rgba(0,0,0,0.2)'; ctx.beginPath(); ctx.ellipse(60, 90, 90, 40, b.angle, 0, 7); ctx.fill();
    ctx.rotate(b.angle);
    // balloon + strings
    ctx.strokeStyle = '#ddd'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(-40, 0); ctx.lineTo(-10, -70); ctx.moveTo(40, 0); ctx.lineTo(10, -70); ctx.stroke();
    ctx.fillStyle = '#ff5fa2'; ctx.beginPath(); ctx.arc(0, -100, 45, 0, 7); ctx.fill();
    ctx.fillStyle = '#ffd1e6'; ctx.beginPath(); ctx.arc(-14, -114, 14, 0, 7); ctx.fill();
    // bus body
    ctx.fillStyle = '#2f7bff'; roundRect(-80, -30, 160, 60, 14); ctx.fill();
    ctx.strokeStyle = '#0b3a8f'; ctx.lineWidth = 4; ctx.stroke();
    ctx.fillStyle = '#ffe23d'; ctx.fillRect(-80, 8, 160, 8);
    ctx.fillStyle = '#bfe6ff';
    for (let i = 0; i < 5; i++) ctx.fillRect(-66 + i * 28, -20, 20, 20);
    ctx.fillStyle = '#bfe6ff'; ctx.fillRect(66, -22, 10, 44);
    ctx.restore();
  }

  // ---------- screen space ----------
  function drawStorm() {
    const s = MF.G.storm;
    if (!s) return;
    const c = worldToScreen(s.cx, s.cy), r = s.r * zoom;
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.arc(c.x, c.y, Math.max(0, r), 0, Math.PI * 2, true);
    ctx.fillStyle = 'rgba(122,40,214,0.38)'; ctx.fill('evenodd');
    ctx.strokeStyle = 'rgba(214,140,255,0.95)'; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.arc(c.x, c.y, Math.max(0, r), 0, Math.PI * 2); ctx.stroke();
    const n = worldToScreen(s.nx, s.ny);
    ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 2.5; ctx.setLineDash([12, 10]);
    ctx.beginPath(); ctx.arc(n.x, n.y, Math.max(0, s.nr * zoom), 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  function drawSticks() {
    const st = MF.Input.sticks();
    const drawStick = (t, color) => {
      if (!t) return;
      ctx.globalAlpha = 0.35; ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(t.sx, t.sy, st.R, 0, 7); ctx.fill();
      ctx.globalAlpha = 0.75;
      let dx = t.x - t.sx, dy = t.y - t.sy; const d = Math.hypot(dx, dy);
      if (d > st.R) { dx = dx / d * st.R; dy = dy / d * st.R; }
      ctx.fillStyle = color; ctx.beginPath(); ctx.arc(t.sx + dx, t.sy + dy, 28, 0, 7); ctx.fill();
      ctx.globalAlpha = 1;
    };
    drawStick(st.move, '#ffffff');
    drawStick(st.aim, '#ff4d6d');
  }

  // ---------- helpers ----------
  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  function progressRing(x, y, r, k, color) {
    ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 6; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.stroke();
    ctx.strokeStyle = color; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * U.clamp(k, 0, 1)); ctx.stroke();
  }
  function shade(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    const r = U.clamp((n >> 16) + amt, 0, 255), g = U.clamp(((n >> 8) & 255) + amt, 0, 255), b = U.clamp((n & 255) + amt, 0, 255);
    return `rgb(${r},${g},${b})`;
  }

  return { init, draw, screenToWorld, worldToScreen, burst, flash, explosion, shockwave, dmgNum, hitmarker, pickupText,
           reset() { particles = []; nums = []; rings = []; flashes = []; texts = []; } };
})();
