// Screenshot scenes. The game's screenshots must be real renders of the
// game itself, so the game can stage itself: open index.html with
// ?shot=<scene>&seed=<n> and it sets up a deterministic scene — a title, a
// briefing, a night mid-fight with a break already cut — and holds it for
// the camera. The same scenes are what shots.json names for the kit's
// screenshot flow. Nothing here runs in a normal visit.

export function getShotSpec() {
  const params = new URLSearchParams(window.location.search);
  const name = params.get('shot');
  if (!name) return null;
  const seed = Number(params.get('seed') || 1);
  return { name, seed: Number.isFinite(seed) ? seed : 1 };
}

// Scripted staging for the action scenes: a few honest tool applications at
// fixed cells, so the picture shows the game being played, not just burning.
// The crew's meters are topped up first — the scene compresses a whole
// night's work into the moment before the camera arrives.
export function stageActions(world, name) {
  world.stamina = 100000;
  world.water = 100000;
  if (name === 'play') {
    // A firebreak column the crew has cut ahead of the fire, and one soak
    // dropped on the fire's nose.
    for (let y = 6; y < 26; y++) world.applyTool('cut', 20, y);
    world.applyTool('soak', 27, 15);
    world.applyTool('soak', 28, 18);
  } else if (name === 'crisis') {
    // One break column, already being outflanked: the picture is the moment
    // the crew realises one line is not enough.
    for (let y = 2; y < 30; y++) world.applyTool('cut', 16, y);
    world.applyTool('soak', 12, 8);
    world.applyTool('backfire', 19, 26);
    world.applyTool('backfire', 19, 27);
  }
}
