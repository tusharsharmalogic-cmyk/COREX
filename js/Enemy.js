// ============================================
// COREX - Enemy (Bot) - Deathmatch AI
//  - Dynamic targeting (player OR other bots)
//  - 3 ammo types: light/heavy/shells (global pool per bot)
//  - No starting weapon — must loot first
//  - Proper reload timing
// ============================================

// Bot body = 512 × 0.07 = ~36px. Tile is 48px, so the bot fits
// comfortably through every 1-tile gap and hugs props safely.
const ENEMY_SCALE = 0.07;
const ENEMY_GUN_DISPLAY_W = 65;
const ENEMY_MOUNT_OFFSET = -ENEMY_GUN_DISPLAY_W / 2;

class Enemy extends Phaser.Physics.Arcade.Sprite {
  constructor(scene, x, y, playerRef, opts) {
    super(scene, x, y, 'player');
    scene.add.existing(this);
    scene.physics.add.existing(this);

    opts = opts || {};
    this.cfg = opts.cfg || window.BOT_AI;
    this.isBot = true;
    this.displayName = opts.name || ('BOT_' + Math.floor(Math.random() * 900 + 100));
    this._baseTint = (opts.tint !== undefined) ? opts.tint : 0xff4444;

    this.playerRef = playerRef;
    this.setScale(ENEMY_SCALE);
    this.setTint(this._baseTint);
    this.setCollideWorldBounds(true);
    this.setDepth(9);
    this.setDrag(900, 900);
    this.setMaxVelocity(280, 280);   // fits loot sprint (220) with headroom

    // Tighten collision body — bot sprite is ~36px after scale, but the
    // PHYSICS body is what collides. A smaller body means corner
    // collisions are far less likely while navigating diagonally
    // between tiles.
    if (this.body) {
      this.body.setSize(this.width * 0.40, this.height * 0.40, true);
    }

    // Stats
    this.maxHealth = 100;
    this.health = this.maxHealth;
    this.alive = true;
    this.armor = 0;
    this.maxArmor = 100;
    this.kills = 0;
    this.deaths = 0;

    // Weapon slots
    this.slots = [null, null];
    this.activeSlot = 0;
    this.lastShot = 0;
    this.lastReload = 0;
    this.reloadEndsAt = 0;
    this._lastSlotSwitch = 0;

    // Global ammo reserve per type
    this.ammoReserve = { light: 0, heavy: 0, shells: 0 };

    // AI state
    this.state = 'loot';
    this.aimAngle = 0;
    this.currentTarget = null;
    this.lastSeen = 0;
    this.lastSeenX = 0;
    this.lastSeenY = 0;
    this.lastSeenTarget = null;
    this.strafeDir = (Math.random() < 0.5 ? 1 : -1);
    this.nextStrafeChange = 0;
    this.patrolTarget = null;
    this.patrolSince = 0;
    this.reactionUntil = 0;
    this._lastReactionSet = 0;
    this.nextLootScan = 0;
    this.cachedLoot = null;
    this.cachedNeed = null;
    this.nextHealthScan = 0;
    this.cachedHealthPickup = null;
    // Stuck detection
    this._lastX = x;
    this._lastY = y;
    this._stuckSince = 0;
    this._stuckCheckAt = 0;
    this._unstickUntil = 0;
    this._unstickAngle = 0;
    this._unstuckCount = 0;

    // --- Pathfinding state (A* + smoothing) ---
    this._path = null;              // array of {x,y} world waypoints (excluding current pos)
    this._pathIdx = 0;              // current waypoint index
    this._pathTargetX = 0;          // goal world coords for the current path
    this._pathTargetY = 0;
    this._pathTime = 0;             // time (ms) when path was computed
    this._pathReplanMs = 500;       // replan interval
    this._pathTargetTol = 60;       // replan if target moved > this
    this._pathWpReachTol = 34;      // waypoint reached threshold
    this._pathFailUntil = 0;        // back-off if A* fails for this long

    // HP bar
    this.hpBarBg = scene.add.rectangle(x, y - 34, 46, 6, 0x000000, 0.75).setDepth(10);
    this.hpBar   = scene.add.rectangle(x - 23, y - 34, 46, 6, 0xe74c3c)
      .setOrigin(0, 0.5).setDepth(10);

    // Name tag
    this.nameTag = scene.add.text(x, y - 48, this.displayName, {
      fontFamily: 'Arial', fontSize: '10px', color: '#ff9999',
      fontStyle: 'bold', stroke: '#000', strokeThickness: 3,
    }).setOrigin(0.5).setDepth(11);

    // Muzzle flash
    this.muzzleFlash = scene.add.circle(0, 0, 6, 0xf1c40f)
      .setDepth(10).setVisible(false);

    // NO STARTING WEAPON — bot must loot

    // Collide with obstacles
    if (scene.obstacles) {
      scene.physics.add.collider(this, scene.obstacles);
    }

    this.pickPatrolTarget(scene.time.now);
  }

