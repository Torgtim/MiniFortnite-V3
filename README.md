# Mini-Fortnite V3

A mobile-first 2D battle royale made by **Spakkraft**. The game is built around Fortnite's core loop: drop from the battle bus, loot, build, edit, and outlast 24 smart bots before the storm closes in.

**Play:** https://torgtim.github.io/MiniFortnite-V3/

## Features
- **Battle Bus.** It flies across the island. Jump when you want, then glide to where you want to land.
- **Three modes in the corner bar.**
  - **FIGHT:** shoot your gun, or use the pickaxe (20 damage up close; it also harvests materials from trees, rocks, cars and *other players' builds*).
  - **BUILD:** tap a spot to show a wall preview, then tap it again (or press ✓) to build it. ↻ rotates the preview 90°. You choose between Wood, Brick and Metal.
  - **EDIT:** your walls show 2 lines that split them into 3 parts. Tap a part to remove it, and tap it again to put it back.
- **Six guns:** Assault Rifle, Pump Shotgun, SMG, Sniper, Pistol and Rocket Launcher, in 5 rarities.
- **Three mobility items:** Launch Pad, Grappler and Shockwave.
- **Six other items:** Bandages, Medkit, Mini Shield, Shield Potion, Grenade and Port-a-Fort.
- **Chests:** hold the button to open them.
- **Bot AI.** Bots have personalities (aggressive, cautious, builder). They loot, rotate with the storm and hunt you *and each other*. In a fight they pick the right gun for the range, strafe, wall up when they get shot, box up to heal, edit-peek out of their own walls and pickaxe through walls that block them.
- **Storm.** It moves through 6 circles, and the damage goes up each time.
- **Minimap.** Tap it to make it bigger.
- **Spectating.** When you die you can choose PLAY AGAIN or SPECTATE (you'll be watching a bot 🤣).

## Controls
| | Mobile | PC |
|---|---|---|
| Move | Left stick | WASD |
| Aim + shoot | Drag on the right side (tap for a quick auto-aim shot) | Mouse |
| Slots | Tap the hotbar (tap the active slot again to reload) | 1–5, mouse wheel, R to reload |
| Pickaxe | ⛏ button | F |
| Build / Edit | Mode bar | Q / G |
| Rotate / material | Build bar | R / Z X C |
| Open chest | Hold the button | Hold E |
| Jump from bus | JUMP! | Space |
| Map | Tap the minimap | M |

## Code layout
Plain JavaScript with no build step. Every file adds one module to the shared `MF` namespace.

| File | What it does |
|---|---|
| `js/config.js` | All balancing numbers: weapons, items, materials, storm and loot tables |
| `js/util.js` | Math, noise and geometry helpers |
| `js/build.js` | Grid walls with 3 segments each; place, edit, damage and collision |
| `js/world.js` | Island generation, POIs, houses, props, chests and loot |
| `js/fighter.js` | Movement, inventory and damage, shared by the player and the bots |
| `js/combat.js` | Guns, bullets, explosions, pickaxe and throwables |
| `js/items.js` | Heals, shields, mobility items, launch pads, chests and pickups |
| `js/ai.js` | Bot brains |
| `js/match.js` | Battle bus, gliding, storm, eliminations, victory and spectating |
| `js/input.js` | Touch sticks, taps, keyboard and mouse |
| `js/render.js` | Everything drawn on the canvas |
| `js/ui.js` | HUD, minimap, menus and the death/spectate screens |
| `js/main.js` | Boot and the game loop |

Console debug helpers: `MF.debug.skip(30)` fast-forwards 30 seconds, and `MF.debug.alive()` lists the fighters that are still alive.
