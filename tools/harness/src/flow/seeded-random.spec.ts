import { describe, expect, it } from "vitest";
import { seededRandom } from "./seeded-random.js";

const take = (next: () => number, count: number): number[] =>
  Array.from({ length: count }, () => next());

describe("seededRandom", () => {
  it("gives the same sequence for the same seed, every time", () => {
    expect(take(seededRandom(20261117), 4)).toEqual(
      take(seededRandom(20261117), 4),
    );
  });

  it("gives a different sequence for a different seed", () => {
    expect(take(seededRandom(1), 4)).not.toEqual(take(seededRandom(2), 4));
  });

  it("returns values from zero up to but not including one", () => {
    const values = take(seededRandom(7), 1000);
    expect(values.every((v) => v >= 0 && v < 1)).toBe(true);
  });

  it("pins its first values for seed 1, so a change to the generator is seen", () => {
    expect(take(seededRandom(1), 3)).toEqual([
      0.6270739405881613, 0.002735721180215478, 0.5274470399599522,
    ]);
  });
});
