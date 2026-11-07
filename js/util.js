// ============================================================
// util.js — small math + geometry helpers shared by everything
// ============================================================
MF.U = (() => {
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const dist = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);
  const rand = (a = 1, b) => (b === undefined ? Math.random() * a : a + Math.random() * (b - a));
  const randi = (a, b) => Math.floor(rand(a, b + 1));
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const chance = (p) => Math.random() < p;

  function angleDiff(a, b) {
    let d = b - a;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return d;
  }

  // Weighted pick from [[value, weight], ...]
  function weighted(table) {
    let total = 0;
    for (const [, w] of table) total += w;
    let r = Math.random() * total;
    for (const [v, w] of table) { if ((r -= w) <= 0) return v; }
    return table[table.length - 1][0];
  }

  function gauss() {
    return (Math.random() + Math.random() + Math.random() - 1.5) / 1.5;
  }

  // ---- Seeded value noise (for terrain) ----
  function makeNoise(seed) {
    const perm = new Uint8Array(512);
    let s = seed >>> 0 || 1;
    const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    const p = [...Array(256).keys()];
    for (let i = 255; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
    for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
    const val = (x, y) => perm[(perm[x & 255] + y) & 511] / 255;
    const smooth = (t) => t * t * (3 - 2 * t);
    function noise(x, y) {
      const xi = Math.floor(x), yi = Math.floor(y);
      const xf = smooth(x - xi), yf = smooth(y - yi);
      const a = val(xi, yi), b = val(xi + 1, yi), c = val(xi, yi + 1), d = val(xi + 1, yi + 1);
      return lerp(lerp(a, b, xf), lerp(c, d, xf), yf);
    }
    return function fbm(x, y, oct = 4) {
      let v = 0, amp = 0.5, f = 1, norm = 0;
      for (let i = 0; i < oct; i++) { v += noise(x * f, y * f) * amp; norm += amp; amp *= 0.5; f *= 2; }
      return v / norm;
    };
  }

  // Cheap deterministic hash for per-tile colour variation
  const hash2 = (x, y) => {
    let h = (x * 374761393 + y * 668265263) | 0;
    h = (h ^ (h >>> 13)) * 1274126177;
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };

  // ---- Geometry ----
  function circleRect(cx, cy, r, rx, ry, rw, rh) {
    const nx = clamp(cx, rx, rx + rw), ny = clamp(cy, ry, ry + rh);
    const dx = cx - nx, dy = cy - ny;
    return dx * dx + dy * dy < r * r;
  }

  // Segment p0->p1 vs circle; returns t in [0,1] of first hit or -1
  function segCircle(x0, y0, x1, y1, cx, cy, r) {
    const dx = x1 - x0, dy = y1 - y0;
    const fx = x0 - cx, fy = y0 - cy;
    const a = dx * dx + dy * dy;
    if (a === 0) return -1;
    const b = 2 * (fx * dx + fy * dy);
    const c = fx * fx + fy * fy - r * r;
    if (c < 0) return 0;
    let disc = b * b - 4 * a * c;
    if (disc < 0) return -1;
    disc = Math.sqrt(disc);
    const t = (-b - disc) / (2 * a);
    return t >= 0 && t <= 1 ? t : -1;
  }

  // Segment vs axis-aligned rect (Liang–Barsky); returns entry t or -1
  function segRect(x0, y0, x1, y1, rx, ry, rw, rh) {
    const dx = x1 - x0, dy = y1 - y0;
    let t0 = 0, t1 = 1;
    const p = [-dx, dx, -dy, dy];
    const q = [x0 - rx, rx + rw - x0, y0 - ry, ry + rh - y0];
    for (let i = 0; i < 4; i++) {
      if (p[i] === 0) { if (q[i] < 0) return -1; }
      else {
        const t = q[i] / p[i];
        if (p[i] < 0) { if (t > t1) return -1; if (t > t0) t0 = t; }
        else { if (t < t0) return -1; if (t < t1) t1 = t; }
      }
    }
    return t0;
  }

  function pointRectDist(px, py, rx, ry, rw, rh) {
    const nx = clamp(px, rx, rx + rw), ny = clamp(py, ry, ry + rh);
    return Math.hypot(px - nx, py - ny);
  }

  const fmtTime = (s) => {
    s = Math.max(0, Math.ceil(s));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  };

  return { clamp, lerp, dist, rand, randi, pick, chance, angleDiff, weighted, gauss,
           makeNoise, hash2, circleRect, segCircle, segRect, pointRectDist, fmtTime };
})();
