// Night generation: builds the valley for one night from a seeded source, so
// every player faces the same ground. The village always sits on the west
// edge, the lightning always strikes in the east, and what lies between —
// forest, scrub, a river, a lake — decides how hard the night will be.

import { TERRAIN } from './config.js';

function makeCell(kind, variant) {
  return {
    kind,
    fuel: TERRAIN[kind].fuel,
    state: 'intact', // intact | burning | ash
    burn: 0, // seconds this cell has been alight
    wet: 0, // seconds of soak protection left
    controlled: false, // a backfire burn: gentle, no embers
    variant, // 0..1 deterministic shade variation for the renderer
  };
}

// Paint a soft blob of `kind` centred at (cx, cy): cells nearer the centre
// are more likely to convert, which gives forests and lakes ragged edges.
function blob(cells, cols, rows, rng, cx, cy, radius, kind, strength) {
  const r = Math.ceil(radius);
  for (let y = Math.max(0, cy - r); y <= Math.min(rows - 1, cy + r); y++) {
    for (let x = Math.max(0, cx - r); x <= Math.min(cols - 1, cx + r); x++) {
      const d = Math.hypot(x - cx, y - cy) / radius;
      if (d < 1 && rng.chance((1 - d) * strength)) {
        const i = y * cols + x;
        if (cells[i].kind !== 'water') cells[i] = makeCell(kind, rng.next());
      }
    }
  }
}

export function generateNight(rng, def, cols, rows) {
  const cells = [];
  for (let i = 0; i < cols * rows; i++) cells.push(makeCell('grass', rng.next()));

  // Forest: overlapping blobs, the inner ones old growth (denser fuel).
  const forestCells = Math.floor(cols * rows * def.forest);
  let painted = 0;
  let guard = 0;
  while (painted < forestCells && guard++ < 400) {
    const cx = rng.int(4, cols - 2);
    const cy = rng.int(1, rows - 2);
    const radius = rng.range(2.2, 4.6);
    blob(cells, cols, rows, rng, cx, cy, radius, 'forest', 0.95);
    if (rng.chance(0.55)) blob(cells, cols, rows, rng, cx, cy, radius * 0.45, 'dense', 0.9);
    painted = cells.reduce((n, c) => n + (c.fuel >= 1 ? 1 : 0), 0);
  }

  // Scrub patches on the open grass: fast, flashy fuel.
  const scrubBlobs = rng.int(3, 6);
  for (let i = 0; i < scrubBlobs; i++) {
    blob(cells, cols, rows, rng, rng.int(3, cols - 2), rng.int(1, rows - 2), rng.range(1.4, 2.6), 'scrub', 0.8);
  }

  // A rocky ridge some nights: a short diagonal of stone.
  if (rng.chance(0.5)) {
    let x = rng.int(10, cols - 12);
    let y = rng.int(2, 8);
    const len = rng.int(6, 11);
    for (let i = 0; i < len; i++) {
      if (x < cols && y < rows) cells[y * cols + x] = makeCell('rock', rng.next());
      x += 1;
      y += rng.chance(0.6) ? 1 : 0;
    }
  }

  // The river: a wandering north-south watercourse in the eastern half —
  // the valley's one reliable natural firebreak.
  if (def.river) {
    let x = rng.int(Math.floor(cols * 0.55), Math.floor(cols * 0.72));
    for (let y = 0; y < rows; y++) {
      cells[y * cols + x] = makeCell('water', rng.next());
      if (rng.chance(0.4) && x + 1 < cols) cells[y * cols + x + 1] = makeCell('water', rng.next());
      x += rng.int(-1, 1);
      x = Math.max(Math.floor(cols * 0.45), Math.min(Math.floor(cols * 0.8), x));
    }
  }

  // The lake: a still pool, placed away from the village.
  if (def.lake) {
    blob(cells, cols, rows, rng, rng.int(Math.floor(cols * 0.4), cols - 5), rng.int(4, rows - 5), rng.range(2, 3.4), 'water', 1);
  }

  // The village: a hall and its houses along the west edge, with a dirt
  // apron cleared around them. Houses are what the night is scored on.
  const houses = [];
  const midY = Math.floor(rows / 2);
  const hallIdx = midY * cols + 1;
  cells[hallIdx] = makeCell('hall', rng.next());
  houses.push(hallIdx);
  const houseRows = rng.shuffle(
    Array.from({ length: rows - 6 }, (_, i) => i + 3).filter((y) => Math.abs(y - midY) > 1),
  );
  for (let i = 0; i < def.houses && i < houseRows.length; i++) {
    const y = houseRows[i];
    const x = rng.int(1, 2);
    const idx = y * cols + x;
    cells[idx] = makeCell('house', rng.next());
    houses.push(idx);
  }
  // The clearing: a dirt yard one cell deep around each building (diagonal
  // spread crosses a single bare cell, so the yard matters) and a grass
  // apron beyond it with the heavy fuel grubbed out.
  for (const idx of houses) {
    const hx = idx % cols;
    const hy = Math.floor(idx / cols);
    for (let y = Math.max(0, hy - 2); y <= Math.min(rows - 1, hy + 2); y++) {
      for (let x = Math.max(0, hx - 2); x <= Math.min(cols - 1, hx + 2); x++) {
        const j = y * cols + x;
        const c = cells[j];
        if (c.kind === 'house' || c.kind === 'hall' || c.kind === 'water') continue;
        const d = Math.max(Math.abs(x - hx), Math.abs(y - hy));
        if (d <= 1) cells[j] = makeCell('dirt', rng.next());
        else if (c.fuel > TERRAIN.grass.fuel) cells[j] = makeCell('grass', rng.next());
      }
    }
  }

  // Ignition points: dry cells near the east edge where the lightning (or a
  // stray ember from the next valley) starts the night.
  const ignitions = [];
  const eastRows = rng.shuffle(Array.from({ length: rows - 4 }, (_, i) => i + 2));
  for (const y of eastRows) {
    if (ignitions.length >= def.strikes) break;
    for (let x = cols - 1; x > cols - 7; x--) {
      const idx = y * cols + x;
      if (cells[idx].fuel > 0) {
        ignitions.push(idx);
        break;
      }
    }
  }

  return { cells, houses, hall: hallIdx, ignitions };
}
