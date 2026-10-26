// ============================================
// COREX - Pathfinder (A* + path smoothing)
//  - Grid-based A* with diagonal movement
//  - No corner cutting through walls
//  - Line-of-sight path smoothing
//  - Simple binary min-heap
// ============================================

class MinHeap {
  constructor() { this.arr = []; }
  isEmpty() { return this.arr.length === 0; }
  push(item) {
    this.arr.push(item);
    let i = this.arr.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.arr[p].f <= this.arr[i].f) break;
      const t = this.arr[p]; this.arr[p] = this.arr[i]; this.arr[i] = t;
      i = p;
    }
  }
  pop() {
    const top = this.arr[0];
    const last = this.arr.pop();
    if (this.arr.length > 0) {
      this.arr[0] = last;
      let i = 0;
      const n = this.arr.length;
      while (true) {
        const l = i * 2 + 1, r = l + 1;
        let s = i;
        if (l < n && this.arr[l].f < this.arr[s].f) s = l;
        if (r < n && this.arr[r].f < this.arr[s].f) s = r;
        if (s === i) break;
        const t = this.arr[s]; this.arr[s] = this.arr[i]; this.arr[i] = t;
        i = s;
      }
    }
    return top;
  }
}

class Pathfinder {
  constructor(mapGen) {
    this.map = mapGen;
    this.cols = mapGen.cols;
    this.rows = mapGen.rows;
    this.tileSize = mapGen.tileSize;

    // ============================================
    // GRID LAYERS
    //   walk : walkable grid = (terrain passable) AND (no grid-locked prop)
    //          The map is grid-locked, and the bot body (36px) is
    //          smaller than a tile (48px), so this single layer is
    //          exactly A*-walkable AND physics-walkable. No safe layer,
    //          no inflated grid — 1:1 mapping.
    // ============================================

    this.walk = new Uint8Array(this.cols * this.rows);
    for (let y = 0; y < this.rows; y++) {
      for (let x = 0; x < this.cols; x++) {
        let ok = mapGen.isWalkableTile(x, y);
        if (ok && typeof mapGen._isOccupied === 'function' && mapGen._isOccupied(x, y)) {
          ok = false;
        }
        this.walk[y * this.cols + x] = ok ? 1 : 0;
      }
    }

    // ---- Tile cost ----
    // Slight preference for tiles not hugging walls. Keeps bots off
    // wall edges so they don't scrape along props. Never blocks a tile.
    this.cost = new Float32Array(this.cols * this.rows);
    for (let y = 0; y < this.rows; y++) {
      for (let x = 0; x < this.cols; x++) {
        const i = y * this.cols + x;
        if (!this.walk[i]) { this.cost[i] = 0; continue; }
        let blocked = 0;
        if (!this._walkRaw(x - 1, y)) blocked++;
        if (!this._walkRaw(x + 1, y)) blocked++;
        if (!this._walkRaw(x, y - 1)) blocked++;
        if (!this._walkRaw(x, y + 1)) blocked++;
        let c = 1.0;
        if (blocked === 1) c = 1.15;
        else if (blocked === 2) c = 1.35;
        else if (blocked >= 3) c = 1.6;
        this.cost[i] = c;
      }
    }
  }

  // Raw walkability check that doesn't bound-check.
  // Out-of-bounds is treated as blocked (for edge of map).
  _walkRaw(x, y) {
    if (x < 0 || y < 0 || x >= this.cols || y >= this.rows) return false;
    return this.walk[y * this.cols + x] === 1;
  }

  // Public walkability used by A* and LOS.
  // Grid is grid-locked, bot fits in a tile → walkable == A*-walkable
  // == physics-walkable. One layer, no ambiguity.
  isWalk(x, y) {
    if (x < 0 || y < 0 || x >= this.cols || y >= this.rows) return false;
    return this.walk[y * this.cols + x] === 1;
  }

  // Alias for compatibility (no separate raw layer anymore).
  isWalkRaw(x, y) { return this.isWalk(x, y); }

  _useGrid(x, y) { return this.isWalk(x, y); }

  worldToTile(wx, wy) {
    return {
      tx: Math.floor(wx / this.tileSize),
      ty: Math.floor(wy / this.tileSize),
    };
  }

  tileToWorld(tx, ty) {
    return {
      x: tx * this.tileSize + this.tileSize / 2,
      y: ty * this.tileSize + this.tileSize / 2,
    };
  }

  _heuristic(x1, y1, x2, y2) {
    const dx = Math.abs(x1 - x2), dy = Math.abs(y1 - y2);
    // Octile distance
    return (dx + dy) + (1.41421356 - 2) * Math.min(dx, dy);
  }

