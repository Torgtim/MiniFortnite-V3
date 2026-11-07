// ============================================================
// world.js — island terrain, named POIs with houses, props
// (trees / rocks / cars / cacti), chests and floor loot.
// ============================================================
MF.World = (() => {
  const { WORLD, TILE, CELL } = MF.CFG;
  const NT = WORLD / TILE;               // tiles per side
  const U = MF.U;

  // Tile types
  const T = { GRASS: 0, FOREST: 1, SAND: 2, WATER: 3, ROAD: 4, FLOOR: 5, DESERT: 6, SNOW: 7, BRIDGE: 8 };
  const COLORS = {
    0: ['#5cc24a', '#55b844', '#62c951'],
    1: ['#3f9a3c', '#3a9137', '#44a241'],
    2: ['#f1d98f', '#ead086', '#f5df9b'],
    3: ['#2f9fea', '#2b97e0', '#35a7f0'],
    4: ['#5e6672', '#59616c', '#636b77'],
    5: ['#c08a52', '#b8824b', '#c6915a'],
    6: ['#eab964', '#e3b05a', '#efc06e'],
    7: ['#eef6ff', '#e4eefa', '#f6faff'],
    8: ['#a8743f', '#9e6b38', '#b07c46'],
  };

  const tileAt = (x, y) => {
    const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
    if (tx < 0 || ty < 0 || tx >= NT || ty >= NT) return T.WATER;
    return MF.G.tiles[ty * NT + tx];
  };
  const setTile = (tx, ty, v) => { if (tx >= 0 && ty >= 0 && tx < NT && ty < NT) MF.G.tiles[ty * NT + tx] = v; };
  const isWater = (x, y) => tileAt(x, y) === T.WATER;
  const isLand = (x, y) => { const t = tileAt(x, y); return t !== T.WATER; };

  // ---------- props spatial hash ----------
  const pkey = (cx, cy) => cx + ',' + cy;
  function addProp(p) {
    MF.G.props.push(p);
    const k = pkey(Math.floor(p.x / CELL), Math.floor(p.y / CELL));
    if (!MF.G.propGrid.has(k)) MF.G.propGrid.set(k, []);
    MF.G.propGrid.get(k).push(p);
  }
  function removeProp(p) {
    p.dead = true;
    const k = pkey(Math.floor(p.x / CELL), Math.floor(p.y / CELL));
    const arr = MF.G.propGrid.get(k);
    if (arr) { const i = arr.indexOf(p); if (i >= 0) arr.splice(i, 1); }
    const j = MF.G.props.indexOf(p);
    if (j >= 0) MF.G.props.splice(j, 1);
  }
  function propsNear(x0, y0, x1, y1, fn) {
    const pad = 60;
    const cx0 = Math.floor((x0 - pad) / CELL), cx1 = Math.floor((x1 + pad) / CELL);
    const cy0 = Math.floor((y0 - pad) / CELL), cy1 = Math.floor((y1 + pad) / CELL);
    for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) {
      const arr = MF.G.propGrid.get(pkey(cx, cy));
      if (arr) for (const p of arr) if (fn(p) === false) return;
    }
  }
  function propCircleHit(x, y, r) {
    let hit = null;
    propsNear(x - r, y - r, x + r, y + r, (p) => {
      if (p.shape === 'circle' ? U.dist(x, y, p.x, p.y) < r + p.r
                               : U.circleRect(x, y, r, p.x - p.w / 2, p.y - p.h / 2, p.w, p.h)) { hit = p; return false; }
    });
    return hit;
  }
  function propRay(x0, y0, x1, y1) {
    let best = null;
    propsNear(Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1), (p) => {
      const t = p.shape === 'circle' ? U.segCircle(x0, y0, x1, y1, p.x, p.y, p.r)
                                     : U.segRect(x0, y0, x1, y1, p.x - p.w / 2, p.y - p.h / 2, p.w, p.h);
      if (t >= 0 && (!best || t < best.t)) best = { t, p };
    });
    return best;
  }

  const PROP_DEFS = {
    tree:   { shape: 'circle', r: 17, hp: 200, mat: 'wood',  yield: 12 },
    pine:   { shape: 'circle', r: 15, hp: 180, mat: 'wood',  yield: 12 },
    cactus: { shape: 'circle', r: 11, hp: 120, mat: 'wood',  yield: 8 },
    rock:   { shape: 'circle', r: 26, hp: 320, mat: 'brick', yield: 10 },
    car:    { shape: 'rect',   w: 74, h: 38,  hp: 420, mat: 'metal', yield: 9 },
  };
  function makeProp(type, x, y, extra = {}) {
    const d = PROP_DEFS[type];
    const p = { type, x, y, shape: d.shape, r: d.r, w: d.w, h: d.h, hp: d.hp, max: d.hp, mat: d.mat, yield: d.yield,
                seed: Math.random(), hitT: -9, ...extra };
    if (extra.vertical) { p.w = d.h; p.h = d.w; }
    return p;
  }

  // ---------- loot ----------
  let lootId = 1;
  function makeWeapon(id, rarity) {
    const def = MF.WEAPONS[id];
    return { type: 'weapon', id, rarity, ammo: def.mag };
  }
  function makeItem(id, count) {
    const def = MF.ITEMS[id];
    return { type: 'item', id, count: count || def.stack };
  }
  function randomWeapon(rarityTable) {
    return makeWeapon(U.weighted(MF.LOOT.weapons), U.weighted(rarityTable || MF.LOOT.rarity));
  }
  function randomItem() { return makeItem(U.weighted(MF.LOOT.items)); }
  function dropLoot(x, y, inst) {
    const a = U.rand(Math.PI * 2), d = U.rand(6, 26);
    MF.G.loot.push({ id: lootId++, x: x + Math.cos(a) * d, y: y + Math.sin(a) * d, inst, t: U.rand(10) });
  }
  function addChest(x, y) {
    MF.G.chests.push({ x, y, opened: false, prog: 0, sparkle: U.rand(10) });
  }

  // ---------- generation ----------
  function generate(seed) {
    const G = MF.G;
    G.tiles = new Uint8Array(NT * NT);
    G.props = []; G.propGrid = new Map(); G.chests = []; G.loot = []; G.pois = []; G.houses = [];
    const elev = U.makeNoise(seed), bio = U.makeNoise(seed * 7 + 3), det = U.makeNoise(seed * 13 + 1);

    // 1) Base terrain: island with falloff at the edges
    for (let ty = 0; ty < NT; ty++) for (let tx = 0; tx < NT; tx++) {
      const d = Math.hypot(tx - NT / 2, ty - NT / 2) / (NT / 2);
      let e = elev(tx * 0.05, ty * 0.05) + (det(tx * 0.2, ty * 0.2) - 0.5) * 0.08;
      e = e + 0.12 - Math.max(0, d - 0.74) * 2.2;
      const b = bio(tx * 0.028, ty * 0.028);
      let t;
      if (e < 0.36) t = T.WATER;
      else if (e < 0.395) t = T.SAND;
      else if (e > 0.70) t = T.SNOW;
      else if (b > 0.63) t = T.DESERT;
      else if (b < 0.38) t = T.FOREST;
      else t = T.GRASS;
      G.tiles[ty * NT + tx] = t;
    }

    // 2) POIs
    const names = [...MF.POI_NAMES].sort(() => Math.random() - 0.5);
    for (let tries = 0; tries < 400 && G.pois.length < 8; tries++) {
      const x = U.rand(700, WORLD - 700), y = U.rand(700, WORLD - 700);
      const t = tileAt(x, y);
      if (t === T.WATER || t === T.SAND) continue;
      if (G.pois.some((p) => U.dist(p.x, p.y, x, y) < 950)) continue;
      G.pois.push({ x, y, name: names[G.pois.length % names.length] });
    }

    // 3) Roads between POIs (nearest-neighbour chain)
    if (G.pois.length > 1) {
      const left = [...G.pois]; let cur = left.shift();
      while (left.length) {
        left.sort((a, b) => U.dist(cur.x, cur.y, a.x, a.y) - U.dist(cur.x, cur.y, b.x, b.y));
        const nxt = left.shift();
        paveRoad(cur, nxt);
        cur = nxt;
      }
    }

    // 4) Houses + chests inside POIs
    const occupied = new Set();
    for (const poi of G.pois) {
      const pcx = Math.floor(poi.x / CELL), pcy = Math.floor(poi.y / CELL);
      const want = U.randi(4, 7);
      let made = 0;
      for (let tries = 0; tries < 60 && made < want; tries++) {
        const w = U.randi(2, 3), h = U.randi(2, 3);
        const cx0 = pcx + U.randi(-6, 5), cy0 = pcy + U.randi(-6, 5);
        if (!houseFits(cx0, cy0, w, h, occupied)) continue;
        buildHouse(cx0, cy0, w, h, occupied);
        made++;
      }
    }

    // 5) Props
    for (let ty = 1; ty < NT - 1; ty++) for (let tx = 1; tx < NT - 1; tx++) {
      const t = G.tiles[ty * NT + tx];
      const x = (tx + U.rand(0.15, 0.85)) * TILE, y = (ty + U.rand(0.15, 0.85)) * TILE;
      const cellK = Math.floor(x / CELL) + ',' + Math.floor(y / CELL);
      if (occupied.has(cellK)) continue;
      if (t === T.ROAD || t === T.FLOOR || t === T.WATER || t === T.BRIDGE) {
        if (t === T.ROAD && U.chance(0.012)) addProp(makeProp('car', x, y, { vertical: U.chance(0.5), color: U.pick(['#e03131', '#1c7ed6', '#f08c00', '#2f9e44', '#f1f3f5', '#7048e8']) }));
        continue;
      }
      const r = Math.random();
      if (t === T.FOREST && r < 0.13) addProp(makeProp('tree', x, y));
      else if (t === T.GRASS && r < 0.022) addProp(makeProp('tree', x, y));
      else if (t === T.SNOW && r < 0.07) addProp(makeProp('pine', x, y));
      else if (t === T.DESERT && r < 0.025) addProp(makeProp('cactus', x, y));
      else if (r > 0.988) addProp(makeProp('rock', x, y));
    }
    // Remove props that ended up overlapping each other badly (keeps paths open)
    for (const p of [...G.props]) {
      if (p.dead) continue;
      propsNear(p.x - 40, p.y - 40, p.x + 40, p.y + 40, (q) => {
        if (q !== p && !q.dead && U.dist(p.x, p.y, q.x, q.y) < 38) removeProp(q);
      });
    }

    // 6) Outdoor chests + floor loot
    for (let i = 0; i < 26; i++) {
      const pt = randomLandPoint();
      if (pt && !propCircleHit(pt.x, pt.y, 30)) addChest(pt.x, pt.y);
    }
    for (let i = 0; i < 45; i++) {
      const pt = randomLandPoint();
      if (pt) dropLoot(pt.x, pt.y, U.chance(0.55) ? randomWeapon() : randomItem());
    }
  }

  function paveRoad(a, b) {
    let tx = Math.floor(a.x / TILE), ty = Math.floor(a.y / TILE);
    const ex = Math.floor(b.x / TILE), ey = Math.floor(b.y / TILE);
    const horizFirst = U.chance(0.5);
    const pave = (x, y) => {
      for (let o = 0; o < 2; o++) {
        const px = x + (horizFirst ? 0 : o), py = y + (horizFirst ? o : 0);
        const cur = MF.G.tiles[py * NT + px];
        if (cur === T.FLOOR) continue;
        setTile(px, py, cur === T.WATER ? T.BRIDGE : T.ROAD);
      }
    };
    const stepX = () => { while (tx !== ex) { pave(tx, ty); tx += Math.sign(ex - tx); } };
    const stepY = () => { while (ty !== ey) { pave(tx, ty); ty += Math.sign(ey - ty); } };
    if (horizFirst) { stepX(); stepY(); } else { stepY(); stepX(); }
  }

  function houseFits(cx0, cy0, w, h, occupied) {
    for (let y = cy0 - 1; y <= cy0 + h; y++) for (let x = cx0 - 1; x <= cx0 + w; x++) {
      if (occupied.has(x + ',' + y)) return false;
    }
    for (let y = cy0; y < cy0 + h; y++) for (let x = cx0; x < cx0 + w; x++) {
      const t = tileAt((x + 0.5) * CELL, (y + 0.5) * CELL);
      if (t === T.WATER || t === T.BRIDGE || t === T.ROAD) return false;
      if (x < 2 || y < 2 || x > MF.Build.N - 3 || y > MF.Build.N - 3) return false;
    }
    return true;
  }

  function buildHouse(cx0, cy0, w, h, occupied) {
    const mat = U.weighted([['wood', 5], ['brick', 4], ['metal', 1]]);
    const roof = U.pick(['#d9480f', '#1971c2', '#5f3dc4', '#2b8a3e', '#c2255c', '#e67700']);
    for (let y = cy0; y < cy0 + h; y++) for (let x = cx0; x < cx0 + w; x++) {
      occupied.add(x + ',' + y);
      const tx = x * 2, ty = y * 2;  // CELL = 2 tiles
      setTile(tx, ty, T.FLOOR); setTile(tx + 1, ty, T.FLOOR); setTile(tx, ty + 1, T.FLOOR); setTile(tx + 1, ty + 1, T.FLOOR);
    }
    const edges = [];
    for (let x = cx0; x < cx0 + w; x++) { edges.push({ k: 'h', cx: x, cy: cy0 }); edges.push({ k: 'h', cx: x, cy: cy0 + h }); }
    for (let y = cy0; y < cy0 + h; y++) { edges.push({ k: 'v', cx: cx0, cy: y }); edges.push({ k: 'v', cx: cx0 + w, cy: y }); }
    const placed = edges.map((e) => MF.Build.place(e, mat, 'world', { instant: true })).filter(Boolean);
    // Doors: knock out the middle segment of 1-2 walls
    const doors = U.randi(1, 2);
    for (let i = 0; i < doors && placed.length; i++) {
      const wall = U.pick(placed);
      wall.segs[1].state = 'dead';
    }
    MF.G.houses.push({ cx0, cy0, w, h, roof });
    // Chest + loot inside
    addChest((cx0 + U.rand(0.35, w - 0.35)) * CELL, (cy0 + U.rand(0.35, h - 0.35)) * CELL);
    const items = U.randi(1, 2);
    for (let i = 0; i < items; i++) {
      dropLoot((cx0 + U.rand(0.3, w - 0.3)) * CELL, (cy0 + U.rand(0.3, h - 0.3)) * CELL,
               U.chance(0.5) ? randomWeapon() : randomItem());
    }
  }

  function randomLandPoint(margin = 200) {
    for (let i = 0; i < 60; i++) {
      const x = U.rand(margin, WORLD - margin), y = U.rand(margin, WORLD - margin);
      const t = tileAt(x, y);
      if (t !== T.WATER && !MF.Build.circleHit(x, y, 24) && !propCircleHit(x, y, 24)) return { x, y };
    }
    return null;
  }

  // Chest loot: one weapon, one item, materials, sometimes a bonus item
  function openChest(chest) {
    chest.opened = true;
    dropLoot(chest.x, chest.y, randomWeapon(MF.LOOT.chestRarity));
    dropLoot(chest.x, chest.y, randomItem());
    if (U.chance(0.4)) dropLoot(chest.x, chest.y, randomItem());
    dropLoot(chest.x, chest.y, { type: 'mats', mat: U.pick(MF.MAT_ORDER), count: 30 });
    MF.Render && MF.Render.burst(chest.x, chest.y, '#ffd43b', 22, 200);
  }

  // Pre-render the island for the minimap
  function renderMinimap(size) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    const s = size / NT;
    for (let ty = 0; ty < NT; ty++) for (let tx = 0; tx < NT; tx++) {
      g.fillStyle = COLORS[MF.G.tiles[ty * NT + tx]][0];
      g.fillRect(tx * s, ty * s, Math.ceil(s), Math.ceil(s));
    }
    const k = size / WORLD;
    g.fillStyle = 'rgba(40,30,30,0.55)';
    for (const h of MF.G.houses) g.fillRect(h.cx0 * CELL * k, h.cy0 * CELL * k, h.w * CELL * k, h.h * CELL * k);
    return c;
  }

  return { T, COLORS, NT, tileAt, isWater, isLand, generate, addProp, removeProp, propsNear,
           propCircleHit, propRay, makeWeapon, makeItem, randomWeapon, randomItem, dropLoot,
           openChest, randomLandPoint, renderMinimap };
})();
