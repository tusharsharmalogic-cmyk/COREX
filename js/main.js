// ============================================
// COREX - Deathmatch
//  - Big procedural map (200 x 150 tiles)
//  - Lobby-driven (name, mode, bots)
//  - Dual weapons, loot, armor, health, ammo
//  - Last-standing or timed match
// ============================================

// ---- World constants ----
const TILE_SIZE     = 48;
const MAP_COLS      = 42;
const MAP_ROWS      = 42;
const RENDER_TILE   = 8;   // map texture drawn at 8px/tile then scaled up

const PLAYER_SCALE  = 0.07;   // 512 × 0.07 = ~36px, fits comfortably in 48px tiles
const GUN_DISPLAY_W = 70;
const MOUNT_OFFSET  = -GUN_DISPLAY_W / 2;

const TILE_COLORS = {
  grass:    0x4a7c3a,
  jungle:   0x1e4d14,
  sand:     0xc9a96e,
  concrete: 0x6e6e64,
  road:     0x3a3a3a,
  // (water removed from gameplay)
  building: 0x1a1a1a,
};

// ============================================
// MapGenerator — Structured Zones + Cover System
//
//  Zone layout (each run randomized but structured):
//    JUNGLE   — dense trees, natural cover clusters
//    DESERT   — open sand with rock formations & bunkers
//    CITY     — concrete blocks, alleys, L-walls, crates
//    COMPOUND — walled military area with internal cover
//    OPEN     — grass connectors with scattered cover
//
//  Cover obstacle types:
//    building  — solid large block (walls, structures)
//    wall      — thin long barrier (cover wall)
//    crate     — small square cover box
//    barrier   — medium rectangular cover
//    tree      — round natural cover
//    rock      — small round natural obstacle
//    bunker    — U-shaped or L-shaped cover structure
// ============================================
class MapGenerator {
  constructor(seed) {
    this.seed = seed;
    this.rng = new Phaser.Math.RandomDataGenerator([seed]);
    this.tileSize = TILE_SIZE;
    this.cols = MAP_COLS;
    this.rows = MAP_ROWS;
    this.width = this.cols * this.tileSize;
    this.height = this.rows * this.tileSize;
    this.grid = [];
    this.props = [];
    // Track occupied cells to avoid prop overlap
    this._occupied = new Set();
  }

  // ============================================
  // MAIN GENERATE
  // ============================================
  generate() {
    // Fill base with grass
    for (let y = 0; y < this.rows; y++) {
      this.grid[y] = new Array(this.cols).fill('grass');
    }

    // 1. Paint zone terrain blobs (soft, overlapping is fine)
    this._paintZones();

    // 2. Place structured city districts
    this._placeCityDistricts();

    // 3. Place military compound
    this._placeCompound();

    // 4. Add cover in open zones
    this._placeOpenCover();

    // 5. Scatter natural props (trees, rocks) in terrain zones
    this._scatterNaturalProps();

    return this;
  }

  // ============================================
  // TERRAIN ZONES
  // ============================================
  _paintZones() {
    // Jungle blobs — large, 2-3 zones
    const numJungle = this.rng.between(2, 3);
    for (let i = 0; i < numJungle; i++) {
      this._paintBlob('jungle',
        this.rng.between(5, this.cols - 5),
        this.rng.between(5, this.rows - 5),
        this.rng.between(7, 12));
    }

    // Desert blobs — 1-2 zones
    const numDesert = this.rng.between(1, 2);
    for (let i = 0; i < numDesert; i++) {
      this._paintBlob('sand',
        this.rng.between(5, this.cols - 5),
        this.rng.between(5, this.rows - 5),
        this.rng.between(5, 10));
    }

    // Water removed — replaced by grass (no water bodies in this map).
  }

  _paintBlob(type, cx, cy, radius) {
    for (let y = 0; y < this.rows; y++) {
      for (let x = 0; x < this.cols; x++) {
        const d = Math.hypot(x - cx, y - cy);
        const jitter = (this.rng.frac() - 0.5) * 1.5;
        if (d + jitter < radius) this.grid[y][x] = type;
      }
    }
  }

  // ============================================
  // CITY DISTRICTS — structured with alleys + cover
  // ============================================
  _placeCityDistricts() {
    // Place 2 city districts at different quadrants
    const quadrants = this._shuffled([
      { cx: Math.floor(this.cols * 0.25), cy: Math.floor(this.rows * 0.25) },
      { cx: Math.floor(this.cols * 0.75), cy: Math.floor(this.rows * 0.25) },
      { cx: Math.floor(this.cols * 0.25), cy: Math.floor(this.rows * 0.75) },
      { cx: Math.floor(this.cols * 0.75), cy: Math.floor(this.rows * 0.75) },
    ]);

    const numDistricts = this.rng.between(1, 2);
    for (let d = 0; d < numDistricts; d++) {
      const q = quadrants[d];
      const bw = this.rng.between(9, 13);
      const bh = this.rng.between(9, 13);
      const bx = Math.max(2, Math.min(this.cols - bw - 2, q.cx - Math.floor(bw / 2)));
      const by = Math.max(2, Math.min(this.rows - bh - 2, q.cy - Math.floor(bh / 2)));

      // Paint concrete ground
      for (let y = by; y < by + bh; y++)
        for (let x = bx; x < bx + bw; x++)
          this.grid[y][x] = 'concrete';

      // Road grid inside the district (cross pattern)
      const midX = bx + Math.floor(bw / 2);
      const midY = by + Math.floor(bh / 2);
      for (let y = by; y < by + bh; y++) this.grid[y][midX] = 'road';
      for (let x = bx; x < bx + bw; x++) this.grid[midY][x] = 'road';

      // Place buildings in each quadrant of the district
      this._placeCityBuildings(bx, by, bw, bh, midX, midY);

      // Alley cover — walls along road sides
      this._placeCityAlleyCovers(bx, by, bw, bh, midX, midY);
    }
  }

  _placeCityBuildings(bx, by, bw, bh, midX, midY) {
    const quads = [
      { x1: bx,     y1: by,     x2: midX - 1, y2: midY - 1 },
      { x1: midX+1, y1: by,     x2: bx+bw-1,  y2: midY - 1 },
      { x1: bx,     y1: midY+1, x2: midX - 1, y2: by+bh-1  },
      { x1: midX+1, y1: midY+1, x2: bx+bw-1,  y2: by+bh-1  },
    ];

    for (const q of quads) {
      const qw = q.x2 - q.x1 + 1;
      const qh = q.y2 - q.y1 + 1;
      if (qw < 3 || qh < 3) continue;

      const numB = this.rng.between(1, 2);
      for (let i = 0; i < numB; i++) {
        const pw = this.rng.between(2, Math.min(3, qw - 1));
        const ph = this.rng.between(2, Math.min(3, qh - 1));
        const px = this.rng.between(q.x1, q.x2 - pw + 1);
        const py = this.rng.between(q.y1, q.y2 - ph + 1);

        // No road tile overlap
        let hasRoad = false;
        for (let y = py; y < py + ph; y++)
          for (let x = px; x < px + pw; x++)
            if (this.grid[y][x] === 'road') hasRoad = true;
        if (hasRoad) continue;

        // Grid-locked placement (does overlap + bounds check internally)
        if (!this._addProp(px, py, pw, ph, 'building')) continue;

        // Paint terrain as building
        for (let y = py; y < py + ph; y++)
          for (let x = px; x < px + pw; x++)
            this.grid[y][x] = 'building';
      }
    }
  }

  _placeCityAlleyCovers(bx, by, bw, bh, midX, midY) {
    // 2-3 crates at road intersections (1x1 tile each, grid-locked)
    const cratePositions = [
      { tx: midX - 2, ty: midY - 1 },
      { tx: midX + 2, ty: midY + 1 },
      { tx: midX - 1, ty: midY + 2 },
    ];
    let placed = 0;
    for (const cp of cratePositions) {
      if (placed >= 2) break;
      if (!this.isWalkableTile(cp.tx, cp.ty)) continue;
      if (this.grid[cp.ty][cp.tx] === 'road') continue;
      if (!this._addProp(cp.tx, cp.ty, 1, 1, 'crate')) continue;
      placed++;
    }
  }