  _neighbors(x, y) {
    const out = [];
    // 8-way
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx, ny = y + dy;
        if (!this._useGrid(nx, ny)) continue;
        // Prevent corner cutting on diagonals
        if (dx !== 0 && dy !== 0) {
          if (!this._useGrid(x + dx, y) || !this._useGrid(x, y + dy)) continue;
        }
        const step = (dx !== 0 && dy !== 0) ? 1.41421356 : 1;
        const w = this.cost[ny * this.cols + nx] || 1;
        out.push({ tx: nx, ty: ny, cost: step * w });
      }
    }
    return out;
  }

  _nearestWalkable(tx, ty) {
    for (let r = 1; r <= 8; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          if (this._useGrid(tx + dx, ty + dy)) return { tx: tx + dx, ty: ty + dy };
        }
      }
    }
    return null;
  }

  // Returns array of {tx,ty} from just-after-start to goal (inclusive), or null if no path.
  // Returns [] if start === goal.
  // Grid-locked map → single walkable layer, no fallback needed.
  findPath(sx, sy, gx, gy, maxIter) {
    return this._findPathInner(sx, sy, gx, gy, maxIter);
  }

  _findPathInner(sx, sy, gx, gy, maxIter) {
    maxIter = maxIter || 5000;
    const start = this.worldToTile(sx, sy);
    const goal  = this.worldToTile(gx, gy);

    let stx = start.tx, sty = start.ty;
    // If start tile is blocked (bot pressed into wall), snap to nearest walkable
    if (!this._useGrid(stx, sty)) {
      const n = this._nearestWalkable(stx, sty);
      if (!n) return null;
      stx = n.tx; sty = n.ty;
    }
    let gtx = goal.tx, gty = goal.ty;
    if (!this._useGrid(gtx, gty)) {
      const n = this._nearestWalkable(gtx, gty);
      if (!n) return null;
      gtx = n.tx; gty = n.ty;
    }

    if (stx === gtx && sty === gty) return [];

    const startKey = sty * this.cols + stx;
    const goalKey  = gty * this.cols + gtx;

    const open = new MinHeap();
    const cameFrom = new Map();
    const gScore = new Map();
    const closed = new Set();

    gScore.set(startKey, 0);
    open.push({
      key: startKey, tx: stx, ty: sty,
      f: this._heuristic(stx, sty, gtx, gty),
    });

    let iter = 0;
    while (!open.isEmpty() && iter++ < maxIter) {
      const cur = open.pop();
      if (closed.has(cur.key)) continue;

      if (cur.key === goalKey) {
        return this._reconstruct(cameFrom, goalKey);
      }
      closed.add(cur.key);

      const neigh = this._neighbors(cur.tx, cur.ty);
      const curG = gScore.get(cur.key);
      for (let i = 0; i < neigh.length; i++) {
        const nb = neigh[i];
        const nk = nb.ty * this.cols + nb.tx;
        if (closed.has(nk)) continue;
        const tentativeG = curG + nb.cost;
        const prev = gScore.get(nk);
        if (prev === undefined || tentativeG < prev) {
          cameFrom.set(nk, cur.key);
          gScore.set(nk, tentativeG);
          open.push({
            key: nk, tx: nb.tx, ty: nb.ty,
            f: tentativeG + this._heuristic(nb.tx, nb.ty, gtx, gty),
          });
        }
      }
    }
    return null;
  }

  _reconstruct(cameFrom, goalKey) {
    const out = [];
    let k = goalKey;
    let guard = 0;
    while (cameFrom.has(k) && guard++ < 8000) {
      const cols = this.cols;
      out.push({ tx: k % cols, ty: Math.floor(k / cols) });
      k = cameFrom.get(k);
    }
    out.reverse();
    return out;
  }

  // Bresenham LOS on grid — is the tile path from (sx,sy) to (gx,gy) clear?
  // thick=true also checks the tiles offset ±1 perpendicular to the line,
  // so the caller knows the line is wide enough for a body to pass.
  hasLOS(sx, sy, gx, gy, thick) {
    const a = this.worldToTile(sx, sy);
    const b = this.worldToTile(gx, gy);
    let x0 = a.tx, y0 = a.ty;
    const x1 = b.tx, y1 = b.ty;
    const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
    const sxDir = x0 < x1 ? 1 : -1;
    const syDir = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    let guard = 0;

    // Perpendicular direction for thickness checks
    const px = -syDir, py = sxDir;   // if moving (dx,dy), perpendicular is (-dy,dx)

    while (guard++ < 800) {
      if (!this.isWalk(x0, y0)) return false;
      if (thick) {
        // The bot needs ~1 tile clearance on BOTH sides.
        if (!this.isWalk(x0 + 1, y0) || !this.isWalk(x0 - 1, y0) ||
            !this.isWalk(x0, y0 + 1) || !this.isWalk(x0, y0 - 1)) {
          return false;
        }
      }
      if (x0 === x1 && y0 === y1) return true;
      const e2 = 2 * err;
      if (e2 > -dy) { err -= dy; x0 += sxDir; }
      if (e2 < dx)  { err += dx; y0 += syDir; }
    }
    return false;
  }

  // Given a world-space path (array of {x,y}), remove intermediate points
  // that are visible via LOS from an earlier anchor.
  // Uses THICK LOS so the smoothed line is wide enough for the bot body.
  smooth(worldPath) {
    if (!worldPath || worldPath.length < 3) return worldPath || [];
    const out = [worldPath[0]];
    let i = 1;
    while (i < worldPath.length) {
      let furthest = i;
      for (let j = worldPath.length - 1; j > i; j--) {
        if (this.hasLOS(worldPath[i - 1].x, worldPath[i - 1].y,
                        worldPath[j].x, worldPath[j].y)) {
          furthest = j;
          break;
        }
      }
      out.push(worldPath[furthest]);
      i = furthest + 1;
    }
    return out;
  }

  // Convenience: full pipeline — start/goal in world coords, returns
  // smoothed world-space waypoint array (excluding start).
  getSmoothedPath(sx, sy, gx, gy) {
    const raw = this.findPath(sx, sy, gx, gy);
    if (raw === null) return null;
    if (raw.length === 0) return [];
    const world = raw.map(n => this.tileToWorld(n.tx, n.ty));
    // Replace the last waypoint with the exact goal (for precision)
    world[world.length - 1] = { x: gx, y: gy };
    return this.smooth(world);
  }
}

window.Pathfinder = Pathfinder;