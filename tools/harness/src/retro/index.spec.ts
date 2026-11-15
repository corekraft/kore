import { describe, expect, it, vi } from "vitest";
import * as barrel from "./index.js";
import { Retro } from "./retro.js";

vi.mock("./retro.js", () => ({
  PLAN_WITH_MARKER: "p",
  Retro: vi.fn(),
  RetroError: vi.fn(),
}));
vi.mock("./due.js", () => ({ COUNT_THRESHOLD: 5 }));
vi.mock("./metrics.js", () => ({ metricsOf: vi.fn() }));

describe("the retro barrel", () => {
  it("exposes the domain's public names, and no file's internals", () => {
    expect(Object.keys(barrel).sort()).toEqual([
      "COUNT_THRESHOLD",
      "PLAN_WITH_MARKER",
      "Retro",
      "RetroError",
      "metricsOf",
    ]);
  });

  it("re-exports the unit's own class, not a copy", () => {
    expect(barrel.Retro).toBe(Retro);
  });
});
