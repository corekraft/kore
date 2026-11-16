import { describe, expect, it, vi } from "vitest";
import { Approver } from "./approver.js";
import * as barrel from "./index.js";

vi.mock("./approver.js", () => ({ Approver: vi.fn(), ApproveError: vi.fn() }));
vi.mock("./flag.js", () => ({ APPROVE_FLAG: "f", approveFlagOn: vi.fn() }));
vi.mock("./qualify.js", () => ({ qualify: vi.fn() }));
vi.mock("./trailing.js", () => ({ trailingOf: vi.fn() }));

describe("the approve barrel", () => {
  it("exposes the domain's public names, and no file's internals", () => {
    expect(Object.keys(barrel).sort()).toEqual([
      "APPROVE_FLAG",
      "ApproveError",
      "Approver",
      "approveFlagOn",
      "qualify",
      "sharingWarnings",
      "trailingOf",
    ]);
  });

  it("re-exports the unit's own class, not a copy", () => {
    expect(barrel.Approver).toBe(Approver);
  });
});
