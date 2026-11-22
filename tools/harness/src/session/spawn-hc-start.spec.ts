import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeTerminals } from "../terminal/index.js";
import {
  asRegistry,
  fakeDeps,
  fakeRegistry,
  type FakeDeps,
} from "./deps-support.js";
import { hcMessage } from "./backend.js";
import type { Admitted } from "./spawn-hc-admit.js";
import { briefOperand } from "./spawn-hc-brief.js";
import { startSession } from "./spawn-hc-start.js";
import {
  noteUnstamped,
  recordIdeaLabels,
  recordLaunch,
} from "./spawn-record.js";

vi.mock("./backend.js", () => ({
  hcMessage: vi.fn(
    (error: { error: { message: string } }) => `hc: ${error.error.message}`,
  ),
}));
vi.mock("./spawn-hc-brief.js");
vi.mock("./spawn-record.js");

const CREATED_AT = "2026-01-02T03:04:05.000Z";
const BUNDLE = "/main/skills/bin/harness.mjs";
const OPERAND = "Read the rules.";
const EXEC_ARGV = [
  "node",
  BUNDLE,
  "session",
  "exec",
  "--role",
  "reader",
  "--model",
  "claude-sonnet-5-5",
  "--effort",
  "high",
  OPERAND,
];

let deps: FakeDeps;
let terminals: FakeTerminals;
let registry: ReturnType<typeof fakeRegistry>;
let admitted: Admitted;

beforeEach(async () => {
  vi.clearAllMocks();
  deps = fakeDeps();
  terminals = new FakeTerminals();
  await terminals.run({ argv: ["bash"], cwd: "/w" });
  registry = fakeRegistry();
  registry.create.mockResolvedValue(undefined);
  registry.write.mockResolvedValue(undefined);
  vi.mocked(briefOperand).mockResolvedValue(OPERAND);
  admitted = {
    requested: {
      values: {
        role: "reader",
        name: "image-trust-reader",
        brief: "Read the rules.",
        model: "claude-sonnet-5-5",
        effort: "high",
      },
      timeoutMs: 60_000,
      tier: { tierSource: "definition" },
    },
    parent: { parent: "t1", delivery: false },
    terminals,
    reserved: { registry: asRegistry(registry), cwd: "/repo", main: "/main" },
  };
});

describe("startSession writes the starting record before the terminal starts", () => {
  it("creates the record, with its starting mark and no terminal, before any terminal exists", async () => {
    const seen: number[] = [];
    registry.create.mockImplementation(async () => {
      const listed = await terminals.list();
      seen.push("error" in listed ? -1 : listed.length);
    });

    await startSession(deps, admitted);

    expect(registry.create).toHaveBeenCalledExactlyOnceWith({
      version: 1,
      backend: "hc",
      name: "image-trust-reader",
      paneId: "",
      model: "claude-sonnet-5-5",
      role: "reader",
      effort: "high",
      createdAt: CREATED_AT,
      starting: true,
    });
    expect(seen).toStrictEqual([1]);
  });
});

describe("startSession runs the exec wrapper as one hc run", () => {
  it("runs it under the parent, labelled, in the placed directory, with the operand as its prompt", async () => {
    const run = vi.spyOn(terminals, "run");

    await startSession(deps, admitted);

    expect(briefOperand).toHaveBeenCalledWith(
      deps.fs,
      "/main",
      "image-trust-reader",
      "Read the rules.",
    );
    expect(run).toHaveBeenCalledExactlyOnceWith({
      argv: EXEC_ARGV,
      name: "image-trust-reader",
      cwd: "/repo",
      labels: {
        "kore-session": "image-trust-reader",
        role: "reader",
        model: "claude-sonnet-5-5",
      },
      parent: "t1",
    });
  });

  it("adds --no-notify for a child of the delivery terminal", async () => {
    const run = vi.spyOn(terminals, "run");
    admitted.parent = { parent: "t1", delivery: true };

    await startSession(deps, admitted);

    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({ parent: "t1", notify: false }),
    );
  });

  it("labels the session with its group when one is given", async () => {
    const run = vi.spyOn(terminals, "run");
    admitted.group = "pair-a";

    await startSession(deps, admitted);

    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({
        labels: {
          "kore-session": "image-trust-reader",
          role: "reader",
          model: "claude-sonnet-5-5",
          group: "pair-a",
        },
      }),
    );
  });
});

describe("startSession settles the record and records the launch", () => {
  it("writes the record with the started terminal, and drops its starting mark", async () => {
    await expect(startSession(deps, admitted)).resolves.toEqual({
      terminal: "t2",
    });

    expect(registry.write).toHaveBeenCalledExactlyOnceWith({
      version: 1,
      backend: "hc",
      name: "image-trust-reader",
      paneId: "t2",
      terminal: "t2",
      model: "claude-sonnet-5-5",
      role: "reader",
      effort: "high",
      createdAt: CREATED_AT,
    });
  });

  it("records the launch with its tier, and the placed worktree on the record", async () => {
    const worktree = { path: "/repo/.claude/worktrees/x", branch: "feat/x" };
    admitted.reserved = { ...admitted.reserved, cwd: worktree.path, worktree };

    await startSession(deps, admitted);

    expect(registry.write).toHaveBeenCalledWith(
      expect.objectContaining({ worktree }),
    );
    expect(recordLaunch).toHaveBeenCalledWith(
      deps,
      expect.objectContaining({ terminal: "t2", model: "claude-sonnet-5-5" }),
      { tierSource: "definition" },
      undefined,
    );
  });

  it("records a writer's idea labels and an unstamped mark when they apply", async () => {
    admitted.requested = {
      ...admitted.requested,
      values: { ...admitted.requested.values, role: "writer" },
      idea: "#338",
      unstamped: { reason: "no issue" },
    };

    await startSession(deps, admitted);

    expect(recordIdeaLabels).toHaveBeenCalledWith(
      deps,
      { name: "image-trust-reader", createdAt: CREATED_AT },
      "#338",
    );
    expect(noteUnstamped).toHaveBeenCalledWith(
      deps,
      {
        name: "image-trust-reader",
        paneId: "t2",
        role: "writer",
        createdAt: CREATED_AT,
      },
      { reason: "no issue" },
    );
  });
});

describe("startSession closes a session hc does not start", () => {
  it("closes its record as blocked with hc's message, and returns that refusal", async () => {
    await terminals.run({
      argv: ["bash"],
      cwd: "/w",
      name: "image-trust-reader",
    });

    await expect(startSession(deps, admitted)).resolves.toEqual({
      error:
        "hc did not start image-trust-reader: hc: a live terminal is already named image-trust-reader. Its record is closed as blocked.",
    });
    expect(registry.write).toHaveBeenCalledExactlyOnceWith({
      version: 1,
      backend: "hc",
      name: "image-trust-reader",
      paneId: "",
      model: "claude-sonnet-5-5",
      role: "reader",
      effort: "high",
      createdAt: CREATED_AT,
      closedAt: CREATED_AT,
      result: {
        outcome: "blocked",
        at: CREATED_AT,
        summary:
          "hc did not start the session: hc: a live terminal is already named image-trust-reader",
      },
    });
    expect(recordLaunch).not.toHaveBeenCalled();
    expect(hcMessage).toHaveBeenCalled();
  });
});
