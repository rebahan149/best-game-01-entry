// The fire simulation. A fixed-step cellular model: burning cells try to
// ignite their neighbours, the wind bends those chances downwind and throws
// embers, water and bare earth refuse to burn, and a backfire eats fuel at a
// walking pace so the main fire starves when it arrives.
//
// The world reports what happens through `events` (ignitions, splashes,
// houses lost) which the shell drains each frame for sound and particles;
// the simulation itself never touches the canvas or the speakers.

import { FIRE, TERRAIN, TOOLS, WIND_DIRS } from './config.js';

const NEIGHBOURS = [
  [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1],
];

export function createWorld(def, layout, metersCfg, mods, rng) {
  const cols = layout.cols;
  const rows = layout.rows;
  const cells = layout.cells;

  const world = {
    def,
    cells,
    cols,
    rows,
    rng,
    time: 0,
    tickCarry: 0,
    windDir: def.windDir,
    veerTimer: 40,
    water: metersCfg.waterMax + (mods.reserveWater || 0),
    waterCap: metersCfg.waterMax,
    waterMaxFull: metersCfg.waterMax + (mods.reserveWater || 0),
    stamina: metersCfg.staminaMax,
    staminaMaxFull: metersCfg.staminaMax,
    burning: 0,
    burnedCells: 0,
    housesLost: 0,
    housesTotal: layout.houses.length,
    events: [],
    over: false,
    won: false,

    idx: (x, y) => y * cols + x,
    inBounds: (x, y) => x >= 0 && y >= 0 && x < cols && y < rows,

    ignite(idx, controlled) {
      const c = cells[idx];
      if (!c || c.state !== 'intact' || c.fuel <= 0) return false;
      c.state = 'burning';
      c.burn = 0;
      c.controlled = !!controlled;
      this.burning++;
      this.events.push({ type: controlled ? 'backfire' : 'ignite', idx });
      if (c.kind === 'house' || c.kind === 'hall') {
        this.events.push({ type: 'houseFire', idx });
      }
      return true;
    },

    start() {
      for (const idx of layout.ignitions) this.ignite(idx, false);
    },

    // One fixed simulation step.
    tick() {
      const dt = FIRE.tick;
      this.time += dt;
      const [wx, wy] = WIND_DIRS[this.windDir];
      const gust = 0.85 + 0.3 * Math.sin(this.time * 0.45);
      const wind = this.def.windSpeed * gust;

      // The firestorm veers: late in night 7 the wind swings a point at a
      // time, and a firebreak dug for the old wind is suddenly wrong.
      if (this.def.veers) {
        this.veerTimer -= dt;
        if (this.veerTimer <= 0) {
          this.veerTimer = 38 + this.rng.next() * 20;
          this.windDir = (this.windDir + (this.rng.chance(0.5) ? 1 : 7)) % 8;
          this.events.push({ type: 'veer', dir: this.windDir });
        }
      }

      const toIgnite = [];
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const i = y * cols + x;
          const c = cells[i];
          if (c.wet > 0) c.wet = Math.max(0, c.wet - dt);
          if (c.state !== 'burning') continue;

          c.burn += dt;
          const burnSeconds = FIRE.burnTime * Math.max(0.35, c.fuel);
          if (c.burn >= burnSeconds) {
            c.state = 'ash';
            c.kind = 'ash';
            c.fuel = 0;
            this.burning--;
            this.burnedCells++;
            if (layout.houses.includes(i)) {
              this.housesLost++;
              this.events.push({ type: 'houseLost', idx: i });
            }
            continue;
          }

          const intensity = Math.min(1, c.burn / 2.2);
          const calm = c.controlled ? 0.32 * (mods.backfireCalm || 1) : 1;

          for (const [dx, dy] of NEIGHBOURS) {
            const nx = x + dx;
            const ny = y + dy;
            if (!this.inBounds(nx, ny)) continue;
            const n = cells[ny * cols + nx];
            if (n.state !== 'intact' || n.fuel <= 0 || n.wet > 0) continue;
            const align = (dx * wx + dy * wy) / Math.max(1, Math.hypot(dx, dy));
            let p = FIRE.baseSpread * TERRAIN[n.kind].spread * this.def.dryness * calm;
            p *= 0.45 + 0.55 * intensity;
            p *= 1 + align * wind * 1.9;
            if (n.kind === 'house' || n.kind === 'hall') p /= mods.houseArmor || 1;
            if (p > 0 && this.rng.chance(Math.min(0.92, p))) toIgnite.push(ny * cols + nx);
          }

          // Ember spotting: a mature wildland fire throws sparks downwind
          // that can jump a narrow break. Backfires never do.
          if (!c.controlled && intensity > 0.7 && this.rng.chance(0.028 + wind * 0.05)) {
            const jump = this.rng.int(2, FIRE.emberRange);
            const ex = x + wx * jump + this.rng.int(-1, 1);
            const ey = y + wy * jump + this.rng.int(-1, 1);
            if (this.inBounds(ex, ey)) {
              const t = cells[ey * cols + ex];
              if (t.state === 'intact' && t.fuel > 0 && t.wet <= 0) {
                toIgnite.push(ey * cols + ex);
                this.events.push({ type: 'ember', idx: ey * cols + ex });
              }
            }
          }
        }
      }
      for (const idx of toIgnite) this.ignite(idx, false);

      // Meters recover while the crew works.
      this.water = Math.min(this.waterCap, this.water + metersCfg.waterRegen * dt);
      this.stamina = Math.min(metersCfg.staminaMax, this.stamina + metersCfg.staminaRegen * dt);

      if (this.burning <= 0 && this.time > 1) this.finish(true);
      const hall = cells[layout.hall];
      if (hall.state === 'ash' || this.housesLost * 2 > this.housesTotal) this.finish(false);
    },

    finish(won) {
      if (this.over) return;
      this.over = true;
      this.won = won && cells[layout.hall].state !== 'ash';
      this.events.push({ type: this.won ? 'nightWon' : 'nightLost' });
    },

    // Advance real time, stepping the fixed-step sim as needed.
    step(dt) {
      if (this.over) return;
      this.tickCarry += dt;
      while (this.tickCarry >= FIRE.tick) {
        this.tickCarry -= FIRE.tick;
        this.tick();
        if (this.over) break;
      }
    },

    // Apply a tool at a cell. Returns true when something happened (and the
    // cost was paid); the shell uses it for sound and cursor feedback.
    applyTool(tool, x, y) {
      if (this.over || !this.inBounds(x, y)) return false;
      const i = y * cols + x;
      const c = cells[i];

      if (tool === 'cut') {
        const cost = TOOLS.cut.stamina * (mods.cutCostMul || 1);
        if (this.stamina < cost) return false;
        if (c.state !== 'intact' || c.fuel <= 0) return false;
        if (c.kind === 'house' || c.kind === 'hall' || c.kind === 'water' || c.kind === 'rock') return false;
        this.stamina -= cost;
        c.kind = 'dirt';
        c.fuel = 0;
        this.events.push({ type: 'chop', idx: i });
        return true;
      }

      if (tool === 'soak') {
        if (this.water < TOOLS.soak.water) return false;
        this.water -= TOOLS.soak.water;
        const r = mods.soakRadius || 1;
        for (let yy = y - r; yy <= y + r; yy++) {
          for (let xx = x - r; xx <= x + r; xx++) {
            if (!this.inBounds(xx, yy)) continue;
            const t = cells[yy * cols + xx];
            if (t.state === 'burning') {
              t.state = 'intact';
              t.burn = 0;
              t.controlled = false;
              t.fuel *= 0.7;
              t.wet = 14;
              this.burning--;
            } else if (t.fuel > 0 || t.kind === 'house' || t.kind === 'hall') {
              t.wet = Math.max(t.wet, 11);
            }
          }
        }
        this.events.push({ type: 'splash', idx: i });
        return true;
      }

      if (tool === 'backfire') {
        if (this.stamina < TOOLS.backfire.stamina) return false;
        if (c.state !== 'intact' || c.fuel <= 0) return false;
        if (c.kind === 'house' || c.kind === 'hall') return false;
        this.stamina -= TOOLS.backfire.stamina;
        return this.ignite(i, true);
      }

      return false;
    },

    // Cells still standing with fuel, for the saved-acres score.
    intactFuelCells() {
      let n = 0;
      for (const c of cells) if (c.state === 'intact' && c.fuel > 0) n++;
      return n;
    },

    housesStanding() {
      return layout.houses.filter((i) => cells[i].state !== 'ash').length;
    },
  };

  return world;
}