  // ============================================
  // Weapon management
  // ============================================
  giveWeapon(key, ammoInMag, reserve, force) {
    const W = this.scene.WEAPONS[key];
    if (!W) return false;
    const ammoType = (typeof AMMO_TYPE !== 'undefined' && AMMO_TYPE[key]) || 'light';

    // Already has this weapon -> top up mag + reserve
    for (let i = 0; i < 2; i++) {
      if (this.slots[i] && this.slots[i].key === key) {
        this.slots[i].ammo += (ammoInMag || 0);
        if (reserve) {
          const cap = AMMO_INFO[ammoType].maxReserve;
          this.ammoReserve[ammoType] = Math.min(cap,
            (this.ammoReserve[ammoType] || 0) + reserve);
        }
        return true;
      }
    }

    // Find empty slot
    let slot = -1;
    if (!this.slots[0]) slot = 0;
    else if (!this.slots[1]) slot = 1;

    if (slot === -1) {
      if (!force) return false;
      slot = this._worstSlotIndex();
      if (this.slots[slot] && this.slots[slot].gunSprite) {
        this.slots[slot].gunSprite.destroy();
      }
    }

    this.slots[slot] = {
      key,
      weapon: W,
      ammoType,
      ammo: (typeof ammoInMag === 'number') ? ammoInMag : W.magSize,
      gunSprite: null,
    };

    if (reserve) {
      const cap = AMMO_INFO[ammoType].maxReserve;
      this.ammoReserve[ammoType] = Math.min(cap,
        (this.ammoReserve[ammoType] || 0) + reserve);
    }

    if (!this.slots[this.activeSlot]) {
      this.activeSlot = slot;
      this._mountGunSprite();
    } else if (slot === this.activeSlot) {
      this._mountGunSprite();
    }
    return true;
  }

  _worstSlotIndex() {
    const dps = (s) => s ? (s.weapon.damage * s.weapon.pellets) / (s.weapon.fireRate / 1000) : -1;
    const a = this.slots[0], b = this.slots[1];
    if (!a) return 0;
    if (!b) return 1;
    return dps(a) <= dps(b) ? 0 : 1;
  }

  get activeWeaponData() {
    const s = this.slots[this.activeSlot];
    return s ? s.weapon : null;
  }

  switchSlot(i) {
    if (i === this.activeSlot) return;
    if (!this.slots[i]) return;
    const old = this.slots[this.activeSlot];
    if (old && old.gunSprite) old.gunSprite.setVisible(false);
    this.activeSlot = i;
    this.reloadEndsAt = 0;
    this._mountGunSprite();
  }

  _mountGunSprite() {
    const s = this.slots[this.activeSlot];
    if (!s) return;
    if (!s.gunSprite || !s.gunSprite.active) {
      s.gunSprite = this.scene.add.image(this.x, this.y, s.key);
      s.gunSprite.setOrigin(0, 0.5).setDepth(11);
      const dispW = (GUN_DISPLAY_WIDTHS[s.key] || 60);
      s.gunSprite.setScale(dispW / s.gunSprite.width);
      s.gunSprite.setTint(0xdddddd);
      s.gunSprite.displayLength = dispW;
    }
    s.gunSprite.setVisible(true);
  }

  // ============================================
  // Damage / Death
  // ============================================
  takeDamage(amount, attacker) {
    if (!this.alive) return;
    if (attacker) this._lastHitBy = attacker;

    if (this.armor > 0) {
      const absorbed = Math.min(this.armor, Math.ceil(amount * 0.5));
      this.armor -= absorbed;
      amount -= absorbed;
    }
    this.health -= amount;

    this.setTint(0xffffff);
    this.scene.time.delayedCall(60, () => {
      if (this.active && this.alive) this.setTint(this._baseTint);
    });

    if (attacker) {
      this.lastSeen = this.scene.time.now;
      this.lastSeenX = attacker.x;
      this.lastSeenY = attacker.y;
      this.lastSeenTarget = attacker;
    }

    if (this.health <= 0) this.die(attacker);
  }

  die(killer) {
    if (!this.alive) return;
    this.alive = false;
    this.state = 'dead';
    this.setVelocity(0, 0);
    this.hpBar.destroy();
    this.hpBarBg.destroy();
    this.nameTag.destroy();
    this.muzzleFlash.destroy();

    // Drop loot BEFORE clearing slots (dropAllLoot reads slots)
    this.scene.dropLootFor(this);

    for (let i = 0; i < 2; i++) {
      const s = this.slots[i];
      if (s && s.gunSprite) s.gunSprite.destroy();
    }
    this.slots = [null, null];

    this.setTint(0x333333);
    this.scene.tweens.add({
      targets: this,
      alpha: 0, scaleX: 0.3, scaleY: 0.3, duration: 350,
      onComplete: () => this.destroy(),
    });

    this.scene.events.emit('enemy-killed', this.x, this.y, this, killer);
  }

