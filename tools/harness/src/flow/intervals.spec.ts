import { describe, expect, it } from "vitest";
import { uncovered } from "./intervals.js";

describe("uncovered", () => {
  it("is the whole span when no hole is given", () => {
    expect(uncovered([0, 100], [])).toBe(100);
  });

  it("subtracts a hole that lies inside the span", () => {
    expect(uncovered([0, 100], [[20, 50]])).toBe(70);
  });

  it("clips a hole that starts before the span to the span", () => {
    expect(uncovered([10, 100], [[0, 40]])).toBe(60);
  });

  it("clips a hole that ends after the span to the span", () => {
    expect(uncovered([0, 100], [[90, 500]])).toBe(90);
  });

  it("ignores a hole entirely outside the span", () => {
    expect(
      uncovered(
        [0, 100],
        [
          [200, 300],
          [-50, -10],
        ],
      ),
    ).toBe(100);
  });

  it("counts time covered by overlapping holes once", () => {
    expect(
      uncovered(
        [0, 100],
        [
          [10, 50],
          [30, 70],
        ],
      ),
    ).toBe(40);
  });

  it("counts a hole nested inside another once", () => {
    expect(
      uncovered(
        [0, 100],
        [
          [10, 90],
          [20, 30],
        ],
      ),
    ).toBe(20);
  });

  it("does not depend on the order the holes are given in", () => {
    expect(
      uncovered(
        [0, 100],
        [
          [60, 80],
          [10, 20],
        ],
      ),
    ).toBe(70);
    expect(
      uncovered(
        [0, 100],
        [
          [10, 20],
          [60, 80],
        ],
      ),
    ).toBe(70);
  });

  it("treats a hole that only touches the span edge as covering nothing", () => {
    expect(
      uncovered(
        [10, 20],
        [
          [0, 10],
          [20, 30],
        ],
      ),
    ).toBe(10);
  });

  it("is zero when holes cover the whole span", () => {
    expect(
      uncovered(
        [0, 100],
        [
          [-10, 60],
          [50, 200],
        ],
      ),
    ).toBe(0);
  });

  it("is zero for an empty span", () => {
    expect(uncovered([5, 5], [[0, 10]])).toBe(0);
  });
});
