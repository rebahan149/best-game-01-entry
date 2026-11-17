// Pointer and keyboard input. The canvas is the whole interface — HUD
// buttons, workshop cards and field cells are all hit-tested from the same
// coordinates the renderer draws at — so this module only translates raw
// events into game terms and lets the shell decide what they mean.

import { VIEW } from './config.js';

export function createInput(canvas, handlers) {
  const input = {
    hover: { x: -1, y: -1 },
    dragging: false,
    lastDragCell: '',
  };

  function toCanvas(evt) {
    const rect = canvas.getBoundingClientRect();
    const sx = VIEW.width / rect.width;
    const sy = VIEW.height / rect.height;
    return { x: (evt.clientX - rect.left) * sx, y: (evt.clientY - rect.top) * sy };
  }

  function toCell(px, py) {
    return { x: Math.floor(px / VIEW.cell), y: Math.floor(py / VIEW.cell) };
  }

  canvas.addEventListener('pointermove', (evt) => {
    const p = toCanvas(evt);
    const cell = toCell(p.x, p.y);
    input.hover = cell;
    if (input.dragging) {
      const key = `${cell.x},${cell.y}`;
      if (key !== input.lastDragCell) {
        input.lastDragCell = key;
        handlers.cellAction(cell.x, cell.y, true);
      }
    }
    handlers.hover?.(p.x, p.y);
  });

  canvas.addEventListener('pointerdown', (evt) => {
    const p = toCanvas(evt);
    const cell = toCell(p.x, p.y);
    handlers.unlockAudio?.();
    if (cell.x >= 0 && cell.x < VIEW.cols && cell.y >= 0 && cell.y < VIEW.rows && handlers.fieldActive()) {
      input.dragging = true;
      input.lastDragCell = `${cell.x},${cell.y}`;
      handlers.cellAction(cell.x, cell.y, false);
    }
    handlers.click(p.x, p.y);
  });

  window.addEventListener('pointerup', () => {
    input.dragging = false;
    input.lastDragCell = '';
  });

  canvas.addEventListener('pointerleave', () => {
    input.hover = { x: -1, y: -1 };
  });

  window.addEventListener('keydown', (evt) => {
    if (evt.repeat) return;
    const k = evt.key.toLowerCase();
    const actions = {
      '1': 'tool:cut',
      '2': 'tool:soak',
      '3': 'tool:backfire',
      ' ': 'pause',
      f: 'speed',
      r: 'restart',
      m: 'mute',
      enter: 'advance',
      p: 'pause',
    };
    const action = actions[k];
    if (action) {
      if (k === ' ') evt.preventDefault();
      handlers.unlockAudio?.();
      handlers.key(action);
    }
  });

  return input;
}
