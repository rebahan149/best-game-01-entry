// A small deterministic random source (mulberry32). Every night is generated
// from a seed, so a night plays the same for everyone and the screenshot
// scenes (?shot=...) render identically on every machine.

export function makeRng(seed) {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    // Float in [min, max).
    range: (min, max) => min + next() * (max - min),
    // Integer in [min, max] inclusive.
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    // True with probability p.
    chance: (p) => next() < p,
    // One element of an array.
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    // A shuffled copy of an array (Fisher-Yates).
    shuffle: (arr) => {
      const a = arr.slice();
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    },
  };
}

// A stable string hash (FNV-1a) so seeds can come from names like "night-3".
export function hashSeed(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
