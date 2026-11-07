// ============================================================
// Mini-Fortnite V3 — config.js
// All tunable numbers live here so balancing never means
// digging through game logic.
// ============================================================
window.MF = window.MF || {};

MF.CFG = {
  WORLD: 4800,          // world is WORLD x WORLD px
  TILE: 48,             // terrain tile size
  CELL: 96,             // build grid cell size (walls sit on cell edges)
  WALL_T: 10,           // wall thickness
  BOTS: 24,             // solo: bots per match (+ you = 25)
  DUO_BOTS: 25,         // duo: your bot teammate + 12 bot duos = 13 teams

  PLAYER_R: 16,
  RUN_SPEED: 235,       // px / s
  WATER_SLOW: 0.55,
  USE_SLOW: 0.55,       // speed while healing

  BUILD_RANGE: 360,
  EDIT_RANGE: 360,
  WALL_COST: 10,
  MAT_MAX: 999,

  BUS_SPEED: 360,
  GLIDE_SPEED: 320,
  GLIDE_TIME: 8,        // seconds from jump to landing

  PICKAXE: { dmg: 20, structDmg: 50, rate: 0.42, reach: 62 },

  VISION: 700,          // bot sight range
  HEAR: 1100,           // bot hearing range for gunshots
};

MF.MATERIALS = {
  wood:  { name: 'Wood',  hp: 150, build: 0.55, color: '#d08a3e', dark: '#8a5422', light: '#f0b06a' },
  brick: { name: 'Brick', hp: 300, build: 1.05, color: '#cf5a43', dark: '#7d2c1f', light: '#f08a70' },
  metal: { name: 'Metal', hp: 450, build: 1.6,  color: '#a9bccd', dark: '#57697b', light: '#dbe8f3' },
};
MF.MAT_ORDER = ['wood', 'brick', 'metal'];

MF.RARITIES = [
  { name: 'Common',    color: '#b4bcc4', mult: 1.00 },
  { name: 'Uncommon',  color: '#4fd34f', mult: 1.06 },
  { name: 'Rare',      color: '#36a6ff', mult: 1.12 },
  { name: 'Epic',      color: '#c25cff', mult: 1.18 },
  { name: 'Legendary', color: '#ffb21e', mult: 1.25 },
];

// ---- 6 guns ----
// rate = seconds between shots, range in px, struct = damage multiplier vs builds
MF.WEAPONS = {
  ar:      { name: 'Assault Rifle',   short: 'AR',   dmg: 30, rate: 0.17, speed: 1500, spread: 0.045, pellets: 1, mag: 30, reload: 2.2, range: 950,  struct: 1.0, len: 26, pref: 420 },
  shotgun: { name: 'Pump Shotgun',    short: 'PUMP', dmg: 11, rate: 0.95, speed: 1150, spread: 0.30,  pellets: 9, mag: 5,  reload: 3.4, range: 380,  struct: 0.9, len: 22, pref: 140 },
  smg:     { name: 'SMG',             short: 'SMG',  dmg: 15, rate: 0.085,speed: 1300, spread: 0.11,  pellets: 1, mag: 30, reload: 2.0, range: 620,  struct: 1.0, len: 18, pref: 260 },
  sniper:  { name: 'Sniper Rifle',    short: 'SNIPE',dmg: 105,rate: 1.6,  speed: 2800, spread: 0.0,   pellets: 1, mag: 1,  reload: 2.6, range: 2200, struct: 1.2, len: 34, pref: 800 },
  pistol:  { name: 'Pistol',          short: 'PISTOL',dmg: 24,rate: 0.22, speed: 1300, spread: 0.06,  pellets: 1, mag: 16, reload: 1.3, range: 750,  struct: 1.0, len: 14, pref: 330 },
  rocket:  { name: 'Rocket Launcher', short: 'RPG',  dmg: 85, rate: 1.8,  speed: 760,  spread: 0.0,   pellets: 1, mag: 1,  reload: 3.0, range: 1500, struct: 1.0, len: 30, pref: 500,
             rocket: true, splash: 130, structDmg: 420 },
};

