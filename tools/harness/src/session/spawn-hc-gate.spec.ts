import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDeps, type FakeDeps } from "./deps-support.js";
import { hostLeaseRefusal } from "./host-lease.js";
import { FAILED, USAGE_ERROR } from "./output.js";
import { spawnLoadRefusal } from "./spawn-load.js";
import { emptyFlag, groupRefusal, leaseRefusal } from "./spawn-hc-gate.js";

vi.mock("./host-lease.js");
vi.mock("./spawn-load.js");

let deps: FakeDeps;

beforeEach(() => {
  deps = fakeDeps();
  vi.mocked(hostLeaseRefusal).mockResolvedValue(undefined);
  vi.mocked(spawnLoadRefusal).mockReturnValue(undefined);
});

describe("emptyFlag refuses a role or name given as an empty string", () => {
  it.each([
    ["role", "Missing --role."],
    ["name", "Missing --name."],
  ])("names the empty %s flag", (flag, message) => {
    expect(
      emptyFlag({
        role: flag === "role" ? "" : "reader",
        name: flag === "name" ? "" : "n",
      }),
    ).toEqual({
      error: message,
      code: USAGE_ERROR,
    });
  });

  it("passes when neither flag is empty", () => {
    expect(emptyFlag({ role: "reader", name: "n" })).toBeUndefined();
  });
});

describe("groupRefusal accepts only a group hc can carry as a label", () => {
  it("accepts a group that is not given, and a valid one", () => {
    expect(groupRefusal(undefined)).toBeUndefined();
    expect(groupRefusal("pair-a")).toBeUndefined();
  });

  it.each([
    ["an uppercase group", "Bad Group"],
    ["a group flag given without a value", true],
  ])("refuses %s, naming the rule", (_, group) => {
    expect(groupRefusal(group)).toEqual({
      error: `Invalid --group "${String(group)}". Use lowercase letters, digits, "-" and "_", at most 32 characters.`,
      code: USAGE_ERROR,
    });
  });
});

describe("leaseRefusal checks the host only for a writer", () => {
  it("never checks the host for a reader", async () => {
    await expect(leaseRefusal(deps, "reader")).resolves.toBeUndefined();

    expect(hostLeaseRefusal).not.toHaveBeenCalled();
    expect(spawnLoadRefusal).not.toHaveBeenCalled();
  });

  it("refuses a writer while the host lease holds it, and never checks the load", async () => {
    vi.mocked(hostLeaseRefusal).mockResolvedValue(
      "A live run holds the host lease.",
    );

    await expect(leaseRefusal(deps, "writer")).resolves.toEqual({
      error: "A live run holds the host lease.",
      code: FAILED,
    });
    expect(spawnLoadRefusal).not.toHaveBeenCalled();
  });

  it("refuses a writer while the host load is over its ceiling", async () => {
    vi.mocked(spawnLoadRefusal).mockReturnValue(
      "The host load is above its ceiling.",
    );

    await expect(leaseRefusal(deps, "writer")).resolves.toEqual({
      error: "The host load is above its ceiling.",
      code: FAILED,
    });
  });

  it("admits a writer when the lease and the load both allow it", async () => {
    await expect(leaseRefusal(deps, "writer")).resolves.toBeUndefined();
  });
});
