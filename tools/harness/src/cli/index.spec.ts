import { describe, expect, it, vi } from "vitest";
import { run } from "./index.js";

// Factory mock: the barrel only re-exports the dispatcher, so cli.ts does not load.
const fakes = vi.hoisted(() => ({ dispatch: vi.fn() }));

vi.mock("./cli.js", () => ({ run: fakes.dispatch }));

describe("cli barrel", () => {
  it("exposes the dispatcher as the domain's entry point, unchanged", () => {
    expect(run).toBe(fakes.dispatch);
  });
});