  // ============================================
  // MILITARY COMPOUND — walled area with inner cover
  // ============================================
  _placeCompound() {
    const cw = 10, ch = 10;
    const cx = this.rng.between(Math.floor(this.cols * 0.4), Math.floor(this.cols * 0.6) - cw);
    const cy = this.rng.between(Math.floor(this.rows * 0.4), Math.floor(this.rows * 0.6) - ch);
    const ts = this.tileSize;

    // Ground: concrete
    for (let y = cy; y < cy + ch; y++)
      for (let x = cx; x < cx + cw; x++)
        this.grid[y][x] = 'concrete';

    // Mark perimeter tiles as building (blocked) FIRST so _addProp skips them
    for (let x = cx; x < cx + cw; x++) {
      this.grid[cy][x] = 'building';
      this.grid[cy + ch - 1][x] = 'building';
    }
    for (let y = cy + 1; y < cy + ch - 1; y++) {
      this.grid[y][cx] = 'building';
      this.grid[y][cx + cw - 1] = 'building';
    }

    // Wide entrance gaps (2 tiles each side) — carve them out
    const gapY = cy + Math.floor(ch / 2);
    this.grid[gapY][cx] = 'concrete';
    this.grid[gapY + 1][cx] = 'concrete';
    this.grid[gapY][cx + cw - 1] = 'concrete';
    this.grid[gapY + 1][cx + cw - 1] = 'concrete';
    const gapX = cx + Math.floor(cw / 2);
    this.grid[cy][gapX] = 'concrete';
    this.grid[cy][gapX + 1] = 'concrete';
    this.grid[cy + ch - 1][gapX] = 'concrete';
    this.grid[cy + ch - 1][gapX + 1] = 'concrete';

    // Place perimeter wall props on the surviving building tiles (grid-locked)
    // Top wall — split into 2 segments around the gap
    this._addWallRow(cx, cy, gapX - cx, 1);
    this._addWallRow(gapX + 2, cy, cx + cw - (gapX + 2), 1);
    // Bottom wall
    this._addWallRow(cx, cy + ch - 1, gapX - cx, 1);
    this._addWallRow(gapX + 2, cy + ch - 1, cx + cw - (gapX + 2), 1);
    // Left wall
    this._addWallCol(cx, cy + 1, gapY - (cy + 1), 1);
    this._addWallCol(cx, gapY + 2, (cy + ch - 1) - (gapY + 2), 1);
    // Right wall
    this._addWallCol(cx + cw - 1, cy + 1, gapY - (cy + 1), 1);
    this._addWallCol(cx + cw - 1, gapY + 2, (cy + ch - 1) - (gapY + 2), 1);

    // Interior: small central building (grid-locked 2x2)
    const ibx = cx + 3, iby = cy + 3, ibw = 2, ibh = 2;
    for (let y = iby; y < iby + ibh; y++)
      for (let x = ibx; x < ibx + ibw; x++)
        this.grid[y][x] = 'building';
    this._addProp(ibx, iby, ibw, ibh, 'building');

    // 2 inner crates (grid-locked 1x1)
    const innerCrates = [
      { tx: cx + 1, ty: cy + 2 },
      { tx: cx + cw - 3, ty: cy + ch - 3 },
    ];
    for (const c of innerCrates) {
      if (!this.isWalkableTile(c.tx, c.ty)) continue;
      this._addProp(c.tx, c.ty, 1, 1, 'crate');
    }
  }

  // Place a horizontal segment of wall props (grid-locked, 1 tile tall)
  _addWallRow(tx, ty, len, thick) {
    for (let i = 0; i < len; i++) {
      this._addProp(tx + i, ty, 1, thick, 'wall');
    }
  }

  // Place a vertical segment of wall props (grid-locked, 1 tile wide)
  _addWallCol(tx, ty, len, thick) {
    for (let i = 0; i < len; i++) {
      this._addProp(tx, ty + i, thick, 1, 'wall');
    }
  }

  // (Removed: _addWallProp — replaced by grid-locked _addProp above.)

  // ============================================
  // OPEN ZONE COVER — sparse, bot-friendly clusters
  // Rule: every cover piece must have clear 2-tile
  // walkable gaps around it so bots can navigate.
  // ============================================
  _placeOpenCover() {
    const ts = this.tileSize;
    // Only 4-6 clusters total in open zones — keeps map navigable
    const numClusters = this.rng.between(2, 3);

    for (let i = 0; i < numClusters; i++) {
      // Pick candidate — ensure 4-tile clear radius before placing
      let placed = false;
      for (let attempt = 0; attempt < 30 && !placed; attempt++) {
        const tx = this.rng.between(5, this.cols - 8);
        const ty = this.rng.between(5, this.rows - 8);
        const tile = this.grid[ty][tx];
        if (tile === 'building') continue;
        if (this._isOccupied(tx, ty)) continue;
        // Ensure a 4-tile open buffer around this cluster
        if (!this._hasOpenBuffer(tx, ty, 4)) continue;

        // Only simple, non-enclosing patterns (no U-bunkers that trap bots)
        const pattern = this.rng.between(0, 3);
        switch (pattern) {
          case 0: this._placeLWall(tx, ty); break;
          case 1: this._placeCrateCluster(tx, ty); break;
          case 2: this._placeRockFormation(tx, ty); break;
          case 3: this._placeCornerBunker(tx, ty); break;
        }
        placed = true;
      }
    }

    // Extra standalone crates — max 8, well-spaced, grid-locked 1x1
    const numExtraCrates = this.rng.between(3, 4);
    for (let i = 0; i < numExtraCrates; i++) {
      for (let attempt = 0; attempt < 20; attempt++) {
        const tx = this.rng.between(3, this.cols - 4);
        const ty = this.rng.between(3, this.rows - 4);
        if (!this.isWalkableTile(tx, ty)) continue;
        if (!this._hasOpenBuffer(tx, ty, 3)) continue;
        if (!this._addProp(tx, ty, 1, 1, 'crate')) continue;
        break;
      }
    }
  }

  // Check that a (tw x th) region around (tx,ty) has enough open tiles
  _hasOpenBuffer(tx, ty, radius) {
    // Just ensure no existing occupied tile within radius
    for (let dy = -radius; dy <= radius + 2; dy++) {
      for (let dx = -radius; dx <= radius + 2; dx++) {
        const cx = tx + dx, cy = ty + dy;
        if (cx < 0 || cy < 0 || cx >= this.cols || cy >= this.rows) continue;
        if (this._isOccupied(cx, cy)) return false;
        if (this.grid[cy][cx] === 'building') return false;
      }
    }
    return true;
  }

  // L-shaped wall — 2 arms, all grid-locked 1x1 tiles
  _placeLWall(tx, ty) {
    const flip = this.rng.frac() < 0.5;
    // Horizontal arm: 2 tiles wide, 1 tall
    this._addProp(tx, ty, 2, 1, 'wall');
    // Vertical arm: 1 tile wide, 2 tall
    if (flip) {
      this._addProp(tx, ty, 1, 2, 'wall');
    } else {
      this._addProp(tx + 1, ty, 1, 2, 'wall');
    }
  }

  // Cluster of 2-3 crates — grid-locked 1x1, spaced with gaps
  _placeCrateCluster(tx, ty) {
    const offsets = [[0, 0], [2, 0], [0, 2]];
    const count = this.rng.between(2, 3);
    for (let i = 0; i < count; i++) {
      const [ox, oy] = offsets[i];
      const cx = tx + ox, cy = ty + oy;
      if (!this.isWalkableTile(cx, cy)) continue;
      this._addProp(cx, cy, 1, 1, 'crate');
    }
  }

  // Rock formation — 2-3 rocks, grid-locked 1x1, spaced with 1-tile gaps
  _placeRockFormation(tx, ty) {
    const count = this.rng.between(2, 3);
    const offsets = [[0, 0], [2, 0], [1, 2]];
    for (let i = 0; i < count; i++) {
      const [ox, oy] = offsets[i];
      const rx = tx + ox, ry = ty + oy;
      if (!this.isWalkableTile(rx, ry)) continue;
      this._addProp(rx, ry, 1, 1, 'rock');
    }
  }

  // Corner bunker — two 2-tile walls forming an L
  _placeCornerBunker(tx, ty) {
    // Horizontal arm: 2 tiles × 1 tile
    this._addProp(tx, ty, 2, 1, 'wall');
    // Vertical arm: 1 tile × 2 tiles
    this._addProp(tx, ty, 1, 2, 'wall');
  }

  // ============================================
  // NATURAL PROPS — low density, bot-passable
  // ============================================
  _scatterNaturalProps() {
    for (let y = 1; y < this.rows - 1; y++) {
      for (let x = 1; x < this.cols - 1; x++) {
        const tile = this.grid[y][x];
        if (this._isOccupied(x, y)) continue;

        if (tile === 'jungle') {
          if (this.rng.frac() < 0.05) {
            // Ensure at least one free cardinal neighbour so we never
            // completely wall off a region (grid-locked 1x1 tree).
            const free = (
              (this.isWalkableTile(x+1, y) && !this._isOccupied(x+1, y)) ||
              (this.isWalkableTile(x-1, y) && !this._isOccupied(x-1, y)) ||
              (this.isWalkableTile(x, y+1) && !this._isOccupied(x, y+1)) ||
              (this.isWalkableTile(x, y-1) && !this._isOccupied(x, y-1))
            );
            if (!free) continue;
            this._addProp(x, y, 1, 1, 'tree');
          }
        } else if (tile === 'grass') {
          if (this.rng.frac() < 0.02) {
            this._addProp(x, y, 1, 1, 'tree');
          }
        } else if (tile === 'sand') {
          if (this.rng.frac() < 0.03) {
            this._addProp(x, y, 1, 1, 'rock');
          }
        }
      }
    }
  }

  // ============================================
  // HELPERS
  // ============================================
  // ============================================
  // GRID-LOCKED PROP PLACEMENT
  // Every prop occupies an exact NxM tile rectangle.
  // No partial-tile overlap → A* walkable == physics walkable.
  // ============================================
  _addProp(tx, ty, tw, th, type) {
    // Bounds check
    if (tx < 0 || ty < 0 || tx + tw > this.cols || ty + th > this.rows) return false;
    // Overlap check against already-placed props
    for (let dy = 0; dy < th; dy++) {
      for (let dx = 0; dx < tw; dx++) {
        if (this._occupied.has((tx + dx) + ',' + (ty + dy))) return false;
      }
    }
    const ts = this.tileSize;
    this.props.push({
      x: tx * ts, y: ty * ts,          // top-left in pixels
      w: tw * ts, h: th * ts,          // full tile-aligned size
      tx, ty, tw, th,                  // tile coords kept for reference
      type,
    });
    this._markOccupied(tx, ty, tw, th);
    return true;
  }

