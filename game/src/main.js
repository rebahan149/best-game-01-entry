// EMBERLINE — the shell. Owns the campaign state machine
// (title -> briefing -> playing -> report -> workshop -> ... -> ending),
// the score, the workshop upgrades and the routing of input and sound.
// The simulation lives in world.js, the drawing in render.js; this file is
// the conductor, not an instrument.

import { METERS, NIGHTS, SCORE, UPGRADES, VIEW } from './config.js';
import { makeRng, hashSeed } from './random.js';
import { generateNight } from './levels.js';
import { createWorld } from './world.js';
import { createRenderer, toolRect, upgradeRect, panelButtonRect } from './render.js';
import { createInput } from './input.js';
import { createAudio } from './audio.js';
import { getShotSpec, stageActions } from './shots.js';

const canvas = document.getElementById('game');
const renderer = createRenderer(canvas);
const audio = createAudio();

const game = {
  state: 'title',
  night: 1,
  score: 0,
  scoreAtNightStart: 0,
  tool: 'cut',
  paused: false,
  speed: 1,
  world: null,
  layout: null,
  report: null,
  cards: [],
  hoverCard: -1,
  message: '',
  messageUntil: 0,
  endTimer: -1,
  victory: false,
  stats: { housesLost: 0, burnedCells: 0 },
  metersCfg: { ...METERS },
  mods: { soakRadius: 1, cutCostMul: 1, houseArmor: 1, backfireCalm: 1, reserveWater: 0 },
  takenUpgrades: new Set(),
  kindShadow: [],
  shotHold: false,
};

function setMessage(text, seconds = 4) {
  game.message = text;
  game.messageUntil = performance.now() + seconds * 1000;
}

function startNight(night, toBriefing = true) {
  game.night = night;
  game.scoreAtNightStart = game.score;
  const def = NIGHTS[night - 1];
  const rng = makeRng(hashSeed('emberline') + night * 7919);
  const layout = generateNight(rng, def, VIEW.cols, VIEW.rows);
  layout.cols = VIEW.cols;
  layout.rows = VIEW.rows;
  game.layout = layout;
  game.world = createWorld(def, layout, game.metersCfg, game.mods, rng);
  renderer.setWorld(game.world);
  game.kindShadow = game.world.cells.map((c) => c.kind);
  game.world.start();
  game.paused = false;
  game.endTimer = -1;
  game.state = toBriefing ? 'briefing' : 'playing';
  setMessage(`${def.name}: the strikes have landed in the east.`, 5);
}

function finishNight() {
  const w = game.world;
  const layout = game.layout;
  let houseScore = 0;
  for (const idx of layout.houses) {
    if (w.cells[idx].state !== 'ash') houseScore += idx === layout.hall ? SCORE.perHall : SCORE.perHouse;
  }
  const cellsSaved = w.intactFuelCells();
  const cellScore = cellsSaved * SCORE.perCellSaved;
  const tempoScore = w.won ? Math.max(0, Math.floor((SCORE.tempoWindow - w.time) * SCORE.tempoPerSecond)) : 0;
  const nightScore = w.won ? houseScore + cellScore + tempoScore : Math.floor((houseScore + cellScore) / 4);
  game.score += nightScore;
  game.stats.housesLost += w.housesLost;
  game.stats.burnedCells += w.burnedCells;
  game.report = {
    night: game.night,
    won: w.won,
    housesStanding: w.housesStanding(),
    housesTotal: w.housesTotal,
    houseScore,
    cellsSaved,
    cellScore,
    time: w.time,
    tempoScore,
    nightScore,
    totalScore: game.score,
  };
  game.state = 'report';
}

function offerUpgrades() {
  const rng = makeRng(hashSeed(`workshop-${game.night}-${game.score}`));
  const pool = UPGRADES.filter((u) => u.id !== 'bucket' || !game.takenUpgrades.has('bucket'));
  game.cards = rng.shuffle(pool).slice(0, 3);
  game.state = 'workshop';
}

function applyUpgrade(card) {
  card.apply(game.metersCfg, game.mods);
  game.takenUpgrades.add(card.id);
  audio.click();
  startNight(game.night + 1);
}

