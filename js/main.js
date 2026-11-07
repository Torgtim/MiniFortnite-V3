// ============================================================
// main.js — boot + game loop
// ============================================================
(() => {
  const canvas = document.getElementById('game');
  MF.Render.init(canvas);
  MF.Input.init(canvas);
  MF.UI.init();

  let last = 0;
  function frame(ts) {
    const dt = Math.min(0.05, last ? (ts - last) / 1000 : 0.016);
    last = ts;
    MF.Match.update(dt);
    MF.Render.draw(dt);
    MF.UI.update(dt);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // Debug helpers (handy for testing in the console)
  MF.debug = {
    // simulate N seconds instantly
    skip(seconds, step = 1 / 30) { for (let t = 0; t < seconds; t += step) { MF.Match.update(step); } },
    alive: () => MF.G.fighters.filter((f) => f.alive).map((f) => `${f.name} ${Math.ceil(f.hp)}hp ${f.kills}k [${f.brain ? f.brain.mode : f.state}]`),
  };
})();