  _markOccupied(tx, ty, w, h) {
    for (let dy = 0; dy < h; dy++)
      for (let dx = 0; dx < w; dx++)
        this._occupied.add((tx + dx) + ',' + (ty + dy));
  }

  _isOccupied(tx, ty) {
    return this._occupied.has(tx + ',' + ty);
  }

  _shuffled(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = this.rng.between(0, i);
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  isWalkableTile(tx, ty) {
    if (tx < 0 || ty < 0 || tx >= this.cols || ty >= this.rows) return false;
    const c = this.grid[ty][tx];
    return c !== 'building';
  }

  findSpawn() {
    const cx = Math.floor(this.cols / 2);
    const cy = Math.floor(this.rows / 2);
    for (let radius = 0; radius < 60; radius++) {
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const x = cx + dx, y = cy + dy;
          if (this.isWalkableTile(x, y)) {
            return {
              x: x * this.tileSize + this.tileSize / 2,
              y: y * this.tileSize + this.tileSize / 2,
            };
          }
        }
      }
    }
    return { x: this.width / 2, y: this.height / 2 };
  }

  // Returns a tile that is BOTH terrain-walkable AND free of any prop.
  // Used for pickups/spawns so nothing lands on top of a tree/crate.
  randomWalkableTile() {
    for (let i = 0; i < 400; i++) {
      const tx = this.rng.between(1, this.cols - 2);
      const ty = this.rng.between(1, this.rows - 2);
      if (!this.isWalkableTile(tx, ty)) continue;
      if (this._isOccupied(tx, ty)) continue;
      return { tx, ty };
    }
    // Fallback: scan whole grid
    for (let ty = 1; ty < this.rows - 1; ty++) {
      for (let tx = 1; tx < this.cols - 1; tx++) {
        if (this.isWalkableTile(tx, ty) && !this._isOccupied(tx, ty)) {
          return { tx, ty };
        }
      }
    }
    return { tx: 1, ty: 1 };
  }
}

// ============================================
// DeathmatchScene
// ============================================
class DeathmatchScene extends Phaser.Scene {
  constructor() { super({ key: 'DeathmatchScene' }); }

  preload() {
    this.load.image('player', 'assets/player/player.png');
    this.load.image('ak47', 'assets/weapons/ak47.png');
    this.load.image('pistol', 'assets/weapons/pistol.png');
    this.load.image('smg', 'assets/weapons/smg.png');
    this.load.image('m416', 'assets/weapons/m416.png');
    this.load.image('shotgun', 'assets/weapons/shotgun.png');
    this.load.image('sniper', 'assets/weapons/sniper.png');
    this.load.image('lmg', 'assets/weapons/lmg.png');
    this.load.json('weapons', 'weapons.json?v=' + Date.now());
    this.load.json('botai', 'js/bot_ai.json?v=' + Date.now());
    // Weapon audio
    const wkeys = ['pistol','smg','ak47','m416','shotgun','sniper','lmg'];
    wkeys.forEach(k => {
      this.load.audio('sfx_' + k, 'assets/audio/' + k + '.mp3');
    });
  }

  create() {
    // ---------- Global ----------
    window.WEAPONS = this.cache.json.get('weapons');
    window.BOT_AI  = this.cache.json.get('botai');
    this.WEAPONS = window.WEAPONS;

    // Tracer texture
    if (!this.textures.exists('tracer')) {
      const tg = this.make.graphics({ add: false });
      tg.fillStyle(0xffffff, 1);
      tg.fillRect(0, 0, 32, 4);
      tg.generateTexture('tracer', 32, 4);
      tg.destroy();
    }
    ensurePickupTextures(this);

    // Base fade (until lobby closes)
    this.ready = false;

    // Lobby → start
    Lobby.onStart = (cfg) => {
      try {
        this.startMatch(cfg);
      } catch (err) {
        console.error('[COREX] startMatch failed:', err);
        const s = document.getElementById('seed-label');
        if (s) s.innerText = 'ERR: ' + err.message;
        const ov = document.getElementById('match-overlay');
        const t  = document.getElementById('match-title');
        const su = document.getElementById('match-subtitle');
        if (t) t.innerText = 'START ERROR';
        if (su) su.innerText = err.message;
        if (ov) ov.classList.add('open');
      }
    };
    Lobby.init();

    // Player name placeholder
    this.playerName = 'PLAYER';
  }

  // ============================================
  // Match bootstrap
  // ============================================
  startMatch(cfg) {
    if (this.ready) return;
    this.ready = true;
    this.cfg = cfg;
    this.playerName = cfg.name;
    this.dmMode = cfg.dmMode;                    // 'timed' | 'last'
    this.matchDurationMs = cfg.timeLimitMin * 60 * 1000;
    this.matchStartTime = this.time.now;
    this.matchEnded = false;

    // -------- Map --------
    this.mapSeed = String(Date.now() % 1000000);
    this.mapGen = new MapGenerator(this.mapSeed).generate();
    const map = this.mapGen;
    const WORLD_W = map.width;
    const WORLD_H = map.height;

    // Pathfinder (A* on tile grid) — shared by all bots
    this.pathfinder = new Pathfinder(map);

    this.physics.world.setBounds(0, 0, WORLD_W, WORLD_H);
    this.renderMapTexture(map);

    // -------- Obstacles --------
    this.obstacles = this.physics.add.staticGroup();
    // Spatial grid for fast raycast/LOS/bullet checks.
    // Key = "tx,ty" tile index; value = array of obstacle sprites.
    this.obstacleGrid = new Map();
    this.obstacleCellPx = 128;   // px per grid cell
    this._obstacleBuckets = new Map();

    const putInGrid = (obj) => {
      const b = obj.body;
      if (!b) return;
      const cx0 = Math.floor(b.x / this.obstacleCellPx);
      const cy0 = Math.floor(b.y / this.obstacleCellPx);
      const cx1 = Math.floor((b.x + b.width) / this.obstacleCellPx);
      const cy1 = Math.floor((b.y + b.height) / this.obstacleCellPx);
      for (let cy = cy0; cy <= cy1; cy++) {
        for (let cx = cx0; cx <= cx1; cx++) {
          const key = cx + ',' + cy;
          let arr = this._obstacleBuckets.get(key);
          if (!arr) { arr = []; this._obstacleBuckets.set(key, arr); }
          arr.push(obj);
        }
      }
    };

    // ============================================
    // GRID-LOCKED PROP RENDERING
    // Every prop is drawn as a full-tile rectangle so its physics
    // body EXACTLY matches the tile rect. A* walkable == physics walkable.
    // ============================================
    map.props.forEach(p => {
      // Center of the tile rect
      const cx = p.x + p.w / 2;
      const cy = p.y + p.h / 2;

      let r = null;

      if (p.type === 'building') {
        // Full-tile dark block
        r = this.add.rectangle(cx, cy, p.w, p.h, 0x2a2a2a).setDepth(2);
        r.setStrokeStyle(3, 0x111111);

      } else if (p.type === 'wall') {
        // Full-tile concrete wall
        r = this.add.rectangle(cx, cy, p.w, p.h, 0x7a7a6a).setDepth(3);
        r.setStrokeStyle(2, 0x4a4a3a);

      } else if (p.type === 'barrier') {
        // Full-tile barrier
        r = this.add.rectangle(cx, cy, p.w, p.h, 0x8a6a4a).setDepth(3);
        r.setStrokeStyle(2, 0x5a4a2a);

      } else if (p.type === 'crate') {
        // Full-tile wooden crate with X cross
        r = this.add.rectangle(cx, cy, p.w, p.h, 0x8b5e2a).setDepth(3);
        r.setStrokeStyle(2, 0x5a3a10);
        // Diagonal cross lines (visual X)
        const g = this.add.graphics().setDepth(4);
        g.lineStyle(3, 0x5a3a10, 1);
        g.lineBetween(p.x, p.y, p.x + p.w, p.y + p.h);
        g.lineBetween(p.x + p.w, p.y, p.x, p.y + p.h);

      } else if (p.type === 'tree') {
        // Full-tile round tree (fills the tile visually)
        const t = this.add.circle(cx, cy, p.w / 2 - 2, 0x1e3d15).setDepth(3);
        t.setStrokeStyle(3, 0x0d2208);
        // Small darker trunk hint
        this.add.circle(cx, cy, p.w / 6, 0x4a2a10, 0.6).setDepth(4);
        r = t;

      } else if (p.type === 'rock') {
        // Full-tile boulder (fills the tile)
        r = this.add.ellipse(cx, cy, p.w - 4, p.h - 4, 0x7a7a7a).setDepth(3);
        r.setStrokeStyle(2, 0x4a4a4a);
        // Small highlight
        this.add.ellipse(cx - 4, cy - 4, p.w * 0.4, p.h * 0.35, 0x9a9a9a, 0.55).setDepth(4);
      }

      if (r) {
        this.physics.add.existing(r, true);
        this.obstacles.add(r);
        putInGrid(r);
      }
    });

    // -------- Bullets & pickups --------
    this.playerBullets = [];
    this.enemyBullets  = [];
    this.pickupGroup   = this.physics.add.group({ allowGravity: false, immovable: true });

    // -------- Player --------
    const spawn = map.findSpawn();
    this.player = this.physics.add.sprite(spawn.x, spawn.y, 'player');
    this.player.setScale(PLAYER_SCALE);
    this.player.setCollideWorldBounds(true);
    this.player.setDepth(10);
    this.player.setMaxVelocity(260, 260);
    this.player.body.setSize(this.player.width * 0.6, this.player.height * 0.6, true);
    this.physics.add.collider(this.player, this.obstacles);

    // Player state
    this.player.hp = 100;
    this.player.maxHp = 100;
    this.player.armor = 0;
    this.player.maxArmor = 100;
    this.player.kills = 0;
    this.player.deaths = 0;
    this.player.invulnUntil = 0;
    this.player.takeDamage = (dmg) => this.damageEntity(this.player, dmg, 300);

    // Player weapon slots
    this.playerSlots = [null, null];
    this.playerActiveSlot = 0;
    this.playerGunSprite = null;
    this.weapon = null;
    this.weaponKey = null;
    this.gunDisplayLength = 0;

    // Global ammo reserve by type: light / heavy / shells
    this.ammoReserve = { light: 0, heavy: 0, shells: 0 };

    // No starting weapon (player must find loot)

    // -------- Bots --------
    this.bots = [];
    const numBots = cfg.botCount;
    const tints = [0xff4444, 0xff8844, 0xff44cc, 0xcc44ff, 0x44ff88,
                   0x44ddff, 0xffee44, 0xff44ff, 0x88ff44, 0xffffff];
    for (let i = 0; i < numBots; i++) {
      const t = map.randomWalkableTile();
      const ex = t.tx * map.tileSize + map.tileSize / 2;
      const ey = t.ty * map.tileSize + map.tileSize / 2;
      if (Phaser.Math.Distance.Between(ex, ey, this.player.x, this.player.y) < 350) {
        i--; continue;
      }
      const bot = new Enemy(this, ex, ey, this.player, {
        cfg: window.BOT_AI,
        name: 'BOT_' + (i + 1),
        tint: tints[i % tints.length],
      });
      this.bots.push(bot);
      // No starting weapon — bots must find loot
    }

    // -------- Initial loot spawns --------
    this.spawnInitialLoot(map, 20);

    // -------- Input --------
    this.setupInputs();

    // -------- Camera --------
    this.cameras.main.setBounds(0, 0, WORLD_W, WORLD_H);
    this.cameras.main.startFollow(this.player, true, 0.12, 0.12);
    this.cameras.main.setZoom(0.7);
    this.cameras.main.setBackgroundColor(0x0a1a0a);

    this.camZoom = 0.7;
    this.camZoomTarget = 0.7;
    this.camOffsetX = 0;
    this.camOffsetY = 0;

    // -------- Toast --------
    this.toast = this.add.text(0, 0, '', {
      fontFamily: 'Arial', fontSize: '16px', color: '#27ae60',
      fontStyle: 'bold', stroke: '#000', strokeThickness: 4,
    }).setOrigin(0.5).setDepth(50).setAlpha(0);

    // -------- Minimap --------
    this.setupMinimap(map);

    // -------- Events --------
    this.events.on('enemy-killed', (x, y, bot, killer) => {
      if (killer === this.player) {
        // Player killed the bot
        this.player.kills++;
        this.updateScoreUI();
        this.showToast('KILL +1  [' + this.player.kills + ']', '#27ae60');
      } else if (killer && killer.isBot) {
        // Another bot killed it
        killer.kills++;
      }

      // Respawn bot in timed mode
      if (this.dmMode === 'timed' && !this.matchEnded) {
        this.time.delayedCall(3000, () => this.respawnBot(bot));
      }
    });

    // Update HUD initial
    this.updateHUD();

    // Match timer UI
    const seedEl = document.getElementById('seed-label');
    if (seedEl) seedEl.innerText = 'SEED ' + this.mapSeed + ' · ' + this.playerName;

    // Kick off update loop
    this.events.emit('match-started');
  }

