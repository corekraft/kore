// A small deterministic generator (mulberry32) for the flow report's seeded intervals (#1012,
// spec #998). The standard library has none, and the same ledger and seed must always give the
// same interval, so the generator is written here and fixed: a change to it changes every interval.

/** A generator of values from zero up to but not including one, one call after another. */
export type RandomSource = () => number;

/** The values a seeded generator gives, in order: the same seed always gives the same values. */
export function seededRandom(seed: number): RandomSource {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
