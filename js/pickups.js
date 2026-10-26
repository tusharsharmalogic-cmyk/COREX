// ============================================
// COREX - Pickups (Weapon, Armor, Health, Ammo)
//  Ammo pickups carry an ammoType: light/heavy/shells
// ============================================

const PICKUP_TEX = {
  armor:      'pu_armor',
  health:     'pu_health',
  ammo_light: 'pu_ammo_light',
  ammo_heavy: 'pu_ammo_heavy',
  ammo_shells:'pu_ammo_shells',
};

function ensurePickupTextures(scene) {
  if (scene.textures.exists('pu_armor')) return;

  // Armor (blue shield)
  let g = scene.make.graphics({ add: false });
  g.fillStyle(0x1f3a5f, 1); g.fillCircle(24, 24, 22);
  g.fillStyle(0x3498db, 1); g.fillCircle(24, 24, 18);
  g.fillStyle(0x1f3a5f, 1);
  g.beginPath(); g.moveTo(24, 8); g.lineTo(38, 16); g.lineTo(38, 28);
  g.lineTo(24, 40); g.lineTo(10, 28); g.lineTo(10, 16); g.closePath();
  g.fillPath();
  g.fillStyle(0xffffff, 0.9); g.fillRect(20, 14, 8, 16); g.fillRect(16, 18, 16, 8);
  g.generateTexture('pu_armor', 48, 48); g.destroy();

  // Health (green cross)
  g = scene.make.graphics({ add: false });
  g.fillStyle(0x0f3320, 1); g.fillCircle(24, 24, 22);
  g.fillStyle(0x27ae60, 1); g.fillCircle(24, 24, 18);
  g.fillStyle(0xffffff, 1);
  g.fillRect(19, 10, 10, 28); g.fillRect(10, 19, 28, 10);
  g.generateTexture('pu_health', 48, 48); g.destroy();

  // Ammo textures - 3 colors
  const makeAmmo = (key, ringColor, bulletColor) => {
    const g2 = scene.make.graphics({ add: false });
    g2.fillStyle(0x1a1a1a, 1); g2.fillCircle(24, 24, 22);
    g2.fillStyle(ringColor, 1); g2.fillCircle(24, 24, 18);
    g2.fillStyle(bulletColor, 1);
    for (let i = 0; i < 3; i++) {
      g2.fillRect(12 + i * 8, 14, 5, 20);
    }
    g2.fillStyle(0x000000, 0.35);
    for (let i = 0; i < 3; i++) {
      g2.fillRect(12 + i * 8, 30, 5, 4);
    }
    g2.generateTexture(key, 48, 48); g2.destroy();
  };
  makeAmmo('pu_ammo_light',  0xf1c40f, 0xfff4b0);   // yellow
  makeAmmo('pu_ammo_heavy',  0xe67e22, 0xffc880);   // orange
  makeAmmo('pu_ammo_shells', 0xe74c3c, 0xffaaaa);   // red

  // Glow ring
  g = scene.make.graphics({ add: false });
  g.lineStyle(3, 0xffffff, 0.9); g.strokeCircle(24, 24, 22);
  g.generateTexture('pu_glow', 48, 48); g.destroy();
}

// ============================================
// Base Pickup
// ============================================
class BasePickup extends Phaser.Physics.Arcade.Sprite {
  constructor(scene, x, y, texture, glowColor) {
    super(scene, x, y, texture);
    scene.add.existing(this);
    scene.physics.add.existing(this);

    this.setDepth(6);
    this.setScale(0.85);

    this.glow = scene.add.image(x, y, 'pu_glow')
      .setDepth(5).setAlpha(0.55).setScale(0.95)
      .setTint(glowColor || 0xffffff);
    scene.tweens.add({
      targets: this.glow, alpha: 0.15, scale: 1.15,
      duration: 900, yoyo: true, repeat: -1, ease: 'Sine.inOut',
    });

    const r = 22;
    if (this.body) {
      this.body.setCircle(r, this.width / 2 - r, this.height / 2 - r);
      this.body.setAllowGravity(false);
      this.body.setImmovable(true);
      this.body.moves = false;
    }

    this.label = null;
  }

  describe() { return ''; }

  destroyPickup() {
    // Notify scene for batch-respawn logic
    if (this.scene && this.scene.notifyPickupRemoved && this._lootKind) {
      this.scene.notifyPickupRemoved(this._lootKind);
    }
    if (this.glow) this.glow.destroy();
    if (this.label) this.label.destroy();
    if (this.scene) {
      this.scene.tweens.killTweensOf(this);
      if (this.glow) this.scene.tweens.killTweensOf(this.glow);
    }
    this.destroy();
  }
}