  // ============================================
  // PreUpdate — main AI tick
  // ============================================
  preUpdate(time, delta) {
    super.preUpdate(time, delta);
    if (!this.alive) return;

    const cfg = this.cfg;

    // ============================================
    // STUCK DETECTION & SIDESTEP
    // Every 500ms check if bot has barely moved while trying to move.
    // If stuck, force a perpendicular nudge for ~600ms.
    // ============================================
    if (time > this._stuckCheckAt) {
      const dx = this.x - this._lastX;
      const dy = this.y - this._lastY;
      const moved = Math.hypot(dx, dy);
      const intendingMove = Math.hypot(this.body.velocity.x, this.body.velocity.y) > 30;

      if (intendingMove && moved < 6) {   // tighter threshold catches slow-stuck
        this._unstuckCount++;
        // Pick a direction that AWAY from the obstacle. Use a full
        // 16-direction scan and pick the most open ray (farthest before
        // hitting something). This beats random/perpendicular guesses
        // because it points the bot towards actual free space.
        const speedBoost = 200 + this._unstuckCount * 30;
        let bestAngle = null, bestDist = -1;
        const angles = 16;
        for (let i = 0; i < angles; i++) {
          const a = (i / angles) * Math.PI * 2;
          const ca = Math.cos(a), sa = Math.sin(a);
          let d = 0;
          for (let step = 8; step <= 140; step += 8) {
            if (this.scene.pointHitsObstacle(this.x + ca * step, this.y + sa * step)) break;
            d = step;
          }
          if (d > bestDist) { bestDist = d; bestAngle = a; }
        }
        if (bestAngle !== null) {
          this._unstickAngle = bestAngle;
        } else {
          this._unstickAngle = Math.random() * Math.PI * 2;
        }
        // Longer nudge when repeatedly stuck so bot fully escapes
        const dur = 400 + Math.min(this._unstuckCount, 4) * 250;
        this._unstickUntil = time + dur;
        this._unstickSpeed = speedBoost;
        // Invalidate path so next plan uses fresh position
        this._path = null;
        this._pathIdx = 0;
      } else {
        this._unstuckCount = 0;
      }
      this._lastX = this.x;
      this._lastY = this.y;
      this._stuckCheckAt = time + 400;
    }

    // Apply unstuck nudge (overrides normal movement)
    if (time < this._unstickUntil) {
      const speed = this._unstickSpeed || 220;
      this.setVelocity(
        Math.cos(this._unstickAngle) * speed,
        Math.sin(this._unstickAngle) * speed
      );
      this.aimAngle = this._unstickAngle;
      this.setRotation(this.aimAngle);
      this._moveGunForAim();
      this._updateVisuals();
      return;
    }

    // 1. Perceive
    const seen = this._perceive();

    if (seen) {
      this.currentTarget = seen.target;
      this.lastSeen = time;
      this.lastSeenX = seen.target.x;
      this.lastSeenY = seen.target.y;
      this.lastSeenTarget = seen.target;

      if (time - this._lastReactionSet > 1500) {
        this.reactionUntil = time + cfg.combat.reactionTimeMs;
        this._lastReactionSet = time;
      }
    } else {
      if (this.currentTarget && (time - this.lastSeen > cfg.patrol.chaseMemoryMs)) {
        this.currentTarget = null;
      }
    }

    // 1.0 NO-WEAPON OVERRIDE (highest priority)
    // If the bot has zero guns, it MUST loot first — ignore combat entirely.
    const hasNoWeapon = !this.slots[0] && !this.slots[1];
    if (hasNoWeapon) {
      if (time > (this.nextWeaponScan || 0)) {
        this.cachedWeaponPickup = this._findWantedPickup('weapon');
        this.nextWeaponScan = time + 500;
      }
      const wp = this.cachedWeaponPickup;
      if (wp && wp.active) {
        const d = Phaser.Math.Distance.Between(this.x, this.y, wp.x, wp.y);
        this.state = 'loot';
        this._navigateTo(wp.x, wp.y, 1.0, 220);   // fast loot sprint (weapon)
        this._aimAt(wp.x, wp.y);
        this._moveGunForAim();
        if (d < 55) {
          this._tryPickup(wp);
          this.cachedWeaponPickup = null;
        }
        this._updateVisuals();
        return;
      }
      // No weapon pickup visible anywhere — scan wider and patrol
      if (time > (this.nextWeaponScan || 0)) {
        // Expand search radius temporarily (find farthest weapon pickup)
        const list = this.scene.pickupGroup.getChildren();
        let best = null, bestD = Infinity;
        for (let i = 0; i < list.length; i++) {
          const p = list[i];
          if (!p.active || p.kind !== 'weapon') continue;
          const dd = Phaser.Math.Distance.Between(this.x, this.y, p.x, p.y);
          if (dd < bestD) { bestD = dd; best = p; }
        }
        if (best) {
          this.state = 'loot';
          this._navigateTo(best.x, best.y, 1.0, 220);
          this._aimAt(best.x, best.y);
          this._moveGunForAim();
          this._updateVisuals();
          return;
        }
      }
      // No weapon pickup exists on the map at all — patrol/wander
      this.state = 'patrol';
      if (!this.patrolTarget ||
          Phaser.Math.Distance.Between(this.x, this.y, this.patrolTarget.x, this.patrolTarget.y) < cfg.patrol.waypointReachedDist ||
          time - this.patrolSince > cfg.patrol.waypointTimeoutMs) {
        this.pickPatrolTarget(time);
      }
      if (this.patrolTarget) {
        this._navigateTo(this.patrolTarget.x, this.patrolTarget.y, 0.75, 140);
        this._aimAt(this.patrolTarget.x, this.patrolTarget.y);
        this._moveGunForAim();
      }
      this._updateVisuals();
      return;
    }

    // 1.2 NO-AMMO OVERRIDE
    // If bot has weapon(s) but zero usable ammo (mag + reserve both empty
    // for ALL weapons), it MUST find ammo instead of fighting with empty guns.
    let totalAmmo = 0;
    for (let i = 0; i < 2; i++) {
      const s = this.slots[i];
      if (!s) continue;
      const type = s.ammoType || 'light';
      totalAmmo += s.ammo + (this.ammoReserve[type] || 0);
    }
    if (totalAmmo === 0) {
      if (time > (this.nextAmmoScan || 0)) {
        this.cachedAmmoPickup = this._findWantedPickup('ammo');
        this.nextAmmoScan = time + 500;
      }
      const ap = this.cachedAmmoPickup;
      if (ap && ap.active) {
        const d = Phaser.Math.Distance.Between(this.x, this.y, ap.x, ap.y);
        this.state = 'loot';
        this._navigateTo(ap.x, ap.y, 1.0, 220);
        this._aimAt(ap.x, ap.y);
        this._moveGunForAim();
        if (d < 55) {
          this._tryPickup(ap);
          this.cachedAmmoPickup = null;
        }
        this._updateVisuals();
        return;
      }
      // No ammo nearby — scan whole map for nearest compatible ammo pickup
      if (time > (this.nextAmmoScan || 0)) {
        const list = this.scene.pickupGroup.getChildren();
        let best = null, bestD = Infinity;
        for (let i = 0; i < list.length; i++) {
          const p = list[i];
          if (!p.active || p.kind !== 'ammo') continue;
          if (!this._wantsAmmoType(p.ammoType)) continue;
          const dd = Phaser.Math.Distance.Between(this.x, this.y, p.x, p.y);
          if (dd < bestD) { bestD = dd; best = p; }
        }
        if (best) {
          this.state = 'loot';
          this._navigateTo(best.x, best.y, 1.0, 220);
          this._aimAt(best.x, best.y);
          this._moveGunForAim();
          this._updateVisuals();
          return;
        }
      }
      // No compatible ammo exists — patrol
      this.state = 'patrol';
      if (!this.patrolTarget ||
          Phaser.Math.Distance.Between(this.x, this.y, this.patrolTarget.x, this.patrolTarget.y) < cfg.patrol.waypointReachedDist ||
          time - this.patrolSince > cfg.patrol.waypointTimeoutMs) {
        this.pickPatrolTarget(time);
      }
      if (this.patrolTarget) {
        this._navigateTo(this.patrolTarget.x, this.patrolTarget.y, 0.75, 140);
        this._aimAt(this.patrolTarget.x, this.patrolTarget.y);
        this._moveGunForAim();
      }
      this._updateVisuals();
      return;
    }

    // 1.5 CRITICAL HEALTH OVERRIDE
    const lootCfg = cfg.loot;
    const criticalHealth = this.health < lootCfg.wantHealthIfBelow;
    if (criticalHealth) {
      if (time > (this.nextHealthScan || 0)) {
        this.cachedHealthPickup = this._findWantedPickup('health');
        this.nextHealthScan = time + 900;
      }
      const hp = this.cachedHealthPickup;
      if (hp && hp.active) {
        const d = Phaser.Math.Distance.Between(this.x, this.y, hp.x, hp.y);
        if (d < lootCfg.searchRadius * 1.4) {
          this.state = 'loot';
          this._navigateTo(hp.x, hp.y, 1.0, 220);
          this._aimAt(hp.x, hp.y);
          this._moveGunForAim();
          if (d < 55) {
            this._tryPickup(hp);
            this.cachedHealthPickup = null;
          }
          this._updateVisuals();
          return;
        }
      }
    }

    // 2. Combat if target visible
    if (this.currentTarget && seen) {
      if (time < this.reactionUntil) {
        this.setVelocity(0, 0);
        this._aimAt(this.currentTarget.x, this.currentTarget.y);
        this._moveGunForAim();
        this._updateVisuals();
        return;
      }
      this._doCombat(time, this.currentTarget, seen.dist);
      this._updateVisuals();
      return;
    }

    // 3. Chase last seen
    if (this.currentTarget && time - this.lastSeen < cfg.patrol.chaseMemoryMs) {
      this.state = 'chase';
      this._navigateTo(this.lastSeenX, this.lastSeenY, cfg.combat.chaseSpeed, 150);
      this._aimAt(this.lastSeenX, this.lastSeenY);
      this._moveGunForAim();
      this._updateVisuals();
      return;
    }

    // 4. Loot
    const need = this._needKind();
    if (need) {
      const needChanged = this.cachedNeed !== need;
      const targetGone  = !this.cachedLoot || !this.cachedLoot.active;
      if (needChanged || targetGone || time > this.nextLootScan) {
        this.cachedLoot = this._findWantedPickup(need);
        this.cachedNeed = need;
        this.nextLootScan = time + 800;
      }
      const p = this.cachedLoot;
      if (p && p.active) {
        const d = Phaser.Math.Distance.Between(this.x, this.y, p.x, p.y);
        if (d < cfg.loot.searchRadius) {
          this.state = 'loot';
          this._navigateTo(p.x, p.y, 0.8, 220);
          this._aimAt(p.x, p.y);
          this._moveGunForAim();
          if (d < 55) {
            this._tryPickup(p);
            this.nextLootScan = time + 2000;
            this.cachedLoot = null;
            this.cachedNeed = null;
          }
          this._updateVisuals();
          return;
        }
      } else {
        this.cachedLoot = null;
      }
    }

    // 5. Patrol
    this.state = 'patrol';
    if (!this.patrolTarget ||
        Phaser.Math.Distance.Between(this.x, this.y, this.patrolTarget.x, this.patrolTarget.y) < cfg.patrol.waypointReachedDist ||
        time - this.patrolSince > cfg.patrol.waypointTimeoutMs) {
      this.pickPatrolTarget(time);
    }
    if (this.patrolTarget) {
      this._navigateTo(this.patrolTarget.x, this.patrolTarget.y, 0.6, 120);
      this._aimAt(this.patrolTarget.x, this.patrolTarget.y);
      this._moveGunForAim();
    }
    this._updateVisuals();
  }

