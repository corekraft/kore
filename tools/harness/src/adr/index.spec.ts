import { describe, expect, it, vi } from "vitest";
import * as adr from "./index.js";

const table = vi.hoisted(() => ({ new: {}, supersede: {} }));

vi.mock("./commands.js", () => ({ adrCommands: table }));

describe("the adr domain's public surface", () => {
  it("exports only the command table", () => {
    expect(Object.keys(adr)).toEqual(["adrCommands"]);
  });

  it("exposes the command table that commands.ts builds", () => {
    expect(adr.adrCommands).toBe(table);
  });
});
