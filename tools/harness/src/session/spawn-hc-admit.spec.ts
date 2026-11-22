import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeTerminals } from "../terminal/index.js";
import {
  asRegistry,
  contextOf,
  fakeDeps,
  fakeRegistry,
  type FakeDeps,
} from "./deps-support.js";
import { terminalsFor } from "./backend.js";
import { FAILED, USAGE_ERROR } from "./output.js";
import { checkRequest } from "./spawn-check.js";
import { emptyFlag, groupRefusal, leaseRefusal } from "./spawn-hc-gate.js";
import { admit } from "./spawn-hc-admit.js";
import { resolveParent } from "./spawn-hc-parent.js";
import { reserve } from "./spawn-hc-place.js";

vi.mock("./backend.js");
vi.mock("./spawn-check.js");
vi.mock("./spawn-hc-gate.js");
vi.mock("./spawn-hc-parent.js");
vi.mock("./spawn-hc-place.js");

const VALUES = {
  role: "reader",
  name: "image-trust-reader",
  brief: "Read the rules.",
  model: "claude-sonnet-5-5",
  effort: "high",
};
const REQUESTED = {
  values: VALUES,
  timeoutMs: 60_000,
  tier: { tierSource: "definition" as const },
};
const RESERVED = {
  registry: asRegistry(fakeRegistry()),
  cwd: "/repo",
  main: "/main",
};

let deps: FakeDeps;
let terminals: FakeTerminals;

beforeEach(() => {
  vi.clearAllMocks();
  deps = fakeDeps();
  terminals = new FakeTerminals();
  vi.mocked(terminalsFor).mockReturnValue(terminals);
  vi.mocked(emptyFlag).mockReturnValue(undefined);
  vi.mocked(checkRequest).mockResolvedValue(REQUESTED);
  vi.mocked(leaseRefusal).mockResolvedValue(undefined);
  vi.mocked(groupRefusal).mockReturnValue(undefined);
  vi.mocked(resolveParent).mockResolvedValue({ parent: "t1", delivery: false });
  vi.mocked(reserve).mockResolvedValue(RESERVED);
});

describe("admit refuses before a terminal exists, in order", () => {
  it("returns the empty-flag refusal before it checks the request", async () => {
    vi.mocked(emptyFlag).mockReturnValue({
      error: "Missing --role.",
      code: USAGE_ERROR,
    });

    await expect(admit(contextOf(deps))).resolves.toEqual({
      error: "Missing --role.",
      code: USAGE_ERROR,
    });
    expect(checkRequest).not.toHaveBeenCalled();
  });

  it("returns the request's refusal and resolves no parent", async () => {
    vi.mocked(checkRequest).mockResolvedValue({
      error: "Missing --brief.",
      code: USAGE_ERROR,
    });

    await expect(admit(contextOf(deps))).resolves.toEqual({
      error: "Missing --brief.",
      code: USAGE_ERROR,
    });
    expect(resolveParent).not.toHaveBeenCalled();
  });

  it("returns the writer gate's refusal before it resolves a parent", async () => {
    vi.mocked(leaseRefusal).mockResolvedValue({
      error: "A live run holds the host lease.",
      code: FAILED,
    });

    await expect(admit(contextOf(deps))).resolves.toEqual({
      error: "A live run holds the host lease.",
      code: FAILED,
    });
    expect(leaseRefusal).toHaveBeenCalledExactlyOnceWith(deps, "reader");
    expect(resolveParent).not.toHaveBeenCalled();
  });

  it("returns the group refusal before it resolves a parent", async () => {
    vi.mocked(groupRefusal).mockReturnValue({
      error: 'Invalid --group "X".',
      code: USAGE_ERROR,
    });

    await expect(
      admit(contextOf(deps, { options: { group: "X" } })),
    ).resolves.toEqual({
      error: 'Invalid --group "X".',
      code: USAGE_ERROR,
    });
    expect(resolveParent).not.toHaveBeenCalled();
  });

  it("returns the parent's refusal, and reserves no name or place", async () => {
    vi.mocked(resolveParent).mockResolvedValue({ error: "no parent" });

    await expect(admit(contextOf(deps))).resolves.toEqual({
      error: "no parent",
      code: FAILED,
    });
    expect(reserve).not.toHaveBeenCalled();
  });

  it("returns the reservation's refusal", async () => {
    vi.mocked(reserve).mockResolvedValue({ error: "name is open" });

    await expect(admit(contextOf(deps))).resolves.toEqual({
      error: "name is open",
      code: FAILED,
    });
  });
});

describe("admit admits a request that every gate allows", () => {
  it("returns the request, its parent, the terminals and the reservation", async () => {
    await expect(admit(contextOf(deps))).resolves.toEqual({
      requested: REQUESTED,
      parent: { parent: "t1", delivery: false },
      terminals,
      reserved: RESERVED,
    });
  });

  it("carries the group when one is given", async () => {
    await expect(
      admit(contextOf(deps, { options: { group: "pair-a" } })),
    ).resolves.toMatchObject({
      group: "pair-a",
    });
  });
});