  _perceive() {
    const cfg = this.cfg;
    const targets = this._allTargets();
    let best = null, bestD = Infinity;

    for (let i = 0; i < targets.length; i++) {
      const t = targets[i];
      const d = Phaser.Math.Distance.Between(this.x, this.y, t.x, t.y);
      if (d > cfg.vision.detectRange) continue;

      let clear = true;
      const steps = 6;
      for (let k = 1; k < steps; k++) {
        const px = this.x + (t.x - this.x) * (k / steps);
        const py = this.y + (t.y - this.y) * (k / steps);
        if (this.scene.pointHitsObstacle(px, py)) { clear = false; break; }
      }
      if (!clear) continue;
      if (d < bestD) { bestD = d; best = t; }
    }
    return best ? { target: best, dist: bestD } : null;
  }

  _allTargets() {
    const out = [];
    const p = this.scene.player;
    if (p && p.active && p.hp > 0) out.push(p);
    const bots = this.scene.bots || [];
    for (let i = 0; i < bots.length; i++) {
      const b = bots[i];
      if (b === this || !b.alive || !b.active) continue;
      out.push(b);
    }
    return out;
  }

  _doCombat(time, target, dist) {
    const cfg = this.cfg;
    this._pickWeaponForDistance(dist);
    const wd = this.activeWeaponData;
    const preferred = wd ? Math.min(wd.range * 0.6, 420) : cfg.combat.preferredRange;

    if (dist > preferred + 80) {
      this.state = 'chase';
      this._navigateTo(target.x, target.y, cfg.combat.chaseSpeed, 150);
    } else if (dist < cfg.combat.engageMinDist) {
      this.state = 'backup';
      const bx = this.x - Math.cos(this.aimAngle) * 200;
      const by = this.y - Math.sin(this.aimAngle) * 200;
      this._moveToward(bx, by, cfg.combat.backupSpeed, 130);
    } else {
      this.state = 'attack';
      if (time > this.nextStrafeChange) {
        this.strafeDir *= -1;
        this.nextStrafeChange = time + cfg.combat.strafeChangeMs;
      }
      const sAngle = this.aimAngle + Math.PI / 2 * this.strafeDir;
      const strafeSpeed = 150 * cfg.combat.strafeSpeed;
      this.setVelocity(Math.cos(sAngle) * strafeSpeed, Math.sin(sAngle) * strafeSpeed);
    }

    this._aimAt(target.x, target.y);
    this._moveGunForAim();
    this._tryFire(time);
  }

