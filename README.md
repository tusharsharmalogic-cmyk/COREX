# COREX

A fast-paced **2D top-down deathmatch shooter** built with **Phaser 3**, designed to run in the browser — optimised for **mobile (touch)** and **desktop (keyboard + mouse)**.

---

## Features

- **Procedural map** — 42 x 42 tiles with structured zones:
  - Jungle — dense trees, natural cover
  - Desert — open sand, rocks and bunkers
  - City — concrete blocks, alleys, crates
  - Compound — walled military area with internal cover
  - Open — grass connectors with scattered cover
- **7 weapons** with unique stats (damage, fire rate, spread, mag size):

  | Key      | Name   | Type           |
  |----------|--------|----------------|
  | pistol   | P92    | Pistol         |
  | smg      | UMP9   | SMG            |
  | ak47     | AK47   | Assault Rifle  |
  | m416     | M416   | Assault Rifle  |
  | shotgun  | S686   | Shotgun        |
  | sniper   | Kar98k | Sniper         |
  | lmg      | M249   | LMG            |

- **Dual-weapon loadout** — carry two guns, swap on the fly
- **Loot system** — weapons, ammo, armor, health pickups
- **Bot AI** — pathfinding-driven bots (1-10 per match)
- **Deathmatch modes** — Timed or Last Standing
- **Mobile-first** — on-screen joystick + fire controls
- **Desktop support** — WASD + mouse aim/shoot

---

## Project Structure

    COREX/
    ├── index.html          Main entry — game shell + lobby UI
    ├── phaser.min.js       Phaser 3 (bundled)
    ├── server.py           Flask dev server
    ├── weapons.json        Weapon stats config
    ├── js/
    │   ├── main.js         Core game / map generator
    │   ├── lobby.js        Lobby and match setup
    │   ├── weapons.js      Weapon logic
    │   ├── pickups.js      Loot system
    │   ├── Enemy.js        Bot entity
    │   ├── Pathfinder.js   A* pathfinding
    │   ├── joystick.js     Touch joystick
    │   └── bot_ai.json     Bot behaviour config
    └── assets/
        ├── player/         Player sprites
        ├── enemies/        Enemy sprites
        ├── weapons/        Gun sprites
        ├── maps/           Tile / map textures
        ├── audio/          SFX (gunshots etc.)
        └── ui/             UI icons and overlays

---

## Getting Started

### Option 1 — Run locally (Termux / Linux / macOS)

Install Flask (once):

    pip install flask

Start the dev server:

    cd COREX
    python server.py

Then open **http://localhost:8080** in your browser.

### Option 2 — Any static server

Since it is plain HTML + JS, any static server works:

    python -m http.server 8080
    # or
    npx serve .

> Note: opening `index.html` directly via `file://` will NOT work — the game fetches `weapons.json` and assets over HTTP.

---

## Controls

### Mobile (touch)

- Left joystick — move
- Right joystick / fire button — aim and shoot
- Swap button — switch between the two equipped weapons

### Desktop (keyboard + mouse)

- WASD / Arrow keys — move
- Mouse — aim
- Left click — shoot
- Q / 1 / 2 — swap weapons
- R — reload

(Exact bindings may vary — see `js/main.js`.)

---

## How to Play

1. Open the game — the lobby appears.
2. Enter your name.
3. Choose Deathmatch, then pick:
   - Timed — set match duration in minutes
   - Last Standing — survive till the end
4. Set bot count (1-10).
5. Click Start, drop into the map and fight.

Goal: eliminate all bots (Last Standing) or score the most kills before the timer ends (Timed mode).

---

## Tech Stack

- Phaser 3 — 2D game engine
- Vanilla JS — no build step, no bundler
- Flask — lightweight dev server (Python)
- A* Pathfinding — custom implementation in `js/Pathfinder.js`

---

## Config and Tweaking

- Weapons — edit `weapons.json` (damage, fireRate, magSize, spread, reloadTime, etc.)
- Bot behaviour — edit `js/bot_ai.json`
- Map size / zones — tweak `MAP_COLS`, `MAP_ROWS` and zone logic in `js/main.js`

---

## License

This project is open-source — feel free to fork, learn from, or build on it. Add a `LICENSE` file (e.g. MIT) to formalise it.

---

## Credits

Built with care by [@tusharsharmalogic-cmyk](https://github.com/tusharsharmalogic-cmyk)