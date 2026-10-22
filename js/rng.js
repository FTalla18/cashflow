// Seeded, serializable random numbers.
// Every random thing in the game (characters, board, dice, cards) comes from here, so the same
// seed + the same player actions always produce exactly the same game, on every player's screen.

/** Hash any string to a 32-bit unsigned integer (FNV-1a). */
export function hashString(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/**
 * A random-number stream whose whole state is one integer (`rng.s`),
 * so it can be saved inside the game state and sent over the network.
 * Algorithm: mulberry32.
 */
export class Rng {
  constructor(seed) { this.s = (typeof seed === "string" ? hashString(seed) : seed) >>> 0; }
  static from(state) { const r = new Rng(0); r.s = state >>> 0; return r; }

  /** float in [0, 1) */
  next() {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  /** integer in [lo, hi] (inclusive) */
  int(lo, hi) { return lo + Math.floor(this.next() * (hi - lo + 1)); }
  /** true with probability p */
  chance(p) { return this.next() < p; }
  /** random element */
  pick(arr) { return arr[Math.floor(this.next() * arr.length)]; }
  /** pick from [[value, weight], ...] */
  weighted(pairs) {
    const total = pairs.reduce((s, [, w]) => s + w, 0);
    let x = this.next() * total;
    for (const [v, w] of pairs) { if ((x -= w) < 0) return v; }
    return pairs[pairs.length - 1][0];
  }
  /** triangular distribution: values cluster around `mode` (realistic salaries, prices) */
  tri(lo, mode, hi) {
    const u = this.next(), c = (mode - lo) / (hi - lo || 1);
    return u < c ? lo + Math.sqrt(u * (hi - lo) * (mode - lo)) : hi - Math.sqrt((1 - u) * (hi - lo) * (hi - mode));
  }
  /** round to a "nice" step, e.g. nice(123456, 500) = 123500 */
  static nice(x, step) { return Math.round(x / step) * step; }
}

/**
 * A throwaway stream for flavor text only (narrator lines). It's derived from the game seed and an
 * event counter, so it never consumes numbers from the game stream: changing narration can never change
 * the game itself.
 */
export function flavorRng(seed, counter) { return new Rng(hashString(`${seed}#flavor#${counter}`)); }
