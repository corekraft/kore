import { describe, expect, it, vi } from "vitest";
import * as barrel from "./index.js";
import { FakeTerminals } from "./FakeTerminals.js";
import { terminalError } from "./port.js";

vi.mock("./FakeTerminals.js", () => ({ FakeTerminals: vi.fn() }));
vi.mock("./port.js", () => ({ terminalError: vi.fn() }));

describe("the terminal barrel", () => {
  it("exposes the domain's public names, and no file's internals", () => {
    expect(Object.keys(barrel).sort()).toEqual([
      "FakeTerminals",
      "terminalError",
    ]);
  });

  it("re-exports the units' own functions, not copies", () => {
    expect(barrel.FakeTerminals).toBe(FakeTerminals);
    expect(barrel.terminalError).toBe(terminalError);
  });
});