function resetCampaign() {
  game.score = 0;
  game.metersCfg = { ...METERS };
  game.mods = { soakRadius: 1, cutCostMul: 1, houseArmor: 1, backfireCalm: 1, reserveWater: 0 };
  game.takenUpgrades = new Set();
  game.stats = { housesLost: 0, burnedCells: 0 };
}

function drainEvents() {
  const w = game.world;
  if (!w) return;
  let igniteSounds = 0;
  for (const ev of w.events) {
    renderer.spawnFromEvent(ev, w);
    if (ev.type === 'ignite' && igniteSounds < 2) { audio.ignite(); igniteSounds++; }
    else if (ev.type === 'splash') audio.splash();
    else if (ev.type === 'chop') audio.chop();
    else if (ev.type === 'backfire') audio.backfire();
    else if (ev.type === 'ember') audio.ember();
    else if (ev.type === 'houseFire') { audio.alarm(); setMessage('A building is burning! Soak it or cut around it!', 4); }
    else if (ev.type === 'houseLost') setMessage('A building is lost.', 4);
    else if (ev.type === 'veer') { audio.veer(); setMessage('The wind veers! Your break may be on the wrong side now.', 5); }
    else if (ev.type === 'nightWon') audio.win();
    else if (ev.type === 'nightLost') audio.lose();
  }
  w.events.length = 0;
}

// Repaint terrain cells whose kind changed since the last frame (a cut, a
// burn-out) so the offscreen terrain stays truthful.
function syncTerrain() {
  const w = game.world;
  if (!w) return;
  for (let i = 0; i < w.cells.length; i++) {
    if (w.cells[i].kind !== game.kindShadow[i]) {
      game.kindShadow[i] = w.cells[i].kind;
      renderer.repaintCell(i);
    }
  }
}

function advance() {
  if (game.state === 'title') {
    resetCampaign();
    startNight(1);
  } else if (game.state === 'briefing') {
    game.state = 'playing';
  } else if (game.state === 'report') {
    if (!game.report.won) {
      game.score = game.scoreAtNightStart;
      startNight(game.night);
    } else if (game.night >= NIGHTS.length) {
      game.victory = true;
      game.state = 'ending';
    } else {
      offerUpgrades();
    }
  } else if (game.state === 'ending') {
    game.state = 'title';
  }
}

function restart() {
  if (game.state === 'playing' || game.state === 'report' || game.state === 'briefing') {
    game.score = game.scoreAtNightStart;
    startNight(game.night, game.state === 'briefing');
  } else if (game.state === 'ending' || game.state === 'workshop') {
    resetCampaign();
    game.state = 'title';
  }
}

const input = createInput(canvas, {
  fieldActive: () => game.state === 'playing' && game.world && !game.world.over,
  unlockAudio: () => audio.unlock(),
  cellAction: (x, y) => {
    if (game.world) game.world.applyTool(game.tool, x, y);
  },
  hover: (px, py) => {
    game.hoverCard = -1;
    if (game.state === 'workshop') {
      for (let i = 0; i < game.cards.length; i++) {
        const r = upgradeRect(i);
        if (px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h) game.hoverCard = i;
      }
    }
  },
  click: (px, py) => {
    audio.unlock();
    if (game.state === 'playing') {
      const tools = ['cut', 'soak', 'backfire'];
      for (let i = 0; i < tools.length; i++) {
        const r = toolRect(i);
        if (px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h) {
          game.tool = tools[i];
          audio.click();
          return;
        }
      }
      for (const id of ['pause', 'speed', 'restart', 'mute']) {
        const r = panelButtonRect(id);
        if (px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h) {
          handleButton(id);
          return;
        }
      }
      return; // field clicks were already handled as cell actions
    }
    if (game.state === 'workshop') {
      for (let i = 0; i < game.cards.length; i++) {
        const r = upgradeRect(i);
        if (px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h) {
          applyUpgrade(game.cards[i]);
          return;
        }
      }
      return;
    }
    advance();
  },
  key: (action) => {
    if (action.startsWith('tool:')) {
      const tool = action.slice(5);
      if (game.state === 'workshop') {
        const idx = ['cut', 'soak', 'backfire'].indexOf(tool);
        if (idx >= 0 && game.cards[idx]) applyUpgrade(game.cards[idx]);
      } else if (game.state === 'playing') {
        game.tool = tool;
      }
      return;
    }
    if (action === 'pause' && game.state === 'playing') game.paused = !game.paused;
    else if (action === 'speed' && game.state === 'playing') game.speed = game.speed === 1 ? 2 : 1;
    else if (action === 'restart') restart();
    else if (action === 'mute') audio.toggleMute();
    else if (action === 'advance') advance();
  },
});

