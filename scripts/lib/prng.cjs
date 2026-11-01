/**
 * Deterministic PRNG.
 *
 * The map composer (scripts/lib/compose-map.cjs) drives every random decision
 * through Math.random, so swapping the global implementation with a seeded one
 * before composing is what makes `--seed` produce reproducible maps.
 */

/** mulberry32 — small, fast, good enough distribution for map layout. */
function mulberry32(seed) {
  let state = seed >>> 0;
  return function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Replaces Math.random with a seeded generator.
 * @param {number} seed
 * @returns {() => void} restore function — call it to put the original back.
 */
function installSeededRandom(seed) {
  const original = Math.random;
  Math.random = mulberry32(seed);
  return () => {
    Math.random = original;
  };
}

module.exports = { mulberry32, installSeededRandom };
