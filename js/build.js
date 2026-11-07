// ============================================================
// build.js — grid walls split into 3 segments (Fortnite-style)
//
// Walls sit on the edges of a CELL x CELL grid.
//   'h' wall at (cx,cy): top edge of cell (cx,cy), x from cx*G to (cx+1)*G
//   'v' wall at (cx,cy): left edge of cell (cx,cy), y from cy*G to (cy+1)*G
// Every wall has 3 segments. A segment is 'solid', 'open' (edited
// away, can be restored by the owner) or 'dead' (destroyed).
// ============================================================
MF.Build = (() => {
  const G = MF.CFG.CELL, T = MF.CFG.WALL_T;
  const N = Math.floor(MF.CFG.WORLD / G);
  const building = new Set();      // walls still growing in HP
  let nextId = 1;

  const keyOf = (k, cx, cy) => k + ':' + cx + ':' + cy;
  const walls = () => MF.G.walls;

  // side: 0 top, 1 right, 2 bottom, 3 left of cell (cx,cy)
  function edgeOf(cx, cy, side) {
    if (side === 0) return { k: 'h', cx, cy, side, cell: [cx, cy] };
    if (side === 2) return { k: 'h', cx, cy: cy + 1, side, cell: [cx, cy] };
    if (side === 3) return { k: 'v', cx, cy, side, cell: [cx, cy] };
    return { k: 'v', cx: cx + 1, cy, side, cell: [cx, cy] };
  }

  // Closest cell edge to a world point
  function edgeFromPoint(wx, wy) {
    const cx = Math.floor(wx / G), cy = Math.floor(wy / G);
    const fx = wx / G - cx, fy = wy / G - cy;
    const d = [fy, 1 - fx, 1 - fy, fx];
    let side = 0;
    for (let i = 1; i < 4; i++) if (d[i] < d[side]) side = i;
    return edgeOf(cx, cy, side);
  }

  // Edge of the cell (cx,cy) that faces direction angle a
  function edgeFacing(cx, cy, a) {
    const c = Math.cos(a), s = Math.sin(a);
    let side;
    if (Math.abs(c) > Math.abs(s)) side = c > 0 ? 1 : 3; else side = s > 0 ? 2 : 0;
    return edgeOf(cx, cy, side);
  }

  function segRect(w, i) {
    const s = G / 3;
    if (w.k === 'h') return { x: w.cx * G + i * s, y: w.cy * G - T / 2, w: s, h: T };
    return { x: w.cx * G - T / 2, y: w.cy * G + i * s, w: T, h: s };
  }
  function edgeRect(e) {
    if (e.k === 'h') return { x: e.cx * G, y: e.cy * G - T / 2, w: G, h: T };
    return { x: e.cx * G - T / 2, y: e.cy * G, w: T, h: G };
  }
  function edgeCenter(e) {
    return e.k === 'h' ? { x: (e.cx + 0.5) * G, y: e.cy * G } : { x: e.cx * G, y: (e.cy + 0.5) * G };
  }

  const get = (e) => walls().get(keyOf(e.k, e.cx, e.cy));
  const inBounds = (e) => e.cx >= 0 && e.cy >= 0 &&
    (e.k === 'h' ? e.cx < N && e.cy <= N : e.cx <= N && e.cy < N);

  function canPlace(e) {
    return inBounds(e) && !get(e);
  }

  function place(e, mat, owner, opts = {}) {
    if (!canPlace(e)) return null;
    const m = MF.MATERIALS[mat];
    const segMax = m.hp / 3;
    const buildDur = opts.buildTime != null ? opts.buildTime : m.build;
    const instant = !!opts.instant;
    const w = {
      id: nextId++, k: e.k, cx: e.cx, cy: e.cy, key: keyOf(e.k, e.cx, e.cy),
      mat, owner, hitT: -9,
      segs: [0, 1, 2].map(() => ({ hp: instant ? segMax : segMax * 0.1, max: segMax, state: 'solid' })),
      buildT: instant ? 0 : buildDur, buildDur,
    };
    walls().set(w.key, w);
    if (!instant) building.add(w);
    pushOutFighters(w);
    return w;
  }

  function update(dt) {
    for (const w of building) {
      w.buildT -= dt;
      for (const s of w.segs) {
        if (s.state !== 'dead') s.hp = Math.min(s.max, s.hp + (s.max * 0.9 * dt) / w.buildDur);
      }
      if (w.buildT <= 0 || !walls().has(w.key)) building.delete(w);
    }
  }

  function remove(w) {
    walls().delete(w.key);
    building.delete(w);
    const r = { x: w.k === 'h' ? (w.cx + 0.5) * G : w.cx * G, y: w.k === 'h' ? w.cy * G : (w.cy + 0.5) * G };
    MF.Render && MF.Render.burst(r.x, r.y, MF.MATERIALS[w.mat].color, 18, 220);
  }

  // Returns true when the segment broke
  function damage(w, i, dmg) {
    const s = w.segs[i];
    if (!s || s.state !== 'solid') return false;
    s.hp -= dmg;
    w.hitT = MF.G.time;
    if (s.hp <= 0) {
      s.state = 'dead';
      const r = segRect(w, i);
      MF.Render && MF.Render.burst(r.x + r.w / 2, r.y + r.h / 2, MF.MATERIALS[w.mat].color, 10, 180);
      if (!w.segs.some((x) => x.state === 'solid')) remove(w);
      return true;
    }
    return false;
  }

  // Edit: solid <-> open. A wall always keeps at least one solid part.
  function toggleEdit(w, i) {
    const s = w.segs[i];
    if (s.state === 'solid') {
      if (w.segs.filter((x) => x.state === 'solid').length <= 1) return false;
      s.state = 'open';
      return true;
    }
    if (s.state === 'open') {
      s.state = 'solid';
      pushOutFighters(w);
      return true;
    }
    return false;
  }

  // Call fn(w, i, rect) for segments touching the box. states: which segment states to include.
  function forSegsInBox(x0, y0, x1, y1, fn, states = SOLID) {
    const cx0 = Math.floor((x0 - T) / G), cx1 = Math.floor((x1 + T) / G);
    const cy0 = Math.floor((y0 - T) / G), cy1 = Math.floor((y1 + T) / G) + 1;
    const map = walls();
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1 + 1; cx++) {
        for (let k = 0; k < 2; k++) {
          const w = map.get((k ? 'v' : 'h') + ':' + cx + ':' + cy);
          if (!w) continue;
          for (let i = 0; i < 3; i++) {
            if (!states[w.segs[i].state]) continue;
            const r = segRect(w, i);
            if (r.x > x1 || r.x + r.w < x0 || r.y > y1 || r.y + r.h < y0) continue;
            if (fn(w, i, r) === false) return;
          }
        }
      }
    }
  }
  const SOLID = { solid: true };
  const SOLID_OPEN = { solid: true, open: true };

  function circleHit(x, y, r) {
    let hit = null;
    forSegsInBox(x - r, y - r, x + r, y + r, (w, i, rc) => {
      if (MF.U.circleRect(x, y, r, rc.x, rc.y, rc.w, rc.h)) { hit = { w, i }; return false; }
    });
    return hit;
  }

  function ray(x0, y0, x1, y1) {
    let best = null;
    forSegsInBox(Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1), (w, i, rc) => {
      const t = MF.U.segRect(x0, y0, x1, y1, rc.x, rc.y, rc.w, rc.h);
      if (t >= 0 && (!best || t < best.t)) best = { t, w, i };
    });
    return best;
  }

  // Nearest segment (solid or open) of a wall owned by `ownerId` near a point
  function nearestOwnSeg(px, py, ownerId, maxD = 30) {
    let best = null, bd = maxD;
    forSegsInBox(px - maxD, py - maxD, px + maxD, py + maxD, (w, i, rc) => {
      if (w.owner !== ownerId) return;
      const d = MF.U.pointRectDist(px, py, rc.x, rc.y, rc.w, rc.h);
      if (d < bd) { bd = d; best = { w, i }; }
    }, SOLID_OPEN);
    return best;
  }

  // Shove fighters out of a freshly placed / restored wall
  function pushOutFighters(w) {
    for (const f of MF.G.fighters) {
      if (!f.alive || f.state !== 'ground') continue;
      for (let i = 0; i < 3; i++) {
        if (w.segs[i].state !== 'solid') continue;
        const rc = segRect(w, i);
        if (!MF.U.circleRect(f.x, f.y, f.r, rc.x, rc.y, rc.w, rc.h)) continue;
        if (w.k === 'h') {
          const Y = w.cy * G;
          f.y = f.y < Y ? Y - T / 2 - f.r - 0.5 : Y + T / 2 + f.r + 0.5;
        } else {
          const X = w.cx * G;
          f.x = f.x < X ? X - T / 2 - f.r - 0.5 : X + T / 2 + f.r + 0.5;
        }
      }
    }
  }

  // Build all 4 walls around the cell containing (x,y)
  function boxUp(x, y, mat, owner, opts) {
    const cx = Math.floor(x / G), cy = Math.floor(y / G);
    let placed = 0;
    for (let s = 0; s < 4; s++) if (place(edgeOf(cx, cy, s), mat, owner, opts)) placed++;
    return placed;
  }

  function reset() { building.clear(); nextId = 1; }

  return { G, T, N, keyOf, edgeOf, edgeFromPoint, edgeFacing, segRect, edgeRect, edgeCenter,
           get, canPlace, place, update, damage, toggleEdit, remove, forSegsInBox, circleHit, ray,
           nearestOwnSeg, boxUp, reset, SOLID, SOLID_OPEN };
})();