  _aimAt(tx, ty) {
    const dx = tx - this.x;
    const dy = ty - this.y;
    let a = Math.atan2(dy, dx);
    const jitter = (this.cfg.combat.aimJitterDeg || 0) * Math.PI / 180;
    a += (Math.random() - 0.5) * jitter * 2;
    this.aimAngle = a;
    this.setRotation(a);
  }

  _moveGunForAim() {
    const s = this.slots[this.activeSlot];
    if (!s || !s.gunSprite || !s.gunSprite.active) return;
    const g = s.gunSprite;
    const mountX = this.x + Math.cos(this.aimAngle) * ENEMY_MOUNT_OFFSET;
    const mountY = this.y + Math.sin(this.aimAngle) * ENEMY_MOUNT_OFFSET;
    g.setPosition(mountX, mountY);
    g.setRotation(this.aimAngle);
  }

  _tryFire(time) {
    const s = this.slots[this.activeSlot];
    if (!s) return;
    if (this.reloadEndsAt > 0) return;

    if (time - this.lastShot <= s.weapon.fireRate) return;

    const type = s.ammoType || 'light';
    const pool = this.ammoReserve[type] || 0;

    if (s.ammo <= 0) {
      // Try other slot
      const other = this.activeSlot === 0 ? 1 : 0;
      if (this.slots[other] && this.slots[other].ammo > 0) {
        this.switchSlot(other);
        return;
      }
      // Start reload
      if (pool > 0 && this.reloadEndsAt === 0) {
        this.reloadEndsAt = time + s.weapon.reloadTime;
      }
      return;
    }

    // Check if reload ends
    this.lastShot = time;
    s.ammo--;

    const g = s.gunSprite;
    if (!g || !g.active) return;
    const gunLen = g.displayLength || 60;
    const muzzleX = g.x + Math.cos(this.aimAngle) * gunLen;
    const muzzleY = g.y + Math.sin(this.aimAngle) * gunLen;

    const spread = s.weapon.spread * (this.cfg.combat.spreadMultiplier || 1);
    for (let i = 0; i < s.weapon.pellets; i++) {
      const a = this.aimAngle + (Math.random() - 0.5) * spread * 2;
      this.scene.spawnBullet(muzzleX, muzzleY, a, 'enemy', s.weapon, this);
    }

    // Play gun sound (volume scales with distance to player)
    this.scene.playGunSound(s.key, muzzleX, muzzleY, false);
  }

