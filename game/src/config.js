// EMBERLINE — configuration: geometry, palettes, tools and tuning.
// Everything the other modules need to agree on lives here so the game can be
// rebalanced from one place.

// The play field is a grid of square cells drawn on a 1152x768 canvas; the
// right-hand strip is the HUD panel, the field itself is 864x768.
export const VIEW = {
  width: 1152,
  height: 768,
  fieldX: 0,
  fieldY: 0,
  cell: 24, // pixels per cell edge
  cols: 36, // 36 * 24 = 864 px of field
  rows: 32, // 32 * 24 = 768 px of field
  panelX: 864,
  panelW: 288,
};

// Cell terrain kinds. Fuel is how much a cell can burn; a cell with fuel 0
// (dirt, water, ash, rock) can never catch.
export const TERRAIN = {
  grass: { fuel: 0.55, spread: 0.75, label: 'Dry grass' },
  forest: { fuel: 1.0, spread: 1.0, label: 'Pine forest' },
  dense: { fuel: 1.45, spread: 1.25, label: 'Dense old growth' },
  scrub: { fuel: 0.8, spread: 1.1, label: 'Scrub and brush' },
  dirt: { fuel: 0, spread: 0, label: 'Bare earth' },
  water: { fuel: 0, spread: 0, label: 'Water' },
  rock: { fuel: 0, spread: 0, label: 'Rock' },
  ash: { fuel: 0, spread: 0, label: 'Ash' },
  house: { fuel: 0.9, spread: 0.9, label: 'House' },
  hall: { fuel: 1.1, spread: 0.9, label: 'Town hall' },
};

// Colours for terrain, drawn as layered fills in render.js. Each entry is
// [base, shade] so a cell can be given a deterministic two-tone variation.
export const TERRAIN_COLORS = {
  grass: ['#7d9b4a', '#74913f'],
  forest: ['#2e5d33', '#27512c'],
  dense: ['#1d4226', '#17351e'],
  scrub: ['#8a7a3a', '#7e7033'],
  dirt: ['#9a7d55', '#8f744c'],
  water: ['#2d6f9f', '#27648f'],
  rock: ['#7a7d84', '#6d7076'],
  ash: ['#3c3a38', '#333130'],
  house: ['#b08954', '#a37c49'],
  hall: ['#b08954', '#a37c49'],
};

// Fire states a cell moves through: intact -> burning -> ash. A controlled
// (backfire) burn is flagged separately because it spreads gently and never
// throws embers.
export const FIRE = {
  burnTime: 7.5, // seconds a full-fuel cell burns before it is ash
  tick: 0.5, // simulation step, seconds of game time
  baseSpread: 0.115, // per-tick ignition chance before modifiers
  emberRange: 3, // cells an ember can jump downwind at full wind
};

// The three tools on the belt. Costs are drawn from two meters: water for the
// soak, stamina for the axe. Backfire is free but dangerous.
export const TOOLS = {
  cut: { key: '1', name: 'Cut break', hint: 'Clear fuel to bare earth. Drag to carve a line.', stamina: 6 },
  soak: { key: '2', name: 'Soak', hint: 'Helicopter water drop, 3x3. Douses fire, wets fuel.', water: 22 },
  backfire: { key: '3', name: 'Backfire', hint: 'Light a controlled burn that eats fuel gently.', stamina: 2 },
};

export const METERS = {
  waterMax: 100,
  waterRegen: 2.6, // per second
  staminaMax: 100,
  staminaRegen: 9, // per second
};

// Score: every intact cell saved at nightfall pays, houses pay far more, and
// a night finished fast pays a tempo bonus.
export const SCORE = {
  perCellSaved: 2,
  perHouse: 250,
  perHall: 750,
  tempoPerSecond: 6,
  tempoWindow: 150, // seconds of night budget the tempo bonus is measured on
};

// The seven nights of the campaign. Terrain generation reads density and
// river/lake flags; the sim reads wind, dryness and ignition counts. Night 7
// is the firestorm: the wind veers mid-night (world.js handles `veers`).
export const NIGHTS = [
  { name: 'First Smoke', windDir: 4, windSpeed: 0.25, dryness: 0.8, strikes: 2, forest: 0.5, river: false, lake: true, houses: 5 },
  { name: 'East Wind Rising', windDir: 4, windSpeed: 0.4, dryness: 0.95, strikes: 3, forest: 0.58, river: true, lake: false, houses: 6 },
  { name: 'The Dry Creek', windDir: 3, windSpeed: 0.45, dryness: 1.1, strikes: 3, forest: 0.55, river: true, lake: true, houses: 6 },
  { name: 'Ember Weather', windDir: 5, windSpeed: 0.6, dryness: 1.15, strikes: 4, forest: 0.62, river: false, lake: true, houses: 7 },
  { name: 'Long Night of Sparks', windDir: 4, windSpeed: 0.55, dryness: 1.25, strikes: 5, forest: 0.66, river: true, lake: false, houses: 7 },
  { name: 'The Crown Fire', windDir: 3, windSpeed: 0.75, dryness: 1.35, strikes: 5, forest: 0.7, river: true, lake: true, houses: 8 },
  { name: 'Firestorm', windDir: 4, windSpeed: 0.9, dryness: 1.5, strikes: 7, forest: 0.72, river: true, lake: true, houses: 8, veers: true },
];

// Wind directions, indexed 0..7 clockwise from east, as [dx, dy] cell steps
// pointing where the wind blows TOWARD. The panel names the opposite point —
// where it blows FROM. Most nights blow westward, off the east ridge where
// the lightning lands, down toward the village.
export const WIND_DIRS = [
  [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1],
];
export const WIND_NAMES = ['east', 'south-east', 'south', 'south-west', 'west', 'north-west', 'north', 'north-east'];

// Between-night upgrades: the workshop. Three are offered, the player picks
// one; each is a small, legible change to the meters or tools.
export const UPGRADES = [
  { id: 'tank', name: 'Bigger Tank', desc: '+40 max water on the helicopter.', apply: (m) => { m.waterMax += 40; } },
  { id: 'pump', name: 'Faster Pump', desc: 'Water refills 60% faster.', apply: (m) => { m.waterRegen *= 1.6; } },
  { id: 'bucket', name: 'Wide Bucket', desc: 'Soak covers 5x5 instead of 3x3.', apply: (m, t) => { t.soakRadius = 2; } },
  { id: 'crew', name: 'Second Crew', desc: 'Cutting costs half the stamina.', apply: (m, t) => { t.cutCostMul = 0.5; } },
  { id: 'boots', name: 'Fresh Boots', desc: '+40 max stamina, faster recovery.', apply: (m) => { m.staminaMax += 40; m.staminaRegen *= 1.4; } },
  { id: 'shutters', name: 'Ember Shutters', desc: 'Houses resist ignition twice as long.', apply: (m, t) => { t.houseArmor = 2; } },
  { id: 'well', name: 'Village Well', desc: 'Start each night with a full tank and a spare 30 water in reserve.', apply: (m, t) => { t.reserveWater += 30; } },
  { id: 'lantern', name: 'Storm Lantern', desc: 'Backfires burn 40% slower and safer.', apply: (m, t) => { t.backfireCalm = 0.6; } },
];
