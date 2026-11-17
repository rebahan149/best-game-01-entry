// All drawing. The terrain is painted once per night onto an offscreen
// canvas (and repainted cell by cell as the ground is cut, soaked or burned
// out); fire, water sheen, particles and the HUD are drawn fresh each frame.
// Screens (title, briefing, report, workshop, endings) are full-canvas
// compositions over a dimmed valley so screenshots tell the game's story.

import { TERRAIN_COLORS, TOOLS, VIEW, WIND_NAMES } from './config.js';

const CELL = VIEW.cell;

// A tiny deterministic hash so a cell's painted detail (tree positions,
// grass tufts) is stable between repaints without consuming the game RNG.
function cellHash(x, y, salt) {
  let h = (x * 73856093) ^ (y * 19349663) ^ (salt * 83492791);
  h = Math.imul(h ^ (h >>> 13), 0x5bd1e995);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

// Hit-test geometry shared with input.js: the tool belt and the workshop
// cards must be drawn and clicked in exactly the same places.
export function toolRect(i) {
  return { x: VIEW.panelX + 20, y: 356 + i * 64, w: VIEW.panelW - 40, h: 54 };
}
export function upgradeRect(i) {
  return { x: 196 + i * 264, y: 330, w: 244, h: 190 };
}
export function panelButtonRect(id) {
  const rects = {
    pause: { x: VIEW.panelX + 20, y: 560, w: 116, h: 40 },
    speed: { x: VIEW.panelX + 152, y: 560, w: 116, h: 40 },
    restart: { x: VIEW.panelX + 20, y: 612, w: 116, h: 40 },
    mute: { x: VIEW.panelX + 152, y: 612, w: 116, h: 40 },
  };
  return rects[id];
}

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  const terrain = document.createElement('canvas');
  terrain.width = VIEW.width;
  terrain.height = VIEW.height;
  const tctx = terrain.getContext('2d');

  let world = null;
  let particles = [];
  let glowSprite = null;

  function makeGlow() {
    const c = document.createElement('canvas');
    c.width = c.height = 96;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(48, 48, 2, 48, 48, 48);
    grad.addColorStop(0, 'rgba(255,170,60,0.55)');
    grad.addColorStop(0.5, 'rgba(255,110,30,0.22)');
    grad.addColorStop(1, 'rgba(255,80,20,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 96, 96);
    return c;
  }
  glowSprite = makeGlow();

  // ---- terrain painting -------------------------------------------------
  function paintCell(g, cell, x, y) {
    const px = x * CELL;
    const py = y * CELL;
    const [base, shade] = TERRAIN_COLORS[cell.kind] || TERRAIN_COLORS.grass;
    g.fillStyle = cell.variant > 0.5 ? base : shade;
    g.fillRect(px, py, CELL, CELL);

    if (cell.kind === 'forest' || cell.kind === 'dense') {
      const trees = cell.kind === 'dense' ? 4 : 3;
      g.fillStyle = cell.kind === 'dense' ? '#122a18' : '#1c4423';
      for (let i = 0; i < trees; i++) {
        const tx = px + 4 + cellHash(x, y, i * 3 + 1) * 14;
        const ty = py + 4 + cellHash(x, y, i * 3 + 2) * 12;
        const s = 4.5 + cellHash(x, y, i * 3 + 3) * 3;
        g.beginPath();
        g.moveTo(tx, ty);
        g.lineTo(tx + s, ty + s * 1.7);
        g.lineTo(tx - s, ty + s * 1.7);
        g.closePath();
        g.fill();
      }
    } else if (cell.kind === 'grass') {
      g.strokeStyle = 'rgba(46,74,30,0.5)';
      g.lineWidth = 1;
      for (let i = 0; i < 3; i++) {
        const tx = px + 3 + cellHash(x, y, i + 7) * 18;
        const ty = py + 6 + cellHash(x, y, i + 11) * 14;
        g.beginPath();
        g.moveTo(tx, ty);
        g.lineTo(tx + 1.5, ty - 4);
        g.stroke();
      }
    } else if (cell.kind === 'scrub') {
      g.fillStyle = '#6d5c26';
      for (let i = 0; i < 4; i++) {
        const tx = px + 3 + cellHash(x, y, i + 21) * 17;
        const ty = py + 3 + cellHash(x, y, i + 23) * 17;
        g.fillRect(tx, ty, 3, 3);
      }
    } else if (cell.kind === 'water') {
      g.strokeStyle = 'rgba(190,225,245,0.55)';
      g.lineWidth = 1.4;
      for (let i = 0; i < 2; i++) {
        const ty = py + 6 + i * 9 + cellHash(x, y, i + 31) * 3;
        g.beginPath();
        g.moveTo(px + 3, ty);
        g.quadraticCurveTo(px + 12, ty - 3, px + 21, ty);
        g.stroke();
      }
    } else if (cell.kind === 'rock') {
      g.fillStyle = '#5d6066';
      g.beginPath();
      g.moveTo(px + 5, py + 17);
      g.lineTo(px + 9, py + 7);
      g.lineTo(px + 16, py + 5);
      g.lineTo(px + 20, py + 14);
      g.lineTo(px + 17, py + 19);
      g.closePath();
      g.fill();
    } else if (cell.kind === 'ash') {
      g.fillStyle = 'rgba(210,205,195,0.35)';
      for (let i = 0; i < 3; i++) {
        g.fillRect(px + 3 + cellHash(x, y, i + 41) * 16, py + 3 + cellHash(x, y, i + 43) * 16, 2.4, 2.4);
      }
    } else if (cell.kind === 'house' || cell.kind === 'hall') {
      paintHouse(g, px, py, cell.kind === 'hall', cell.variant);
    }
  }

  function paintHouse(g, px, py, isHall, variant) {
    const w = isHall ? 20 : 15;
    const h = isHall ? 15 : 11;
    const ox = px + (CELL - w) / 2;
    const oy = py + CELL - 3 - h;
    g.fillStyle = '#e8dcc2';
    g.fillRect(ox, oy, w, h);
    g.fillStyle = variant > 0.5 ? '#a34a2e' : '#8f5a2b';
    g.beginPath();
    g.moveTo(ox - 2, oy);
    g.lineTo(ox + w / 2, oy - (isHall ? 8 : 6));
    g.lineTo(ox + w + 2, oy);
    g.closePath();
    g.fill();
    g.fillStyle = '#5a4030';
    g.fillRect(ox + w / 2 - 1.5, oy + h - 5, 3, 5);
    if (isHall) {
      g.strokeStyle = '#d8c690';
      g.beginPath();
      g.moveTo(ox + w / 2, oy - 8);
      g.lineTo(ox + w / 2, oy - 13);
      g.stroke();
      g.fillStyle = '#e8b13c';
      g.fillRect(ox + w / 2, oy - 13, 5, 3.4);
    }
  }

  function setWorld(w) {
    world = w;
    particles = [];
    tctx.fillStyle = '#20241e';
    tctx.fillRect(0, 0, VIEW.width, VIEW.height);
    for (let y = 0; y < w.rows; y++) {
      for (let x = 0; x < w.cols; x++) paintCell(tctx, w.cells[y * w.cols + x], x, y);
    }
  }

  function repaintCell(idx) {
    if (!world) return;
    const x = idx % world.cols;
    const y = Math.floor(idx / world.cols);
    paintCell(tctx, world.cells[idx], x, y);
  }

  // ---- particles ----------------------------------------------------------
  function spawn(kind, x, y, opts = {}) {
    particles.push({
      kind,
      x, y,
      vx: opts.vx || 0, vy: opts.vy || 0,
      life: opts.life || 1, age: 0,
      size: opts.size || 3,
    });
    if (particles.length > 900) particles.splice(0, particles.length - 900);
  }

  function spawnFromEvent(ev, w) {
    const x = (ev.idx % w.cols) * CELL + CELL / 2;
    const y = Math.floor(ev.idx / w.cols) * CELL + CELL / 2;
    if (ev.type === 'splash') {
      for (let i = 0; i < 16; i++) {
        spawn('drop', x, y, { vx: (Math.random() - 0.5) * 90, vy: -Math.random() * 90 - 20, life: 0.55, size: 2.4 });
      }
    } else if (ev.type === 'chop') {
      for (let i = 0; i < 7; i++) {
        spawn('chip', x, y, { vx: (Math.random() - 0.5) * 70, vy: -Math.random() * 60, life: 0.5, size: 2.2 });
      }
    } else if (ev.type === 'ember') {
      spawn('spark', x, y, { vx: 24, vy: -30, life: 0.8, size: 2.6 });
    } else if (ev.type === 'houseLost') {
      for (let i = 0; i < 22; i++) {
        spawn('smoke', x, y - 6, { vx: (Math.random() - 0.5) * 26, vy: -34 - Math.random() * 26, life: 2.4, size: 7 });
      }
    }
  }

  function updateParticles(dt, windVec) {
    const keep = [];
    for (const p of particles) {
      p.age += dt;
      if (p.age >= p.life) continue;
      if (p.kind === 'smoke') {
        p.x += (p.vx + windVec[0] * 14) * dt;
        p.y += p.vy * dt;
        p.size += 9 * dt;
      } else if (p.kind === 'drop' || p.kind === 'chip') {
        p.vy += 260 * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
      } else { // spark
        p.x += (p.vx + windVec[0] * 30) * dt;
        p.y += p.vy * dt;
      }
      keep.push(p);
    }
    particles = keep;
  }

  function drawParticles() {
    for (const p of particles) {
      const t = 1 - p.age / p.life;
      if (p.kind === 'smoke') {
        ctx.fillStyle = `rgba(52,50,48,${0.34 * t})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      } else if (p.kind === 'drop') {
        ctx.fillStyle = `rgba(120,190,240,${0.85 * t})`;
        ctx.fillRect(p.x - 1, p.y - 1, 2.4, 2.4);
      } else if (p.kind === 'chip') {
        ctx.fillStyle = `rgba(150,120,70,${0.9 * t})`;
        ctx.fillRect(p.x - 1, p.y - 1, 2.4, 2.4);
      } else {
        ctx.fillStyle = `rgba(255,180,70,${t})`;
        ctx.fillRect(p.x - 1.2, p.y - 1.2, 2.6, 2.6);
      }
    }
  }

  // ---- fire ---------------------------------------------------------------
  function drawFire(time) {
    const w = world;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < w.cells.length; i++) {
      const c = w.cells[i];
      if (c.state !== 'burning') continue;
      const x = (i % w.cols) * CELL;
      const y = Math.floor(i / w.cols) * CELL;
      const intensity = Math.min(1, c.burn / 2.2 + 0.25);
      const s = (CELL * 2.1) * (0.7 + intensity * 0.6);
      ctx.globalAlpha = 0.5 + intensity * 0.4;
      ctx.drawImage(glowSprite, x + CELL / 2 - s / 2, y + CELL / 2 - s / 2, s, s);
    }
    ctx.restore();

    for (let i = 0; i < w.cells.length; i++) {
      const c = w.cells[i];
      if (c.state !== 'burning') continue;
      const x = (i % w.cols) * CELL;
      const y = Math.floor(i / w.cols) * CELL;
      const flick = Math.sin(time * 11 + i * 1.7) * 0.16 + Math.sin(time * 23 + i * 0.6) * 0.1;
      const baseH = CELL * (c.controlled ? 0.62 : 0.95) * (0.75 + flick + Math.min(0.4, c.burn / 6));
      // Char creeps up the cell as it burns through its fuel.
      ctx.fillStyle = 'rgba(24,20,18,0.55)';
      const charH = CELL * Math.min(1, c.burn / 7.5);
      ctx.fillRect(x, y + CELL - charH, CELL, charH);
      const layers = [
        ['#e8490f', 1.0, 0],
        ['#ff8c3a', 0.68, 0.16],
        ['#ffd95e', 0.38, 0.3],
      ];
      for (const [color, scale, inset] of layers) {
        ctx.fillStyle = color;
        ctx.beginPath();
        const cx = x + CELL / 2;
        const wHalf = CELL * 0.34 * scale + 1;
        const top = y + CELL - baseH * scale - inset * CELL;
        ctx.moveTo(cx - wHalf, y + CELL - 1);
        ctx.quadraticCurveTo(cx - wHalf * 0.4, top + baseH * 0.3, cx + (flick * 6), top);
        ctx.quadraticCurveTo(cx + wHalf * 0.4, top + baseH * 0.3, cx + wHalf, y + CELL - 1);
        ctx.closePath();
        ctx.fill();
      }
      if (c.controlled) {
        // A backfire shows a blue root so the player can tell it apart.
        ctx.fillStyle = 'rgba(90,140,255,0.75)';
        ctx.fillRect(x + CELL * 0.3, y + CELL - 3.4, CELL * 0.4, 2.6);
      }
    }
  }

  function drawWet() {
    const w = world;
    ctx.fillStyle = 'rgba(90,160,230,0.30)';
    for (let i = 0; i < w.cells.length; i++) {
      const c = w.cells[i];
      if (c.wet > 0 && c.state === 'intact') {
        const x = (i % w.cols) * CELL;
        const y = Math.floor(i / w.cols) * CELL;
        ctx.fillRect(x + 1, y + 1, CELL - 2, CELL - 2);
      }
    }
  }

  // ---- HUD panel ------------------------------------------------------------
  function bar(x, y, wdt, h, frac, color, back = '#2b2f2a') {
    ctx.fillStyle = back;
    ctx.fillRect(x, y, wdt, h);
    ctx.fillStyle = color;
    ctx.fillRect(x, y, Math.max(0, Math.min(1, frac)) * wdt, h);
  }

  function drawPanel(view) {
    const w = world;
    const px = VIEW.panelX;
    ctx.fillStyle = '#1b1e1c';
    ctx.fillRect(px, 0, VIEW.panelW, VIEW.height);
    ctx.fillStyle = '#e8b13c';
    ctx.fillRect(px, 0, 2, VIEW.height);

    ctx.fillStyle = '#f3e9d2';
    ctx.font = '700 25px Georgia, serif';
    ctx.fillText('EMBERLINE', px + 20, 40);
    ctx.fillStyle = '#b8ab8d';
    ctx.font = '13px system-ui, sans-serif';
    ctx.fillText(`Night ${view.night} of 7 — ${w.def.name}`, px + 20, 64);

    // Wind compass: an arrow that points where the fire wants to go.
    const cx = px + 46;
    const cy = 108;
    ctx.strokeStyle = '#4a4f4a';
    ctx.beginPath();
    ctx.arc(cx, cy, 24, 0, Math.PI * 2);
    ctx.stroke();
    const dirs = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
    const [dx, dy] = dirs[w.windDir];
    ctx.strokeStyle = '#e8b13c';
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(cx - dx * 13, cy - dy * 13);
    ctx.lineTo(cx + dx * 17, cy + dy * 17);
    ctx.stroke();
    ctx.lineWidth = 1;
    ctx.fillStyle = '#f3e9d2';
    ctx.font = '600 14px system-ui, sans-serif';
    ctx.fillText(`Wind from the ${WIND_NAMES[(w.windDir + 4) % 8]}`, px + 84, 102);
    ctx.fillStyle = '#b8ab8d';
    ctx.font = '12px system-ui, sans-serif';
    ctx.fillText(`strength ${Math.round(w.def.windSpeed * 100)} · dryness ${w.def.dryness.toFixed(2)}`, px + 84, 122);

    // Meters.
    ctx.fillStyle = '#f3e9d2';
    ctx.font = '600 13px system-ui, sans-serif';
    ctx.fillText('WATER', px + 20, 168);
    ctx.fillText('CREW', px + 20, 206);
    bar(px + 76, 156, 168, 13, w.water / w.waterMaxFull, '#4aa3e0');
    bar(px + 76, 194, 168, 13, w.stamina / w.staminaMaxFull, '#9fc45e');
    ctx.fillStyle = '#b8ab8d';
    ctx.font = '12px system-ui, sans-serif';
    ctx.fillText(`${Math.floor(w.water)}`, px + 250, 168);
    ctx.fillText(`${Math.floor(w.stamina)}`, px + 250, 206);

    // Village and score.
    const standing = w.housesStanding();
    ctx.fillStyle = '#f3e9d2';
    ctx.font = '600 14px system-ui, sans-serif';
    ctx.fillText(`Village: ${standing}/${w.housesTotal} standing`, px + 20, 244);
    ctx.fillText(`Score: ${view.score}`, px + 20, 270);
    ctx.fillStyle = '#b8ab8d';
    ctx.font = '12px system-ui, sans-serif';
    const burnedPct = Math.round((w.burnedCells / (w.cols * w.rows)) * 100);
    ctx.fillText(`Valley burned: ${burnedPct}% · alight: ${w.burning}`, px + 20, 292);
    ctx.fillText(`Time: ${Math.floor(w.time)}s${view.paused ? ' · PAUSED' : ''}${view.speed > 1 ? ' · 2x' : ''}`, px + 20, 312);

    // Tool belt.
    const toolNames = ['cut', 'soak', 'backfire'];
    const icons = { cut: '✂', soak: '💧', backfire: '🔥' };
    toolNames.forEach((name, i) => {
      const r = toolRect(i);
      const selected = view.tool === name;
      ctx.fillStyle = selected ? '#3d3423' : '#26292a';
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.strokeStyle = selected ? '#e8b13c' : '#4a4f4a';
      ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
      ctx.fillStyle = '#f3e9d2';
      ctx.font = '16px system-ui, sans-serif';
      ctx.fillText(`${icons[name]}  ${TOOLS[name].name}`, r.x + 12, r.y + 24);
      ctx.fillStyle = '#b8ab8d';
      ctx.font = '11px system-ui, sans-serif';
      ctx.fillText(`[${TOOLS[name].key}] ${name === 'cut' ? 'stamina' : name === 'soak' ? 'water' : 'stamina'}`, r.x + 12, r.y + 43);
    });

    // Buttons.
    const labels = { pause: view.paused ? 'Resume' : 'Pause', speed: 'Speed 2x', restart: 'Restart', mute: view.muted ? 'Unmute' : 'Mute' };
    for (const id of ['pause', 'speed', 'restart', 'mute']) {
      const r = panelButtonRect(id);
      ctx.fillStyle = '#26292a';
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.strokeStyle = '#4a4f4a';
      ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
      ctx.fillStyle = '#f3e9d2';
      ctx.font = '13px system-ui, sans-serif';
      ctx.fillText(labels[id], r.x + 12, r.y + 25);
    }

    // Message line and help.
    ctx.fillStyle = '#e8b13c';
    ctx.font = '600 13px system-ui, sans-serif';
    wrapText(view.message || '', px + 20, 690, VIEW.panelW - 40, 17);
    ctx.fillStyle = '#8d8672';
    ctx.font = '11px system-ui, sans-serif';
    ctx.fillText('Drag with a tool to work a line of cells.', px + 20, 736);
    ctx.fillText('Space pause · F speed · R restart · M mute', px + 20, 752);
  }

  function wrapText(text, x, y, maxW, lineH) {
    const words = String(text).split(' ');
    let line = '';
    let yy = y;
    for (const word of words) {
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test).width > maxW && line) {
        ctx.fillText(line, x, yy);
        line = word;
        yy += lineH;
      } else line = test;
    }
    if (line) ctx.fillText(line, x, yy);
  }

  // ---- full frame -----------------------------------------------------------
  function frame(view, dt, time) {
    if (!world) return;
    const windVec = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]][world.windDir];
    // Ambient smoke and embers from burning cells.
    for (let i = 0; i < world.cells.length; i++) {
      const c = world.cells[i];
      if (c.state !== 'burning') continue;
      const x = (i % world.cols) * CELL + CELL / 2;
      const y = Math.floor(i / world.cols) * CELL;
      if (Math.random() < 0.05) spawn('smoke', x, y, { vx: (Math.random() - 0.5) * 10, vy: -22 - Math.random() * 14, life: 2.6, size: 5 });
      if (Math.random() < 0.03) spawn('spark', x, y, { vx: 10, vy: -36, life: 0.7, size: 2.2 });
    }
    updateParticles(dt, windVec);
    ctx.drawImage(terrain, 0, 0);
    drawWet();
    drawFire(time);
    drawParticles();
    // Hovered cell outline.
    if (view.hover && view.hover.x >= 0 && view.hover.x < world.cols && view.hover.y >= 0 && view.hover.y < world.rows) {
      ctx.strokeStyle = 'rgba(255,240,200,0.9)';
      ctx.lineWidth = 1.6;
      ctx.strokeRect(view.hover.x * CELL + 1, view.hover.y * CELL + 1, CELL - 2, CELL - 2);
      ctx.lineWidth = 1;
      if (view.tool === 'soak') {
        const r = (view.soakRadius || 1) * CELL;
        ctx.strokeStyle = 'rgba(120,190,240,0.7)';
        ctx.strokeRect(view.hover.x * CELL - r + 1, view.hover.y * CELL - r + 1, CELL + r * 2 - 2, CELL + r * 2 - 2);
      }
    }
    drawPanel(view);
  }

  // ---- screens ---------------------------------------------------------------
  function dim(alpha = 0.72) {
    ctx.fillStyle = `rgba(12,14,12,${alpha})`;
    ctx.fillRect(0, 0, VIEW.width, VIEW.height);
  }

  function bigTitle(text, y, size = 64, color = '#f3e9d2') {
    ctx.fillStyle = color;
    ctx.font = `700 ${size}px Georgia, serif`;
    ctx.textAlign = 'center';
    ctx.fillText(text, VIEW.width / 2, y);
    ctx.textAlign = 'left';
  }

  function drawTitleScreen(time) {
    ctx.fillStyle = '#141a16';
    ctx.fillRect(0, 0, VIEW.width, VIEW.height);
    // A painted valley silhouette under the title: layered ridges and a
    // fire line creeping along the bottom.
    const ridges = ['#1d2b20', '#24382a', '#2e4a33'];
    ridges.forEach((color, li) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(0, 470 + li * 62);
      for (let x = 0; x <= VIEW.width; x += 64) {
        ctx.lineTo(x, 470 + li * 62 + Math.sin(x * 0.008 + li * 2.4) * 22 - li * 8);
      }
      ctx.lineTo(VIEW.width, VIEW.height);
      ctx.lineTo(0, VIEW.height);
      ctx.fill();
    });
    for (let i = 0; i < 46; i++) {
      const x = (i * 89 + Math.sin(time * 0.7 + i) * 8) % VIEW.width;
      const y = 668 + Math.sin(time * 1.3 + i * 1.9) * 9 + (i % 5) * 7;
      const s = 5 + ((i * 37) % 9);
      ctx.fillStyle = i % 3 ? '#ff8c3a' : '#ffd95e';
      ctx.beginPath();
      ctx.moveTo(x - s * 0.4, y);
      ctx.quadraticCurveTo(x, y - s * 1.7, x + s * 0.4, y);
      ctx.closePath();
      ctx.fill();
    }
    bigTitle('EMBERLINE', 218, 92, '#f6ead0');
    ctx.fillStyle = '#e8b13c';
    ctx.font = '600 21px Georgia, serif';
    ctx.textAlign = 'center';
    ctx.fillText('Hold the firebreak through seven nights', VIEW.width / 2, 262);
    ctx.fillStyle = '#cfc7ae';
    ctx.font = '16px system-ui, sans-serif';
    const lines = [
      'Lightning starts the fire in the east. The wind walks it toward the village in the west.',
      'Cut firebreaks, soak the line with the helicopter, and light backfires that eat the fuel first.',
      'Save the houses. Save the hall. Outlast the firestorm on night seven.',
    ];
    lines.forEach((l, i) => ctx.fillText(l, VIEW.width / 2, 330 + i * 26));
    ctx.fillStyle = '#f3e9d2';
    ctx.font = '600 17px system-ui, sans-serif';
    ctx.fillText('Controls:  1 Cut · 2 Soak · 3 Backfire · drag to work a line · Space pause · F speed · R restart', VIEW.width / 2, 452);
    ctx.fillStyle = Math.sin(time * 3) > -0.2 ? '#ffd95e' : '#b8ab8d';
    ctx.font = '700 20px system-ui, sans-serif';
    ctx.fillText('Click, or press Enter, to take the watch', VIEW.width / 2, 520);
    ctx.textAlign = 'left';
  }

  function drawBriefing(nightNum, def) {
    dim();
    bigTitle(`Night ${nightNum} — ${def.name}`, 190, 44);
    ctx.fillStyle = '#cfc7ae';
    ctx.font = '17px system-ui, sans-serif';
    ctx.textAlign = 'center';
    const lines = [
      `Wind from the ${WIND_NAMES[(def.windDir + 4) % 8]}, strength ${Math.round(def.windSpeed * 100)}. Dryness ${def.dryness.toFixed(2)}.`,
      `${def.strikes} strikes expected in the east. ${def.houses + 1} buildings to protect, the hall above all.`,
      def.veers ? 'The firestorm veers: watch the compass, it will swing without asking.' : 'The wind holds steady tonight.',
      '',
      'Cut ahead of the fire, soak what you cannot cut, and burn out a backfire',
      'where the ground is already lost. The night ends when nothing is alight.',
    ];
    lines.forEach((l, i) => ctx.fillText(l, VIEW.width / 2, 268 + i * 30));
    ctx.fillStyle = '#ffd95e';
    ctx.font = '700 19px system-ui, sans-serif';
    ctx.fillText('Click, or press Enter, to begin the night', VIEW.width / 2, 520);
    ctx.textAlign = 'left';
  }

  function drawReport(report) {
    dim();
    bigTitle(report.won ? `Night ${report.night} held` : 'The valley is lost', 180, 46, report.won ? '#f3e9d2' : '#e88a5e');
    ctx.font = '18px system-ui, sans-serif';
    ctx.fillStyle = '#cfc7ae';
    ctx.textAlign = 'center';
    const rows = [
      `Buildings standing: ${report.housesStanding} of ${report.housesTotal}  (+${report.houseScore})`,
      `Valley saved: ${report.cellsSaved} fuel cells  (+${report.cellScore})`,
      `Tempo: the fire was out in ${Math.floor(report.time)}s  (+${report.tempoScore})`,
      '',
      `Night score ${report.nightScore} · Campaign score ${report.totalScore}`,
    ];
    rows.forEach((l, i) => ctx.fillText(l, VIEW.width / 2, 268 + i * 32));
    ctx.fillStyle = '#ffd95e';
    ctx.font = '700 19px system-ui, sans-serif';
    ctx.fillText(report.won ? 'Click to visit the workshop' : 'Click, or press R, to try the night again', VIEW.width / 2, 500);
    ctx.textAlign = 'left';
  }

  function drawWorkshop(cards, hoverIdx) {
    dim(0.8);
    bigTitle('The Workshop', 170, 44);
    ctx.fillStyle = '#cfc7ae';
    ctx.font = '16px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Dawn. The crew can manage one improvement before the next night.', VIEW.width / 2, 214);
    ctx.textAlign = 'left';
    cards.forEach((card, i) => {
      const r = upgradeRect(i);
      ctx.fillStyle = i === hoverIdx ? '#3d3423' : '#232726';
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.strokeStyle = i === hoverIdx ? '#e8b13c' : '#4a4f4a';
      ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
      ctx.fillStyle = '#f3e9d2';
      ctx.font = '700 19px Georgia, serif';
      ctx.fillText(card.name, r.x + 18, r.y + 42);
      ctx.fillStyle = '#cfc7ae';
      ctx.font = '14px system-ui, sans-serif';
      wrapTextIn(card.desc, r.x + 18, r.y + 78, r.w - 36, 20);
      ctx.fillStyle = '#8d8672';
      ctx.font = '12px system-ui, sans-serif';
      ctx.fillText(`Press ${i + 1} or click`, r.x + 18, r.y + r.h - 16);
    });
  }

  function wrapTextIn(text, x, y, maxW, lineH) {
    const words = String(text).split(' ');
    let line = '';
    let yy = y;
    for (const word of words) {
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test).width > maxW && line) {
        ctx.fillText(line, x, yy);
        line = word;
        yy += lineH;
      } else line = test;
    }
    if (line) ctx.fillText(line, x, yy);
  }

  function drawEnding(victory, stats) {
    dim(0.84);
    bigTitle(victory ? 'THE VALLEY STANDS' : 'EMBERLINE', 200, 54, victory ? '#ffd95e' : '#e88a5e');
    ctx.fillStyle = '#cfc7ae';
    ctx.font = '18px system-ui, sans-serif';
    ctx.textAlign = 'center';
    const lines = victory
      ? [
          'Seven nights, and the hall still stands. The valley keeps its roofs,',
          'its pines, and its stubborn firewatch.',
          '',
          `Final score ${stats.score} · buildings lost ${stats.housesLost} · valley burned ${stats.burnedPct}%`,
        ]
      : [
          'The fire took the hall, and with it the valley.',
          'The watch ends here — but every night can be fought again.',
          '',
          `Score ${stats.score} · reached night ${stats.night}`,
        ];
    lines.forEach((l, i) => ctx.fillText(l, VIEW.width / 2, 290 + i * 30));
    ctx.fillStyle = '#ffd95e';
    ctx.font = '700 19px system-ui, sans-serif';
    ctx.fillText('Press R, or click, to take the watch again', VIEW.width / 2, 480);
    ctx.textAlign = 'left';
  }

  return {
    setWorld,
    repaintCell,
    spawnFromEvent,
    frame,
    drawTitleScreen,
    drawBriefing,
    drawReport,
    drawWorkshop,
    drawEnding,
  };
}