  // ============================================
  // Inputs
  // ============================================
  setupInputs() {
    this.moveVec = { x: 0, y: 0 };
    this.aimVec  = { x: 1, y: 0 };
    this.aimAngle = 0;
    this.isFiring = false;
    this.lastFire = 0;
    this.reloadEndsAt = 0;

    const leftJoy = new VirtualJoystick(
      document.getElementById('left-joy'),
      document.getElementById('left-knob')
    );
    leftJoy.onChange = v => { this.moveVec.x = v.x; this.moveVec.y = v.y; };
    leftJoy.onRelease = () => { this.moveVec.x = 0; this.moveVec.y = 0; };

    const rightJoy = new VirtualJoystick(
      document.getElementById('right-joy'),
      document.getElementById('right-knob')
    );
    rightJoy.onChange = (v, m) => {
      if (m > 0.15) {
        const len = Math.hypot(v.x, v.y);
        if (len > 0.001) {
          this.aimVec.x = v.x / len;
          this.aimVec.y = v.y / len;
          this.aimAngle = Math.atan2(this.aimVec.y, this.aimVec.x);
        }
      }
      this.isFiring = rightJoy.fullPull;
    };
    rightJoy.onRelease = () => { this.isFiring = false; };
    this.rightJoy = rightJoy;

    // Switch button
    this.switchBtn = document.getElementById('switch-btn');
    if (this.switchBtn) {
      this.switchBtn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        this.onSwitchButton();
      });
    }

    // Muzzle flash
    this.muzzleFlash = this.add.circle(0, 0, 8, 0xf1c40f).setDepth(12).setVisible(false);
    this.aimLineGfx = this.add.graphics().setDepth(20);
  }

  // ============================================
  // Switch button logic
  // ============================================
  onSwitchButton() {
    // Case 1: standing on a weapon pickup -> swap
    const near = this.findNearbyWeaponPickup(60);
    if (near) {
      this.swapWithPickup(near);
      return;
    }
    // Case 2: just switch slots
    this.cycleActiveSlot();
  }

  findNearbyWeaponPickup(radius) {
    const list = this.pickupGroup.getChildren();
    let best = null, bestD = radius;
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      if (!p.active || p.kind !== 'weapon') continue;
      const d = Phaser.Math.Distance.Between(this.player.x, this.player.y, p.x, p.y);
      if (d < bestD) { bestD = d; best = p; }
    }
    return best;
  }

  swapWithPickup(pickup) {
    const newKey = pickup.weaponKey;
    const newAmmo = pickup.ammoInMag;

    // If empty slot available, just add
    const emptyIdx = this.playerSlots.findIndex(s => s === null);
    if (emptyIdx !== -1) {
      this.addWeaponToSlot(emptyIdx, newKey, newAmmo, pickup.reserve || 0);
      this.setActiveSlot(emptyIdx);
      pickup.destroyPickup();
      this.showToast('PICKED UP ' + WEAPONS[newKey].name, '#f1c40f');
      return;
    }

    // Otherwise replace active slot: drop current, pick new
    const cur = this.playerSlots[this.playerActiveSlot];
    if (cur) {
      // Spawn a drop of the current gun at player pos
      const dropX = this.player.x + (Math.random() - 0.5) * 40;
      const dropY = this.player.y + (Math.random() - 0.5) * 40;
      const drop = new WeaponPickup(this, dropX, dropY, cur.key, cur.ammo);
      this.pickupGroup.add(drop);
      this._preparePickupBody(drop);

      if (cur.gunSprite) cur.gunSprite.destroy();
    }

    this.playerSlots[this.playerActiveSlot] = null;
    this.addWeaponToSlot(this.playerActiveSlot, newKey, newAmmo, pickup.reserve || 0);
    pickup.destroyPickup();
    this.showToast('SWAPPED → ' + WEAPONS[newKey].name, '#f1c40f');
  }

  cycleActiveSlot() {
    const other = this.playerActiveSlot === 0 ? 1 : 0;
    if (this.playerSlots[other]) {
      this.setActiveSlot(other);
      this.showToast('SLOT ' + (other + 1) + ': ' + WEAPONS[this.playerSlots[other].key].name, '#3498db');
    } else if (this.playerSlots[this.playerActiveSlot]) {
      this.showToast('SLOT ' + (this.playerActiveSlot + 1) + ': ' +
                     WEAPONS[this.playerSlots[this.playerActiveSlot].key].name, '#3498db');
    }
  }

  addWeaponToSlot(idx, key, ammoInMag, reserve) {
    const W = WEAPONS[key];
    if (!W) return;
    const ammoType = AMMO_TYPE[key] || 'light';
    this.playerSlots[idx] = {
      key,
      weapon: W,
      ammoType,
      ammo: (typeof ammoInMag === 'number') ? ammoInMag : W.magSize,
      gunSprite: null,
    };
    // Add reserve to global ammo pool for this type
    if (reserve) {
      const cap = AMMO_INFO[ammoType].maxReserve;
      this.ammoReserve[ammoType] = Math.min(cap, (this.ammoReserve[ammoType] || 0) + reserve);
    }
    if (idx === this.playerActiveSlot) this.mountPlayerGun();
  }

  setActiveSlot(idx) {
    if (idx === this.playerActiveSlot) return;
    const old = this.playerSlots[this.playerActiveSlot];
    if (old && old.gunSprite) old.gunSprite.setVisible(false);

    this.playerActiveSlot = idx;
    this.reloadEndsAt = 0;   // cancel any ongoing reload
    this.mountPlayerGun();
    this.updateSlotUI();
  }

  mountPlayerGun() {
    const s = this.playerSlots[this.playerActiveSlot];
    if (!s) {
      if (this.playerGunSprite) { this.playerGunSprite.destroy(); this.playerGunSprite = null; }
      this.weapon = null;
      this.weaponKey = null;
      this.gunDisplayLength = 0;
      this.updateSlotUI();
      return;
    }
    if (!s.gunSprite) {
      const spr = this.add.image(0, 0, s.key);
      spr.setOrigin(0, 0.5).setDepth(11);
      const dispW = GUN_DISPLAY_WIDTHS[s.key] || GUN_DISPLAY_W;
      spr.setScale(dispW / spr.width);
      s.gunSprite = spr;
      s.displayLength = dispW;
    }
    s.gunSprite.setVisible(true);
    this.playerGunSprite = s.gunSprite;
    this.weapon = s.weapon;
    this.weaponKey = s.key;
    this.gunDisplayLength = s.displayLength;
    this.camZoomTarget = this.rangeToZoom(this.weapon.range);
    this.updateSlotUI();
  }

  updateSlotUI() {
    const s1 = document.getElementById('slot1');
    const s2 = document.getElementById('slot2');
    const set = (el, idx) => {
      if (!el) return;
      const s = this.playerSlots[idx];
      if (s) {
        const type = s.ammoType || 'light';
        const pool = this.ammoReserve[type] || 0;
        el.innerText = s.weapon.name + '  ' + s.ammo + '/' + pool;
      } else {
        el.innerText = 'SLOT ' + (idx + 1);
      }
      el.classList.toggle('active', idx === this.playerActiveSlot && !!s);
    };
    set(s1, 0);
    set(s2, 1);
  }

  // ============================================
  // Loot spawning — batch system
  //  Each category spawns a fixed batch. Only when ALL pickups of that
  //  category are collected does a new batch spawn.
  // ============================================
  spawnInitialLoot(map, _unused) {
    this.lootBatches = {
      weapon: { max: 10, live: 0, kinds: null },
      armor:  { max: 8,  live: 0 },
      health: { max: 10, live: 0 },
      ammo:   { max: 32, live: 0 },   // lots of ammo — bots constantly need it
    };
    // Track live per category
    this.pickupGroup.getChildren().forEach(p => {
      const c = p.kind;
      if (this.lootBatches[c]) this.lootBatches[c].live++;
    });
    // Initial spawn for each category (weapons first, so ammo can anchor to them)
    this._spawnBatch('weapon', 10);
    this._spawnBatch('ammo', 32);
    this._spawnBatch('armor', 8);
    this._spawnBatch('health', 10);
  }

  _spawnBatch(kind, count) {
    const map = this.mapGen;
    const weaponKeys = Object.keys(WEAPONS);
    const ammoTypes = ['light', 'heavy', 'shells'];

    // For smart ammo spawning — collect positions of existing weapons
    const weaponPickupPositions = [];
    if (kind === 'ammo') {
      this.pickupGroup.getChildren().forEach(pp => {
        if (pp.active && pp.kind === 'weapon') {
          weaponPickupPositions.push({ x: pp.x, y: pp.y, key: pp.weaponKey });
        }
      });
    }

    for (let i = 0; i < count; i++) {
      let px, py, ok = false;

      // --- SMART AMMO SPAWN ---
      // If spawning ammo and weapons exist nearby, place ammo
      // within 120-320px of a random weapon so bots/players can find both.
      if (kind === 'ammo' && weaponPickupPositions.length > 0 && Math.random() < 0.7) {
        for (let tries = 0; tries < 25; tries++) {
          const anchor = Phaser.Utils.Array.GetRandom(weaponPickupPositions);
          const ang = Math.random() * Math.PI * 2;
          const rad = 120 + Math.random() * 200;
          const cx = anchor.x + Math.cos(ang) * rad;
          const cy = anchor.y + Math.sin(ang) * rad;
          const tx = Math.floor(cx / map.tileSize);
          const ty = Math.floor(cy / map.tileSize);
          // Tile must be terrain-walkable AND prop-free
          if (!map.isWalkableTile(tx, ty)) continue;
          if (map._isOccupied(tx, ty)) continue;
          // Snap to tile CENTER so pickup never overlaps a prop body
          const sx = tx * map.tileSize + map.tileSize / 2;
          const sy = ty * map.tileSize + map.tileSize / 2;
          if (Phaser.Math.Distance.Between(sx, sy, this.player.x, this.player.y) < 200) continue;
          // Not too close to another pickup
          let clash = false;
          const others = this.pickupGroup.getChildren();
          for (let k = 0; k < others.length; k++) {
            const q = others[k];
            if (!q.active) continue;
            if (Phaser.Math.Distance.Between(sx, sy, q.x, q.y) < 50) { clash = true; break; }
          }
          if (clash) continue;
          px = sx; py = sy; ok = true;
          break;
        }
      }

      // Fallback / normal random placement (tile-center snapped)
      if (!ok) {
        for (let tries = 0; tries < 20; tries++) {
          const t = map.randomWalkableTile();  // now returns prop-free tiles only
          px = t.tx * map.tileSize + map.tileSize / 2;
          py = t.ty * map.tileSize + map.tileSize / 2;
          if (Phaser.Math.Distance.Between(px, py, this.player.x, this.player.y) < 250) continue;
          // Avoid overlapping other pickups
          let clash = false;
          const others = this.pickupGroup.getChildren();
          for (let k = 0; k < others.length; k++) {
            const q = others[k];
            if (!q.active) continue;
            if (Phaser.Math.Distance.Between(px, py, q.x, q.y) < 45) { clash = true; break; }
          }
          if (clash) continue;
          ok = true; break;
        }
      }
      if (!ok) continue;

      let p;
      if (kind === 'weapon') {
        const wk = Phaser.Utils.Array.GetRandom(weaponKeys);
        p = new WeaponPickup(this, px, py, wk, WEAPONS[wk].magSize);
      } else if (kind === 'armor') {
        p = new ArmorPickup(this, px, py, 50);
      } else if (kind === 'health') {
        p = new HealthPickup(this, px, py, 30);
      } else if (kind === 'ammo') {
        // Smart ammo type: if spawned next to a weapon, match its ammo type
        let at;
        const anchor = weaponPickupPositions.find(w =>
          Phaser.Math.Distance.Between(w.x, w.y, px, py) < 400);
        if (anchor) {
          at = AMMO_TYPE[anchor.key] || 'light';
        } else {
          at = Phaser.Utils.Array.GetRandom(ammoTypes);
        }
        // Big ammo amount per pickup — bot needs fewer trips for ammo
        p = new AmmoPickup(this, px, py, 150, at);
      }
      if (!p) continue;
      this.pickupGroup.add(p);
      this._preparePickupBody(p);
      p._lootKind = kind;
      if (this.lootBatches[kind]) this.lootBatches[kind].live++;
    }
  }

  // Called when a pickup is destroyed — decrement counters and respawn
  // the whole batch when a category hits zero.
  notifyPickupRemoved(kind) {
    if (!this.lootBatches || !this.lootBatches[kind]) return;
    const b = this.lootBatches[kind];
    b.live = Math.max(0, b.live - 1);
    if (b.live === 0 && !this.matchEnded) {
      // Respawn a fresh batch after short delay
      const count = b.max;
      this.time.delayedCall(1500, () => {
        if (this.matchEnded) return;
        this._spawnBatch(kind, count);
      });
    }
  }

  _preparePickupBody(p) {
    const r = 22;
    p.body.setCircle(r, p.width / 2 - r, p.height / 2 - r);
    p.body.setAllowGravity(false);
    p.body.setImmovable(true);
    p.body.moves = false;
  }

  // Drops both weapons, armor, and ALL ammo reserves (works for bots & player)
  dropAllLoot(entity) {
    const dropAt = (dx, dy) => ({
      x: entity.x + (Math.random() - 0.5) * 40 + (dx || 0),
      y: entity.y + (Math.random() - 0.5) * 40 + (dy || 0),
    });

    // Determine slot source: bots have .slots; player uses this.playerSlots.
    const slots = (entity === this.player) ? this.playerSlots : (entity.slots || null);
    if (slots) {
      for (let i = 0; i < slots.length; i++) {
        const s = slots[i];
        if (!s) continue;
        const pos = dropAt((i === 0 ? -35 : 35), -20);
        const drop = new WeaponPickup(this, pos.x, pos.y, s.key, s.ammo);
        this.pickupGroup.add(drop);
        this._preparePickupBody(drop);
      }
    }

    // Drop armor (if any)
    const armor = entity.armor || 0;
    if (armor > 0) {
      const pos = dropAt(0, 30);
      const a = new ArmorPickup(this, pos.x, pos.y, Math.max(20, armor));
      this.pickupGroup.add(a);
      this._preparePickupBody(a);
    }

    // Drop ALL ammo reserves (each type with >0 amount)
    const reserve = (entity === this.player) ? (this.ammoReserve || {}) : (entity.ammoReserve || {});
    const types = ['light', 'heavy', 'shells'];
    let ammoIdx = 0;
    for (let i = 0; i < types.length; i++) {
      const t = types[i];
      const amt = reserve[t] || 0;
      if (amt <= 0) continue;
      const pos = dropAt((ammoIdx - 1) * 40, 60);
      // Cap the drop at 60 per pickup to keep it reasonable
      const drop = new AmmoPickup(this, pos.x, pos.y, Math.min(60, amt), t);
      this.pickupGroup.add(drop);
      this._preparePickupBody(drop);
      ammoIdx++;
    }
  }

  // Backward-compat wrapper for bots
  dropLootFor(bot) {
    this.dropAllLoot(bot);
  }

  // ============================================
  // Damage helper (with i-frames)
  // ============================================
  damageEntity(entity, dmg, iFrameMs) {
    if (entity.hp <= 0) return;
    if (iFrameMs && this.time.now < (entity.invulnUntil || 0)) return;
    entity.invulnUntil = this.time.now + (iFrameMs || 0);

    // Armor absorbs
    if (entity.armor > 0) {
      const absorbed = Math.min(entity.armor, Math.ceil(dmg * 0.5));
      entity.armor = Math.max(0, entity.armor - absorbed);
      dmg -= absorbed;
    }
    entity.hp = Math.max(0, entity.hp - dmg);

    if (entity === this.player) {
      this.updateHUD();
      // Red flash
      this.player.setTint(0xff3333);
      this.time.delayedCall(90, () => { if (this.player.active) this.player.clearTint(); });
    }

    if (entity.hp <= 0) this.killPlayer();
  }

  killPlayer() {
    if (this.matchEnded) return;
    if (this.player.hp <= 0 && this._playerAlreadyDead) return;
    this._playerAlreadyDead = true;

    this.player.deaths++;
    this.player.hp = 0;
    this.player.setVelocity(0, 0);
    this.player.setTint(0x333333);

    // Drop all loot at death location
    this.dropAllLoot(this.player);

    // Clear player inventory
    for (let i = 0; i < 2; i++) {
      const s = this.playerSlots[i];
      if (s && s.gunSprite) s.gunSprite.destroy();
      this.playerSlots[i] = null;
    }
    this.playerGunSprite = null;
    this.weapon = null;
    this.weaponKey = null;
    this.gunDisplayLength = 0;
    this.reloadEndsAt = 0;
    this.ammoReserve = { light: 0, heavy: 0, shells: 0 };
    this.player.armor = 0;
    this.updateSlotUI();
    this.updateHUD();

    if (this.dmMode === 'last') {
      this.endMatch('BOT WINS', 'You were eliminated.');
    } else {
      this.showToast('YOU DIED — respawning...', '#e74c3c');
      this.player.invulnUntil = this.time.now + 3000;
      this.time.delayedCall(3000, () => this.respawnPlayer());
    }
  }

  respawnPlayer() {
    if (this.matchEnded) return;
    const spawn = this.mapGen.findSpawn();
    this.player.setPosition(spawn.x, spawn.y);
    this.player.hp = this.player.maxHp;
    this.player.armor = 0;
    this.player.clearTint();
    this.player.invulnUntil = this.time.now + 2000;
    this._playerAlreadyDead = false;
    this.updateHUD();
    this.updateSlotUI();
  }

  respawnBot(oldBot) {
    if (this.matchEnded) return;
    // oldBot has been destroyed already; create a new one with same identity
    const map = this.mapGen;
    let t = map.randomWalkableTile();
    let ex = t.tx * map.tileSize + map.tileSize / 2;
    let ey = t.ty * map.tileSize + map.tileSize / 2;
    // keep away from player
    for (let tries = 0; tries < 20; tries++) {
      if (Phaser.Math.Distance.Between(ex, ey, this.player.x, this.player.y) >= 350) break;
      t = map.randomWalkableTile();
      ex = t.tx * map.tileSize + map.tileSize / 2;
      ey = t.ty * map.tileSize + map.tileSize / 2;
    }
    const bot = new Enemy(this, ex, ey, this.player, {
      cfg: window.BOT_AI,
      name: oldBot.displayName,
      tint: oldBot._baseTint,
    });
    bot.kills = oldBot.kills || 0;
    bot.deaths = (oldBot.deaths || 0) + 1;

    // Replace in bots array
    const idx = this.bots.indexOf(oldBot);
    if (idx >= 0) this.bots[idx] = bot;
    else this.bots.push(bot);
    // No starting weapon — must find loot
  }

  // ============================================
  // Weapon sound (volume scales with distance)
  // ============================================
  playGunSound(weaponKey, soundX, soundY, isPlayer) {
    const key = 'sfx_' + weaponKey;
    if (!this.sound.get(key) && !this.cache.audio.exists(key)) return;

    // Max audible distance
    const MAX_DIST = 900;
    let volume = 1;
    if (!isPlayer) {
      const d = Phaser.Math.Distance.Between(
        this.player.x, this.player.y, soundX, soundY);
      if (d >= MAX_DIST) return;
      volume = 1 - (d / MAX_DIST);         // 1 -> 0
      volume = Math.max(0.05, volume * volume); // square for smoother falloff
    }

    try {
      const snd = this.sound.add(key, { volume });
      snd.play();
      // Free after done
      snd.once('complete', () => snd.destroy());
      // Hard cleanup in case complete never fires
      this.time.delayedCall(2500, () => { if (snd && snd.isPlaying !== undefined) snd.destroy(); });
    } catch (e) { /* sound unavailable */ }
  }

  // ============================================
  // Bullets
  // ============================================
  spawnBullet(x, y, angle, ownerTag, weaponData, owner) {
    const w = weaponData || WEAPONS.pistol;
    const length = w.bulletLength || 10;
    const thickness = w.bulletThickness || 3;
    const speed = w.bulletSpeed;
    const range = w.range || 800;
    const lifetime = (range / speed) * 1000;

    const sprite = this.add.image(x, y, 'tracer');
    sprite.setOrigin(0.5, 0.5);
    sprite.setDepth(9);
    sprite.setRotation(angle);
    sprite.setTint(w.bulletColor || 0xf1c40f);
    sprite.setDisplaySize(length, thickness);

    const bullet = {
      sprite,
      x, y, sx: x, sy: y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      damage: w.damage,
      ownerTag,
      owner: owner || null,
      life: lifetime,
      maxRange: range,
      dead: false,
    };

    if (ownerTag === 'player') this.playerBullets.push(bullet);
    else this.enemyBullets.push(bullet);
  }

  updateBullets(dt) {
    const stepList = (list, isPlayer) => {
      for (let i = list.length - 1; i >= 0; i--) {
        const b = list[i];
        if (b.dead) { b.sprite.destroy(); list.splice(i, 1); continue; }

        b.x += b.vx * dt;
        b.y += b.vy * dt;
        b.life -= dt * 1000;

        const distTravelled = Math.hypot(b.x - b.sx, b.y - b.sy);
        if (b.life <= 0 || distTravelled > b.maxRange) {
          b.sprite.destroy(); list.splice(i, 1); continue;
        }

        b.sprite.setPosition(b.x, b.y);

        if (this.pointHitsObstacle(b.x, b.y)) {
          b.sprite.destroy(); list.splice(i, 1); continue;
        }

        if (isPlayer) {
          // Player bullet hits bots
          let hit = false;
          for (let k = 0; k < this.bots.length; k++) {
            const e = this.bots[k];
            if (!e.active || !e.alive) continue;
            if (Phaser.Math.Distance.Between(b.x, b.y, e.x, e.y) < 24) {
              e.takeDamage(b.damage, this.player);
              hit = true;
              break;
            }
          }
          if (hit) { b.sprite.destroy(); list.splice(i, 1); continue; }
        } else {
          // Bot bullet: hits other bots OR the player
          const owner = b.owner;
          let hit = false;

          // Other bots
          for (let k = 0; k < this.bots.length; k++) {
            const e = this.bots[k];
            if (e === owner) continue;
            if (!e.active || !e.alive) continue;
            if (Phaser.Math.Distance.Between(b.x, b.y, e.x, e.y) < 24) {
              e.takeDamage(b.damage, owner || this.player);
              hit = true;
              break;
            }
          }
          if (hit) { b.sprite.destroy(); list.splice(i, 1); continue; }

          // Player
          if (this.player.hp > 0 &&
              Phaser.Math.Distance.Between(b.x, b.y, this.player.x, this.player.y) < 24) {
            this.damageEntity(this.player, b.damage, 250);
            b.sprite.destroy(); list.splice(i, 1); continue;
          }
        }
      }
    };
    stepList(this.playerBullets, true);
    stepList(this.enemyBullets, false);
  }

  // ============================================
  // update()
  // ============================================
  update(time, delta) {
    if (!this.ready || this.matchEnded) return;
    if (!this.moveVec || !this.player || !this.player.active) return;
    const dt = Math.min(delta / 1000, 0.05);

    // --- Player movement (always first!) ---
    if (this.player.hp > 0) {
      const speed = 220;
      this.player.setVelocity(this.moveVec.x * speed, this.moveVec.y * speed);
      this.player.setRotation(this.aimAngle);
    }

    this.updateBullets(dt);
    this.drawAimLine();

    // Tick bot reload timers
    for (let i = 0; i < this.bots.length; i++) {
      const b = this.bots[i];
      if (b.alive && b._updateReload) b._updateReload(time);
    }

    // Pickup auto-collect (non-weapon kinds)
    this.handleAutoPickups();

    // Draw gun
    if (this.playerGunSprite && this.weapon) {
      const mountOffset = -this.gunDisplayLength / 2;
      const mx = this.player.x + Math.cos(this.aimAngle) * mountOffset;
      const my = this.player.y + Math.sin(this.aimAngle) * mountOffset;
      this.playerGunSprite.setPosition(mx, my);
      this.playerGunSprite.setRotation(this.aimAngle);
    }

    // Firing
    this.handleFiring(time);

    // Reload
    this.handleReload(time);

    // Camera zoom
    if (Math.abs(this.camZoom - this.camZoomTarget) > 0.001) {
      this.camZoom += (this.camZoomTarget - this.camZoom) * Math.min(1, dt * 3);
      this.cameras.main.setZoom(this.camZoom);
    }

    // Camera lean
    const LEAN = 160;
    const targetOffX = -Math.cos(this.aimAngle) * LEAN;
    const targetOffY = -Math.sin(this.aimAngle) * LEAN;
    this.camOffsetX += (targetOffX - this.camOffsetX) * Math.min(1, dt * 5);
    this.camOffsetY += (targetOffY - this.camOffsetY) * Math.min(1, dt * 5);
    this.cameras.main.setFollowOffset(this.camOffsetX, this.camOffsetY);

    if (this.mapGen) this.updateMinimap(this.mapGen);

    // Waypoint pulse
    if (this.waypoint && this.wpWorldRing) {
      const t = time / 400;
      const s = 1 + Math.sin(t) * 0.25;
      this.wpWorldRing.setScale(s);
      this.wpWorldRing.setAlpha(0.5 + Math.sin(t) * 0.4);
      const d = Math.hypot(this.waypoint.x - this.player.x, this.waypoint.y - this.player.y);
      if (d < 40) { this.waypoint = null; this.updateWaypointUI(this.mapGen); }
    }

    // Match timer / win condition
    this.checkMatchEnd(time);
    this.updateMatchTimerUI(time);
  }

  handleFiring(time) {
    if (this.player.hp <= 0) return;
    if (this.reloadEndsAt > 0) return;   // can't fire while reloading
    const s = this.playerSlots[this.playerActiveSlot];
    if (!s) return;
    if (!this.isFiring) return;
    if (s.ammo <= 0) return;
    if (time - this.lastFire < s.weapon.fireRate) return;

    this.lastFire = time;
    s.ammo--;

    const baseAngle = this.aimAngle;
    const mountOffset = -this.gunDisplayLength / 2;
    const mountX = this.player.x + Math.cos(baseAngle) * mountOffset;
    const mountY = this.player.y + Math.sin(baseAngle) * mountOffset;
    const muzzleX = mountX + Math.cos(baseAngle) * this.gunDisplayLength;
    const muzzleY = mountY + Math.sin(baseAngle) * this.gunDisplayLength;

    const spread = s.weapon.spread;
    for (let i = 0; i < s.weapon.pellets; i++) {
      const a = baseAngle + (Math.random() - 0.5) * spread * 2;
      this.spawnBullet(muzzleX, muzzleY, a, 'player', s.weapon, this.player);
    }

    // Play gun sound (full volume for player)
    this.playGunSound(s.key, muzzleX, muzzleY, true);

    this.cameras.main.shake(s.weapon.shakeDuration || 40, s.weapon.shakeIntensity || 0.0015);
    this.updateSlotUI();
  }

  handleReload(time) {
    const s = this.playerSlots[this.playerActiveSlot];
    if (!s) { this.reloadEndsAt = 0; return; }

    const reloading = this.reloadEndsAt > 0;

    const type = s.ammoType || 'light';
    const pool = this.ammoReserve[type] || 0;

    // If currently reloading, wait until it finishes
    if (reloading) {
      if (time >= this.reloadEndsAt) {
        // Finish reload
        const need = s.weapon.magSize - s.ammo;
        const give = Math.min(need, pool);
        s.ammo += give;
        this.ammoReserve[type] = pool - give;
        this.reloadEndsAt = 0;
        this.updateSlotUI();
        this.showToast('RELOADED', '#27ae60');
      }
      return;
    }

    // Start reload when mag empty and reserve available
    if (s.ammo <= 0 && pool > 0) {
      this.reloadEndsAt = time + s.weapon.reloadTime;
      this.showToast('RELOADING...', '#f1c40f');
      this.updateSlotUI();
    }
  }

  // ============================================
  // Auto pickups (armor / health / ammo)
  // Weapon pickups NOT auto-collected if you have any gun
  // ============================================
  handleAutoPickups() {
    const list = this.pickupGroup.getChildren();
    for (let i = list.length - 1; i >= 0; i--) {
      const p = list[i];
      if (!p.active) continue;
      const d = Phaser.Math.Distance.Between(this.player.x, this.player.y, p.x, p.y);
      if (d > 30) continue;

      if (p.kind === 'weapon') {
        // Auto-pickup when ANY slot is empty
        const emptyIdx = this.playerSlots.findIndex(s => s === null);
        if (emptyIdx !== -1) {
          this.addWeaponToSlot(emptyIdx, p.weaponKey, p.ammoInMag, 0);
          if (this.playerSlots[this.playerActiveSlot] === null ||
              this.playerActiveSlot === emptyIdx) {
            this.setActiveSlot(emptyIdx);
          }
          p.destroyPickup();
          this.showToast('PICKED UP ' + WEAPONS[p.weaponKey].name, '#f1c40f');
        }
        // else: both slots full -> switch button swaps
      } else if (p.kind === 'armor') {
        // Skip if armor already full
        if (this.player.armor >= this.player.maxArmor) continue;
        this.player.armor = Math.min(this.player.maxArmor, this.player.armor + p.amount);
        p.destroyPickup();
        this.updateHUD();
      } else if (p.kind === 'health') {
        // Skip if health already full
        if (this.player.hp >= this.player.maxHp) continue;
        this.player.hp = Math.min(this.player.maxHp, this.player.hp + p.amount);
        p.destroyPickup();
        this.updateHUD();
      } else if (p.kind === 'ammo') {
        // Add to the global ammo pool for this type
        const type = p.ammoType || 'light';
        const cap = AMMO_INFO[type].maxReserve;
        this.ammoReserve[type] = Math.min(cap, (this.ammoReserve[type] || 0) + p.amount);
        p.destroyPickup();
        this.updateSlotUI();
      }
    }
  }

  // ============================================
  // Aim line + obstacle raycast
  // ============================================
  drawAimLine() {
    const g = this.aimLineGfx;
    g.clear();
    if (!this.weapon) return;

    const angle = this.aimAngle;
    const range = this.weapon.range || 800;
    const mountOffset = -this.gunDisplayLength / 2;
    const mountX = this.player.x + Math.cos(angle) * mountOffset;
    const mountY = this.player.y + Math.sin(angle) * mountOffset;
    const startX = mountX + Math.cos(angle) * this.gunDisplayLength;
    const startY = mountY + Math.sin(angle) * this.gunDisplayLength;

    let maxDist = range;
    const step = 12;
    for (let d = 0; d < range; d += step) {
      const px = startX + Math.cos(angle) * d;
      const py = startY + Math.sin(angle) * d;
      if (this.pointHitsObstacle(px, py)) { maxDist = d; break; }
    }

    const color = this.weapon.bulletColor || 0xf1c40f;
    let d = 0, segIndex = 0;
    while (d < maxDist) {
      const dashLen = Math.max(2, 16 - segIndex * 1.2);
      const gapLen  = 4 + segIndex * 1.4;
      const dEnd = Math.min(d + dashLen, maxDist);
      const x1 = startX + Math.cos(angle) * d;
      const y1 = startY + Math.sin(angle) * d;
      const x2 = startX + Math.cos(angle) * dEnd;
      const y2 = startY + Math.sin(angle) * dEnd;
      const alpha = 0.55 * (1 - (d / maxDist) * 0.7);
      g.lineStyle(2, color, Math.max(0.08, alpha));
      g.lineBetween(x1, y1, x2, y2);
      d = dEnd + gapLen;
      segIndex++;
    }
    const endX = startX + Math.cos(angle) * maxDist;
    const endY = startY + Math.sin(angle) * maxDist;
    g.fillStyle(color, 0.35);
    g.fillCircle(endX, endY, 3);
  }

  pointHitsObstacle(x, y) {
    if (!this._obstacleBuckets) return false;
    const cellPx = this.obstacleCellPx;
    const cx = Math.floor(x / cellPx);
    const cy = Math.floor(y / cellPx);

    // Check 3x3 neighborhood (radius ~ up to 128px)
    for (let gy = cy - 1; gy <= cy + 1; gy++) {
      for (let gx = cx - 1; gx <= cx + 1; gx++) {
        const arr = this._obstacleBuckets.get(gx + ',' + gy);
        if (!arr) continue;
        for (let i = 0; i < arr.length; i++) {
          const b = arr[i].body;
          if (!b) continue;
          if (b.isCircle) {
            const dx = x - (b.x + b.radius);
            const dy = y - (b.y + b.radius);
            if (dx*dx + dy*dy < (b.radius + 3) * (b.radius + 3)) return true;
          } else {
            const px = Math.max(b.x, Math.min(x, b.x + b.width));
            const py = Math.max(b.y, Math.min(y, b.y + b.height));
            const dx = x - px, dy = y - py;
            if (dx*dx + dy*dy < 9) return true;
          }
        }
      }
    }
    return false;
  }

  rangeToZoom(range) {
    const DEFAULT_ZOOM = 0.70;
    const MIN_ZOOM     = 0.40;
    const THRESH       = 800;
    const MAX          = 2500;
    if (range <= THRESH) return DEFAULT_ZOOM;
    const t = Phaser.Math.Clamp((range - THRESH) / (MAX - THRESH), 0, 1);
    return DEFAULT_ZOOM + (MIN_ZOOM - DEFAULT_ZOOM) * t;
  }

  // ============================================
  // Map rendering (single low-res texture, scaled up)
  // ============================================
  renderMapTexture(map) {
    const g = this.make.graphics({ x: 0, y: 0, add: false });
    const ts = RENDER_TILE;

    for (let y = 0; y < map.rows; y++) {
      for (let x = 0; x < map.cols; x++) {
        const t = map.grid[y][x];
        const c = TILE_COLORS[t] || 0x000000;
        g.fillStyle(c, 1);
        g.fillRect(x * ts, y * ts, ts, ts);
      }
    }

    const key = 'map_' + this.mapSeed;
    g.generateTexture(key, map.cols * ts, map.rows * ts);
    g.destroy();

    const img = this.add.image(0, 0, key).setOrigin(0, 0).setDepth(0);
    img.setScale(TILE_SIZE / RENDER_TILE);
    this.textures.get(key).setFilter(Phaser.Textures.FilterMode.NEAREST);
  }

  // ============================================
  // Minimap / full map
  // ============================================
  setupMinimap(map) {
    this.mmCanvas = document.getElementById('minimap-canvas');
    this.mmCanvas.width = map.cols;
    this.mmCanvas.height = map.rows;
    this.drawMapOnCanvas(this.mmCanvas.getContext('2d'), map);

    this.mmMarker = document.getElementById('minimap-marker');

    this.fmCanvas = document.getElementById('fullmap-canvas');
    this.fmCanvas.width = map.cols;
    this.fmCanvas.height = map.rows;
    this.drawMapOnCanvas(this.fmCanvas.getContext('2d'), map);

    this.fmMarker = document.getElementById('fullmap-marker');
    this.mmWaypoint = document.getElementById('minimap-waypoint');
    this.fmWaypoint = document.getElementById('fullmap-waypoint');
    this.waypoint = null;

    this.fmOverlay = document.getElementById('fullmap-overlay');
    document.getElementById('minimap').addEventListener('click', () => {
      this.fmOverlay.classList.add('open');
    });
    document.getElementById('fullmap-close').addEventListener('click', () => {
      this.fmOverlay.classList.remove('open');
    });
    this.fmOverlay.addEventListener('click', (e) => {
      if (e.target === this.fmOverlay) this.fmOverlay.classList.remove('open');
    });

    const box = document.getElementById('fullmap-box');
    box.addEventListener('pointerdown', (e) => {
      if (e.target.id === 'fullmap-close') return;
      const r = box.getBoundingClientRect();
      const nx = (e.clientX - r.left) / r.width;
      const ny = (e.clientY - r.top) / r.height;
      if (nx < 0 || ny < 0 || nx > 1 || ny > 1) return;
      const worldX = nx * map.width;
      const worldY = ny * map.height;
      if (this.waypoint) {
        const d = Math.hypot(this.waypoint.x - worldX, this.waypoint.y - worldY);
        if (d < 80) { this.waypoint = null; this.updateWaypointUI(map); return; }
      }
      this.waypoint = { x: worldX, y: worldY };
      this.updateWaypointUI(map);
    });

    this.wpWorldMarker = this.add.circle(0, 0, 14, 0xf1c40f, 0.35).setDepth(4).setVisible(false);
    this.wpWorldRing = this.add.circle(0, 0, 22, 0xf1c40f, 0).setStrokeStyle(2, 0xf1c40f, 0.9).setDepth(4).setVisible(false);
  }

  updateWaypointUI(map) {
    if (!this.waypoint) {
      if (this.mmWaypoint) this.mmWaypoint.style.display = 'none';
      if (this.fmWaypoint) this.fmWaypoint.style.display = 'none';
      if (this.wpWorldMarker) this.wpWorldMarker.setVisible(false);
      if (this.wpWorldRing) this.wpWorldRing.setVisible(false);
      return;
    }
    const nx = this.waypoint.x / map.width;
    const ny = this.waypoint.y / map.height;
    if (this.mmWaypoint) {
      this.mmWaypoint.style.display = 'block';
      this.mmWaypoint.style.left = (nx * 100) + '%';
      this.mmWaypoint.style.top  = (ny * 100) + '%';
    }
    if (this.fmWaypoint) {
      this.fmWaypoint.style.display = 'block';
      this.fmWaypoint.style.left = (nx * 100) + '%';
      this.fmWaypoint.style.top  = (ny * 100) + '%';
    }
    if (this.wpWorldMarker) this.wpWorldMarker.setPosition(this.waypoint.x, this.waypoint.y).setVisible(true);
    if (this.wpWorldRing) this.wpWorldRing.setPosition(this.waypoint.x, this.waypoint.y).setVisible(true);
  }

  drawMapOnCanvas(ctx, map) {
    const colorHex = {
      grass: '#4a7c3a', jungle: '#1e4d14', sand: '#c9a96e',
      concrete: '#6e6e64', road: '#3a3a3a', building: '#111111',
    };
    ctx.clearRect(0, 0, map.cols, map.rows);
    for (let y = 0; y < map.rows; y++) {
      for (let x = 0; x < map.cols; x++) {
        ctx.fillStyle = colorHex[map.grid[y][x]] || '#000';
        ctx.fillRect(x, y, 1, 1);
      }
    }
  }

  updateMinimap(map) {
    if (!this.mmMarker || !this.player) return;
    const nx = this.player.x / map.width;
    const ny = this.player.y / map.height;
    this.mmMarker.style.left = (nx * 100) + '%';
    this.mmMarker.style.top  = (ny * 100) + '%';
    if (this.fmMarker) {
      this.fmMarker.style.left = (nx * 100) + '%';
      this.fmMarker.style.top  = (ny * 100) + '%';
    }
  }

  // ============================================
  // HUD / toast / match end
  // ============================================
  updateHUD() {
    const hpFill = document.getElementById('hp-fill');
    const hpVal  = document.getElementById('hp-val');
    const aFill  = document.getElementById('armor-fill');
    const aVal   = document.getElementById('armor-val');
    if (hpFill) hpFill.style.width = Math.max(0, this.player.hp) + '%';
    if (hpVal) hpVal.innerText = Math.max(0, Math.ceil(this.player.hp));
    if (aFill) aFill.style.width = Math.max(0, this.player.armor) + '%';
    if (aVal) aVal.innerText = Math.max(0, Math.ceil(this.player.armor));
  }

  updateScoreUI() {
    const el = document.getElementById('score-label');
    if (el) el.innerText = 'KILLS: ' + this.player.kills + ' · DEATHS: ' + this.player.deaths;
  }

  updateMatchTimerUI(time) {
    const el = document.getElementById('timer-label');
    if (!el) return;
    if (this.dmMode === 'timed') {
      const remain = Math.max(0, this.matchDurationMs - (time - this.matchStartTime));
      const sec = Math.ceil(remain / 1000);
      const m = Math.floor(sec / 60);
      const s = sec % 60;
      el.innerText = m + ':' + (s < 10 ? '0' + s : s);
    } else {
      const alive = this.bots.filter(b => b.alive).length + (this.player.hp > 0 ? 1 : 0);
      el.innerText = 'ALIVE ' + alive;
    }
  }

  showToast(msg, color) {
    if (!this.toast) return;
    this.toast.setText(msg)
      .setPosition(this.player.x, this.player.y - 60)
      .setAlpha(1).setColor(color || '#27ae60');
    this.tweens.add({
      targets: this.toast, alpha: 0, y: this.player.y - 100, duration: 1000,
    });
  }

  checkMatchEnd(time) {
    if (this.matchEnded) return;
    if (this.dmMode === 'timed') {
      if (time - this.matchStartTime >= this.matchDurationMs) {
        this.endMatch('TIME UP', this.buildScoreboardText('time'));
      }
    } else {
      const aliveBots = this.bots.filter(b => b.alive).length;
      if (aliveBots === 0 && this.player.hp > 0) {
        this.endMatch('YOU WIN', 'Last player standing!');
      } else if (this.player.hp <= 0 && aliveBots > 0) {
        this.endMatch('GAME OVER', 'You were eliminated.');
      } else if (aliveBots === 0 && this.player.hp <= 0) {
        this.endMatch('DRAW', 'Everyone is down.');
      }
    }
  }

  buildScoreboardText(kind) {
    if (kind === 'time') {
      return 'Your kills: ' + this.player.kills + ' · deaths: ' + this.player.deaths;
    }
    return '';
  }

  endMatch(title, subtitle) {
    if (this.matchEnded) return;
    this.matchEnded = true;
    this.player.setVelocity(0, 0);
    if (this.rightJoy) this.rightJoy.onRelease && this.rightJoy.onRelease();

    const overlay = document.getElementById('match-overlay');
    const titleEl = document.getElementById('match-title');
    const subEl   = document.getElementById('match-subtitle');
    const scoreEl = document.getElementById('match-score');
    const btn     = document.getElementById('match-restart');

    if (titleEl) titleEl.innerText = title;
    if (subEl)   subEl.innerText = subtitle || '';

    // Scoreboard: player + bots sorted by kills
    if (scoreEl) {
      const rows = [];
      rows.push({ name: this.playerName, kills: this.player.kills, deaths: this.player.deaths, me: true });
      this.bots.forEach(b => rows.push({ name: b.displayName, kills: b.kills, deaths: b.deaths }));
      rows.sort((a, b) => (b.kills - a.kills) || (a.deaths - b.deaths));
      scoreEl.innerHTML = rows.map((r, i) =>
        `<div class="score-row${r.me ? ' me' : ''}">
           <span>#${i + 1}</span>
           <span>${r.name}</span>
           <span>${r.kills}K / ${r.deaths}D</span>
         </div>`).join('');
    }

    if (overlay) overlay.classList.add('open');
    if (btn) btn.onclick = () => location.reload();
  }
}

// ============================================
// Phaser init
// ============================================
const areaEl = document.getElementById('game-area');

const config = {
  type: Phaser.AUTO,
  parent: 'game',
  width: areaEl.clientWidth,
  height: areaEl.clientHeight,
  backgroundColor: '#0a1a0a',
  pixelArt: true,
  physics: {
    default: 'arcade',
    arcade: { gravity: { y: 0 }, debug: false },
  },
  scale: {
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  scene: [DeathmatchScene],
};

const game = new Phaser.Game(config);

window.addEventListener('resize', () => {
  const area = document.getElementById('game-area');
  game.scale.resize(area.clientWidth, area.clientHeight);
});