  // Called each frame BEFORE preUpdate to finish reloading
  _updateReload(time) {
    if (this.reloadEndsAt === 0) return;
    if (time < this.reloadEndsAt) return;
    const s = this.slots[this.activeSlot];
    if (!s) { this.reloadEndsAt = 0; return; }
    const type = s.ammoType || 'light';
    const pool = this.ammoReserve[type] || 0;
    const need = s.weapon.magSize - s.ammo;
    const give = Math.min(need, pool);
    s.ammo += give;
    this.ammoReserve[type] = pool - give;
    this.reloadEndsAt = 0;
  }

  // ============================================
  // Loot AI
  // ============================================
  // Does the bot own a weapon that consumes this ammo type?
  _wantsAmmoType(type) {
    for (let i = 0; i < 2; i++) {
      const s = this.slots[i];
      if (s && (s.ammoType || 'light') === type) return true;
    }
    return false;
  }

  _needKind() {
    const cfg = this.cfg.loot;

    // No gun at all -> desperately needs weapon
    if (!this.slots[0] && !this.slots[1]) return 'weapon';

    // Health is critical
    if (this.health < cfg.wantHealthIfBelow) return 'health';

    // Empty slot
    if (!this.slots[0] || !this.slots[1]) return 'weapon';

    // Ammo low — this has HIGHER priority than armor when any weapon
    // is dry or very low
    let ammoLow = false;
    for (let i = 0; i < 2; i++) {
      const s = this.slots[i];
      if (!s) continue;
      const type = s.ammoType || 'light';
      const pool = this.ammoReserve[type] || 0;
      const pct = (s.ammo + pool) / (s.weapon.magSize * 3);
      if (pct < cfg.ammoPickupIfBelowPercent / 100) { ammoLow = true; break; }
    }
    if (ammoLow) return 'ammo';

    // Armor
    if (this.armor < cfg.wantArmorIfBelow) return 'armor';

    return null;
  }

  _wantsPickup(p) {
    if (!p || !p.active) return false;

    if (p.kind === 'health') {
      return this.health < this.maxHealth - 5;
    }
    if (p.kind === 'armor') {
      return this.armor < this.maxArmor - 5;
    }
    if (p.kind === 'ammo') {
      const type = p.ammoType || 'light';
      const cap = AMMO_INFO[type].maxReserve;
      const have = this.ammoReserve[type] || 0;
      // Want ammo if any equipped weapon uses this type AND reserve not full
      let relevant = false;
      for (let i = 0; i < 2; i++) {
        const s = this.slots[i];
        if (s && (s.ammoType || 'light') === type) relevant = true;
      }
      return relevant && have < cap - 10;
    }
    if (p.kind === 'weapon') {
      if (!this.slots[0] || !this.slots[1]) return true;
      for (let i = 0; i < 2; i++) {
        if (this.slots[i] && this.slots[i].key === p.weaponKey) return false;
      }
      return this._shouldReplaceWeapon(p.weapon);
    }
    return false;
  }

