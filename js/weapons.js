// ============================================
// COREX - Weapon display widths + ammo type map
// Actual stats loaded from weapons.json
// ============================================

const GUN_DISPLAY_WIDTHS = {
  pistol:   40,
  smg:      55,
  ak47:     70,
  m416:     70,
  shotgun:  68,
  sniper:   85,
  lmg:      80,
};

// 3 ammo categories:
//   light  -> pistol, smg
//   heavy  -> ak47, m416, lmg
//   shells -> shotgun, sniper
const AMMO_TYPE = {
  pistol:  'light',
  smg:     'light',
  ak47:    'heavy',
  m416:    'heavy',
  lmg:     'heavy',
  shotgun: 'shells',
  sniper:  'shells',
};

const AMMO_INFO = {
  light:  { name: 'LIGHT',  color: 0xf1c40f, maxReserve: 500 },
  heavy:  { name: 'HEAVY',  color: 0xe67e22, maxReserve: 400 },
  shells: { name: 'SHELLS', color: 0xe74c3c, maxReserve: 120 },
};

window.GUN_DISPLAY_WIDTHS = GUN_DISPLAY_WIDTHS;
window.AMMO_TYPE  = AMMO_TYPE;
window.AMMO_INFO  = AMMO_INFO;