// ---- 3 mobility + 6 other items ----
MF.ITEMS = {
  // mobility
  launchpad: { name: 'Launch Pad',  kind: 'mobility', stack: 1,  max: 2,  color: '#38e0ff' },
  grappler:  { name: 'Grappler',    kind: 'mobility', stack: 8,  max: 15, color: '#ff4fd8', range: 650 },
  shockwave: { name: 'Shockwave',   kind: 'mobility', stack: 2,  max: 6,  color: '#7d5cff', radius: 230, fuse: 0.7 },
  // other
  bandage:   { name: 'Bandages',    kind: 'heal',   stack: 5, max: 15, heal: 15, cap: 75,  time: 1.6, color: '#f4f4f4' },
  medkit:    { name: 'Medkit',      kind: 'heal',   stack: 1, max: 3,  heal: 100, cap: 100, time: 4.5, color: '#ff5a5a' },
  minishield:{ name: 'Mini Shield', kind: 'shield', stack: 3, max: 6,  shield: 25, cap: 50,  time: 1.4, color: '#4fb4ff' },
  bigshield: { name: 'Shield Potion',kind: 'shield',stack: 1, max: 3,  shield: 50, cap: 100, time: 4.0, color: '#2f6bff' },
  grenade:   { name: 'Grenade',     kind: 'throw',  stack: 3, max: 6,  dmg: 95, radius: 150, structDmg: 350, fuse: 1.4, color: '#5aa83c' },
  portafort: { name: 'Port-a-Fort', kind: 'throw',  stack: 1, max: 2,  fuse: 0.6, color: '#c9d3dc' },
};

// Loot tables: [id, weight]
MF.LOOT = {
  weapons: [['ar', 26], ['shotgun', 24], ['smg', 20], ['pistol', 18], ['sniper', 8], ['rocket', 4]],
  items:   [['bandage', 20], ['minishield', 20], ['medkit', 8], ['bigshield', 9], ['grenade', 12],
            ['portafort', 6], ['launchpad', 6], ['grappler', 7], ['shockwave', 7]],
  rarity:  [[0, 34], [1, 30], [2, 20], [3, 11], [4, 5]],
  chestRarity: [[1, 32], [2, 34], [3, 22], [4, 12]],
};

// Storm circles: wait (s), shrink (s), target radius, damage per second
MF.STORM = [
  { wait: 40, shrink: 35, r: 1700, dps: 1 },
  { wait: 35, shrink: 30, r: 1050, dps: 2 },
  { wait: 30, shrink: 25, r: 600,  dps: 4 },
  { wait: 25, shrink: 20, r: 300,  dps: 6 },
  { wait: 20, shrink: 18, r: 110,  dps: 8 },
  { wait: 15, shrink: 15, r: 0,    dps: 10 },
];

MF.BOT_NAMES = [
  'TurboTaco', 'PixelPete', 'xX_Sweaty_Xx', 'NoobSlayer42', 'CrankKing', 'BoxFightBob',
  'LlamaDrama', 'SniperSusan', 'MetalMike', 'RampRusher', 'BushCamper', 'DefaultDan',
  'EditGod_99', 'ChugJugger', 'StormChaser', 'LootGoblin', 'PumpPrincess', 'NoScopeNils',
  'BuildBro', 'WoodWallWill', 'Kebabmann', 'GrillGutten', 'FjellTroll', 'Brunost_Blaster',
  'OstePop', 'VikingVibes', 'LagSwitchLars', 'TiltedTom', 'SweatyBetty', 'CampingCarl',
  'TryhardTina', 'ZeroBuildZoe', 'ShieldSam', 'RocketRita', 'SMGSpammer', 'PeelyFan',
];

MF.SKIN_COLORS = [
  '#ff6b6b', '#ffa94d', '#ffd43b', '#69db7c', '#38d9a9', '#4dabf7', '#748ffc',
  '#da77f2', '#f783ac', '#a9e34b', '#ff922b', '#22b8cf', '#e64980', '#845ef7',
];

MF.POI_NAMES = [
  'Salty Shores', 'Pleasant Pines', 'Rusty Yard', 'Neon Plaza', 'Tiny Towers',
  'Frosty Farm', 'Lazy Lagoon', 'Boom Base', 'Cheesy Hills',
];