  _findWantedPickup(kind) {
    const list = this.scene.pickupGroup.getChildren();
    let best = null, bestD = Infinity;
    const maxR = this.cfg.loot.searchRadius;
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      if (!p.active) continue;
      if (kind && p.kind !== kind) continue;
      if (!this._wantsPickup(p)) continue;
      const d = Phaser.Math.Distance.Between(this.x, this.y, p.x, p.y);
      if (d < bestD && d < maxR) { bestD = d; best = p; }
    }
    return best;
  }

  _tryPickup(p) {
    if (!p || !p.active) return;

    if (p.kind === 'weapon') {
      const hasEmpty = !this.slots[0] || !this.slots[1];
      const alreadyHas = this.slots.some(s => s && s.key === p.weaponKey);
      if (alreadyHas) {
        const s = this.slots.find(s => s && s.key === p.weaponKey);
        s.ammo += p.ammoInMag;
        p.destroyPickup();
        return;
      }
      const ok = this.giveWeapon(p.weaponKey, p.ammoInMag, 0, !hasEmpty);
      if (ok) p.destroyPickup();
    } else if (p.kind === 'armor') {
      this.armor = Math.min(this.maxArmor, this.armor + p.amount);
      p.destroyPickup();
    } else if (p.kind === 'health') {
      this.health = Math.min(this.maxHealth, this.health + p.amount);
      p.destroyPickup();
    } else if (p.kind === 'ammo') {
      const type = p.ammoType || 'light';
      const cap = AMMO_INFO[type].maxReserve;
      this.ammoReserve[type] = Math.min(cap, (this.ammoReserve[type] || 0) + p.amount);
      p.destroyPickup();
    }
  }

  _shouldReplaceWeapon(newW) {
    const dps = (w) => (w.damage * w.pellets) / (w.fireRate / 1000);
    const newDPS = dps(newW);
    let worst = null;
    for (let i = 0; i < 2; i++) {
      const s = this.slots[i];
      if (!s) continue;
      if (!worst || dps(s.weapon) < dps(worst.weapon)) worst = s;
    }
    if (!worst) return false;
    return dps(worst.weapon) * 2 < newDPS;
  }

  _pickWeaponForDistance(dist) {
    const cfgW = this.cfg.weaponChoice;
    const a = this.slots[0], b = this.slots[1];
    if (!a && !b) return;
    if (!a) { this.switchSlot(1); return; }
    if (!b) { this.switchSlot(0); return; }

    const aRange = a.weapon.range, bRange = b.weapon.range;
    const aDPS = (a.weapon.damage * a.weapon.pellets) / (a.weapon.fireRate / 1000);
    const bDPS = (b.weapon.damage * b.weapon.pellets) / (b.weapon.fireRate / 1000);
    const cur = this.activeSlot;
    const curRange = (cur === 0 ? aRange : bRange);
    const otherRange = (cur === 0 ? bRange : aRange);
    const curDPS = (cur === 0 ? aDPS : bDPS);
    const otherDPS = (cur === 0 ? bDPS : aDPS);

    let ideal;
    if (dist <= cfgW.closeRangeMax) {
      ideal = (aRange <= bRange) ? 0 : 1;
    } else if (dist >= cfgW.longRangeMin) {
      ideal = (aRange >= bRange) ? 0 : 1;
    } else {
      ideal = (aDPS >= bDPS) ? 0 : 1;
    }

    if (ideal === cur) return;

    let switchOk = false;
    if (dist <= cfgW.closeRangeMax || dist >= cfgW.longRangeMin) {
      const advantage = (dist <= cfgW.closeRangeMax)
        ? (curRange > otherRange * 1.25)
        : (curRange < otherRange * 0.8);
      switchOk = advantage;
    } else {
      switchOk = curDPS * 1.4 < otherDPS;
    }

    const now = this.scene.time.now;
    if (switchOk && now - (this._lastSlotSwitch || 0) > 1200) {
      this._lastSlotSwitch = now;
      this.switchSlot(ideal);
    }
  }

  _moveToward(tx, ty, speedMult, baseSpeed) {
    const dx = tx - this.x;
    const dy = ty - this.y;
    const d = Math.hypot(dx, dy);
    if (d < 2) { this.setVelocity(0, 0); return; }
    const s = baseSpeed * (speedMult || 1);
    const baseAngle = Math.atan2(dy, dx);

    // ---- Proactive obstacle avoidance (fan of rays) ----
    // CRITICAL: rays must start from the EDGE of the bot's body,
    // not from its center, otherwise we detect "clear" even when
    // our body is already touching the obstacle.
    const bodyHalf = Math.max(this.body.halfWidth, this.body.halfHeight) || 26;
    const probeStart = bodyHalf + 4;   // just past the body edge
    const dists = [probeStart, probeStart + 40, probeStart + 90];
    const angles = [
      baseAngle,
      baseAngle - Math.PI / 8,   // 22.5° left
      baseAngle + Math.PI / 8,   // 22.5° right
      baseAngle - Math.PI / 4,   // 45° left
      baseAngle + Math.PI / 4,   // 45° right
      baseAngle - Math.PI / 2,   // 90° left
      baseAngle + Math.PI / 2,   // 90° right
      baseAngle - Math.PI * 0.75,
      baseAngle + Math.PI * 0.75,
      baseAngle + Math.PI,       // backward
    ];

    // Score each angle: higher = more open
    let bestAngle = baseAngle;
    let bestScore = -1;
    for (let i = 0; i < angles.length; i++) {
      const a = angles[i];
      const ca = Math.cos(a), sa = Math.sin(a);
      let blockedAt = dists[dists.length - 1] + 1;
      for (let k = 0; k < dists.length; k++) {
        if (this.scene.pointHitsObstacle(this.x + ca * dists[k], this.y + sa * dists[k])) {
          blockedAt = dists[k];
          break;
        }
      }
      // Score: prefer open, prefer aligned with desired direction
      // Alignment weight: 1.0 at 0°, 0 at 180°
      const align = (Math.cos(a - baseAngle) + 1) * 0.5;   // 0..1
      const openness = blockedAt / (dists[dists.length - 1] + 1);  // 0..1
      const score = openness * 0.6 + align * 0.4;

      if (score > bestScore) {
        bestScore = score;
        bestAngle = a;
      }
    }

    // If the straight path is fully open (score ~1), no avoidance needed
    if (bestAngle === baseAngle) {
      this.setVelocity(Math.cos(baseAngle) * s, Math.sin(baseAngle) * s);
      return;
    }

    this.setVelocity(Math.cos(bestAngle) * s, Math.sin(bestAngle) * s);
  }

  // ============================================
  // A* NAVIGATION (macro) + local steering (micro)
  // ============================================
  // High-level: pick a path to target, follow waypoints.
  // Uses scene.pathfinder (A* on tile grid). Falls back to pure local
  // steering (_moveToward) when A* isn't available or target is visible.
  _navigateTo(tx, ty, speedMult, baseSpeed) {
    const pf = this.scene.pathfinder;
    const time = this.scene.time.now;

    // No pathfinder or currently backing off from failure → local steering only
    if (!pf || time < this._pathFailUntil) {
      this._moveToward(tx, ty, speedMult, baseSpeed);
      return;
    }

    // ---- Decide whether we need a new path ----
    const targetMoved = Math.hypot(tx - this._pathTargetX, ty - this._pathTargetY);
    const needReplan =
      !this._path ||
      this._pathIdx >= this._path.length ||
      time - this._pathTime > this._pathReplanMs ||
      targetMoved > this._pathTargetTol;

    if (needReplan) {
      // Direct LOS to target? Skip A* entirely (cheap path).
      if (pf.hasLOS(this.x, this.y, tx, ty)) {
        this._path = [{ x: tx, y: ty }];
        this._pathIdx = 0;
      } else {
        const path = pf.getSmoothedPath(this.x, this.y, tx, ty);
        if (path && path.length > 0) {
          this._path = path;
          this._pathIdx = 0;
        } else {
          // A* failed → back off for a while, use local steering
          this._pathFailUntil = time + 800;
          this._path = null;
          this._moveToward(tx, ty, speedMult, baseSpeed);
          return;
        }
      }
      this._pathTargetX = tx;
      this._pathTargetY = ty;
      this._pathTime = time;
    }

    // ---- Advance past reached waypoints ----
    while (this._pathIdx < this._path.length) {
      const wp = this._path[this._pathIdx];
      const d = Math.hypot(wp.x - this.x, wp.y - this.y);
      if (d < this._pathWpReachTol) this._pathIdx++;
      else break;
    }

    // ---- Follow the current waypoint via local steering ----
    if (this._pathIdx < this._path.length) {
      const wp = this._path[this._pathIdx];
      this._moveToward(wp.x, wp.y, speedMult, baseSpeed);
    } else {
      // Path exhausted but not at exact target — steer straight
      this._moveToward(tx, ty, speedMult, baseSpeed);
    }
  }

  pickPatrolTarget(time) {
    const map = this.scene.mapGen;
    if (!map) return;
    // Wander across the WHOLE map so bots don't cluster.
    // Prefer tiles that are far from current position.
    const mapDiag = Math.hypot(map.width, map.height);
    let best = null, bestScore = -1;
    for (let tries = 0; tries < 40; tries++) {
      const t = map.randomWalkableTile();
      const wx = t.tx * map.tileSize + map.tileSize / 2;
      const wy = t.ty * map.tileSize + map.tileSize / 2;
      const d = Phaser.Math.Distance.Between(this.x, this.y, wx, wy);
      // Prefer distance between 500 and 3500 (whole-map wander)
      let score = 0;
      if (d < 400) score = d / 400 * 0.3;         // low score if too close
      else if (d > mapDiag * 0.9) score = 0.5;     // ok but not best
      else score = 1.0;                             // ideal
      // Also avoid tiles close to other bots (spread out)
      const bots = this.scene.bots || [];
      let minBotDist = Infinity;
      for (let k = 0; k < bots.length; k++) {
        const b = bots[k];
        if (b === this || !b.alive) continue;
        const bd = Phaser.Math.Distance.Between(b.x, b.y, wx, wy);
        if (bd < minBotDist) minBotDist = bd;
      }
      if (minBotDist < 300) score *= 0.3;
      else if (minBotDist > 800) score *= 1.2;

      if (score > bestScore) {
        bestScore = score;
        best = { x: wx, y: wy };
      }
    }
    this.patrolTarget = best;
    this.patrolSince = time;
  }

  _updateVisuals() {
    this.hpBarBg.setPosition(this.x, this.y - 34);
    this.hpBar.setPosition(this.x - 23, this.y - 34);
    this.hpBar.width = 46 * Math.max(0, this.health / this.maxHealth);
    this.nameTag.setPosition(this.x, this.y - 48);
  }
}

window.Enemy = Enemy;