// ============================================
// Weapon Pickup
// ============================================
class WeaponPickup extends BasePickup {
  constructor(scene, x, y, weaponKey, ammoInMag, opts) {
    const W = WEAPONS[weaponKey];
    const glow = (W && W.bulletColor) ? W.bulletColor : 0xf1c40f;
    super(scene, x, y, weaponKey, glow);

    this.kind = 'weapon';
    this.weaponKey = weaponKey;
    this.weapon = W;
    this.ammoType = (AMMO_TYPE[weaponKey]) || 'light';
    this.ammoInMag = (typeof ammoInMag === 'number') ? ammoInMag
                    : (W ? W.magSize : 0);

    scene.tweens.killTweensOf(this);

    const targetW = 90;
    this.setScale(targetW / this.width);
    if (this.body) {
      const r = Math.max(20, targetW * 0.35);
      this.body.setCircle(r, this.width / 2 - r, this.height / 2 - r);
    }

    scene.tweens.add({ targets: this, angle: 360, duration: 7000, repeat: -1 });

    if (W) {
      this.label = scene.add.text(x, y + 40, W.name, {
        fontFamily: 'Arial', fontSize: '12px', color: '#f1c40f',
        fontStyle: 'bold', stroke: '#000', strokeThickness: 3,
      }).setOrigin(0.5).setDepth(7);
    }
  }

  describe() { return this.weapon ? this.weapon.name : ''; }
}

// ============================================
// Armor Pickup
// ============================================
class ArmorPickup extends BasePickup {
  constructor(scene, x, y, amount) {
    super(scene, x, y, PICKUP_TEX.armor, 0x3498db);
    this.kind = 'armor';
    this.amount = amount || 50;
    this.label = scene.add.text(x, y + 40, '+' + this.amount + ' ARM', {
      fontFamily: 'Arial', fontSize: '12px', color: '#3498db',
      fontStyle: 'bold', stroke: '#000', strokeThickness: 3,
    }).setOrigin(0.5).setDepth(7);
    scene.tweens.add({
      targets: this, scale: 0.95, duration: 700,
      yoyo: true, repeat: -1, ease: 'Sine.inOut',
    });
  }
  describe() { return 'Armor +' + this.amount; }
}

// ============================================
// Health Pickup
// ============================================
class HealthPickup extends BasePickup {
  constructor(scene, x, y, amount) {
    super(scene, x, y, PICKUP_TEX.health, 0x27ae60);
    this.kind = 'health';
    this.amount = amount || 30;
    this.label = scene.add.text(x, y + 40, '+' + this.amount + ' HP', {
      fontFamily: 'Arial', fontSize: '12px', color: '#27ae60',
      fontStyle: 'bold', stroke: '#000', strokeThickness: 3,
    }).setOrigin(0.5).setDepth(7);
    scene.tweens.add({
      targets: this, scale: 0.95, duration: 700,
      yoyo: true, repeat: -1, ease: 'Sine.inOut',
    });
  }
  describe() { return 'Health +' + this.amount; }
}

// ============================================
// Ammo Pickup (typed: light / heavy / shells)
// ============================================
class AmmoPickup extends BasePickup {
  constructor(scene, x, y, amount, ammoType) {
    const type = ammoType || 'light';
    const info = AMMO_INFO[type] || AMMO_INFO.light;
    const tex  = PICKUP_TEX['ammo_' + type] || PICKUP_TEX.ammo_light;
    super(scene, x, y, tex, info.color);

    this.kind = 'ammo';
    this.amount = amount || 30;
    this.ammoType = type;

    this.label = scene.add.text(x, y + 40, '+' + this.amount + ' ' + info.name, {
      fontFamily: 'Arial', fontSize: '11px', color: '#fff',
      fontStyle: 'bold', stroke: '#000', strokeThickness: 3,
    }).setOrigin(0.5).setDepth(7);

    scene.tweens.add({
      targets: this, scale: 0.95, duration: 700,
      yoyo: true, repeat: -1, ease: 'Sine.inOut',
    });
  }
  describe() { return this.ammoType.toUpperCase() + ' x' + this.amount; }
}

window.ensurePickupTextures = ensurePickupTextures;
window.BasePickup    = BasePickup;
window.WeaponPickup  = WeaponPickup;
window.ArmorPickup   = ArmorPickup;
window.HealthPickup  = HealthPickup;
window.AmmoPickup    = AmmoPickup;