function handleButton(id) {
  audio.click();
  if (id === 'pause') game.paused = !game.paused;
  else if (id === 'speed') game.speed = game.speed === 1 ? 2 : 1;
  else if (id === 'restart') restart();
  else if (id === 'mute') audio.toggleMute();
}

// ---- screenshot staging -----------------------------------------------------
const shot = getShotSpec();
if (shot) {
  game.shotHold = true;
  if (shot.name === 'title') {
    game.state = 'title';
  } else if (shot.name === 'briefing') {
    startNight(Math.min(NIGHTS.length, Math.max(1, shot.seed)), true);
  } else if (shot.name === 'play' || shot.name === 'crisis') {
    const night = shot.name === 'play' ? 2 : 6;
    startNight(night, false);
    stageActions(game.world, shot.name);
    const ticks = shot.name === 'play' ? 44 : 80;
    for (let i = 0; i < ticks && !game.world.over; i++) game.world.tick();
    game.world.events.length = 0;
    renderer.setWorld(game.world);
    game.kindShadow = game.world.cells.map((c) => c.kind);
    game.state = 'playing';
    setMessage(shot.name === 'play' ? 'The break is cut. Hold the line.' : 'Firestorm weather: embers are jumping the break!', 60);
  } else if (shot.name === 'report') {
    startNight(1, false);
    let guard = 0;
    while (!game.world.over && guard++ < 6000) game.world.tick();
    game.world.events.length = 0;
    renderer.setWorld(game.world);
    game.kindShadow = game.world.cells.map((c) => c.kind);
    finishNight();
  }
}

// ---- the loop -----------------------------------------------------------------
let lastTime = performance.now();
function loop(now) {
  const dt = Math.min(0.05, (now - lastTime) / 1000);
  lastTime = now;
  const time = now / 1000;

  if (game.state === 'playing' && game.world) {
    if (!game.paused && !game.shotHold) {
      game.world.step(dt * game.speed);
    }
    drainEvents();
    syncTerrain();
    if (game.world.over && game.endTimer < 0 && !game.shotHold) game.endTimer = 1.4;
    if (game.endTimer > 0) {
      game.endTimer -= dt;
      if (game.endTimer <= 0) finishNight();
    }
    audio.ambience(game.world.def.windSpeed, game.world.burning);
  }

  const view = {
    night: game.night,
    tool: game.tool,
    score: game.score,
    paused: game.paused,
    speed: game.speed,
    muted: audio.muted,
    message: performance.now() < game.messageUntil ? game.message : defaultHint(),
    hover: input.hover,
    soakRadius: game.mods.soakRadius,
  };

  if (game.state === 'title') {
    renderer.drawTitleScreen(time);
  } else if (game.world) {
    renderer.frame(view, dt, time);
    if (game.state === 'briefing') renderer.drawBriefing(game.night, NIGHTS[game.night - 1]);
    else if (game.state === 'report') renderer.drawReport(game.report);
    else if (game.state === 'workshop') renderer.drawWorkshop(game.cards, game.hoverCard);
    else if (game.state === 'ending') {
      renderer.drawEnding(game.victory, {
        score: game.score,
        housesLost: game.stats.housesLost,
        burnedPct: Math.round((game.stats.burnedCells / (VIEW.cols * VIEW.rows * NIGHTS.length)) * 100),
        night: game.night,
      });
    }
  }

  requestAnimationFrame(loop);
}

function defaultHint() {
  if (game.state !== 'playing' || !game.world) return '';
  if (game.world.burning === 0) return '';
  return game.tool === 'cut'
    ? 'Cut a break ahead of the fire, on the side the wind blows toward.'
    : game.tool === 'soak'
      ? 'Soak the fire’s nose, or wet the houses before it arrives.'
      : 'A backfire eats fuel slowly — light it well ahead of the front.';
}

requestAnimationFrame(loop);
