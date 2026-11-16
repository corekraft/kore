import { describe, expect, it, vi } from "vitest";
import * as barrel from "./index.js";
import * as unit from "./sender.js";

vi.mock("./sender.js", () => ({
  MAIN_SESSION: "the main session",
  NAME_VARIABLE: "KORE_AGENT",
  ROLE_VARIABLE: "KORE_ROLE",
  formatSender: vi.fn(),
  readSender: vi.fn(),
  senderFrom: vi.fn(),
  withoutSender: vi.fn(),
}));

describe("the sender barrel", () => {
  it("exposes the domain's public names, and no file's internals", () => {
    expect(Object.keys(barrel).sort()).toEqual([
      "MAIN_SESSION",
      "NAME_VARIABLE",
      "ROLE_VARIABLE",
      "formatSender",
      "readSender",
      "senderFrom",
      "withoutSender",
    ]);
  });

  it("re-exports the unit's own functions, not copies", () => {
    expect(barrel.senderFrom).toBe(unit.senderFrom);
    expect(barrel.formatSender).toBe(unit.formatSender);
    expect(barrel.readSender).toBe(unit.readSender);
    expect(barrel.withoutSender).toBe(unit.withoutSender);
  });
});
