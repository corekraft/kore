import { describe, expect, it, vi } from "vitest";
import * as barrel from "./index.js";
import * as unit from "./sender.js";

vi.mock("./sender.js", () => ({
  APPROVAL_REFUSAL: "the refusal",
  MAIN_SESSION: "the main session",
  NAME_VARIABLE: "KORE_AGENT",
  ROLE_VARIABLE: "KORE_ROLE",
  carriesApproval: vi.fn(),
  formatSender: vi.fn(),
  readSender: vi.fn(),
  senderFrom: vi.fn(),
  signedBody: vi.fn(),
  signedMessage: vi.fn(),
  withoutSender: vi.fn(),
}));

describe("the sender barrel", () => {
  it("exposes the domain's public names, and no file's internals", () => {
    expect(Object.keys(barrel).sort()).toEqual([
      "APPROVAL_REFUSAL",
      "MAIN_SESSION",
      "NAME_VARIABLE",
      "ROLE_VARIABLE",
      "carriesApproval",
      "formatSender",
      "readSender",
      "senderFrom",
      "signedBody",
      "signedMessage",
      "withoutSender",
    ]);
  });

  it("re-exports the unit's own functions, not copies", () => {
    expect(barrel.senderFrom).toBe(unit.senderFrom);
    expect(barrel.formatSender).toBe(unit.formatSender);
    expect(barrel.readSender).toBe(unit.readSender);
    expect(barrel.withoutSender).toBe(unit.withoutSender);
    expect(barrel.signedBody).toBe(unit.signedBody);
    expect(barrel.carriesApproval).toBe(unit.carriesApproval);
  });
});
