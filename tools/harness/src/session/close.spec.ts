import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CliDeps } from "../runtime/index.js";
import { close } from "./close.js";
import { removeMergedWorktree } from "./close-worktree.js";
import {
  SPAWNED,
  UNRESULTED,
  WITHOUT_WORKTREE,
  WORKTREE,
  asRegistry,
  fakeRegistry,
  scene,
  type Scene,
} from "./close-support.js";
import { describeFailure, equalize } from "./equalize.js";
import { sessionNameError } from "./names.js";
import { fail } from "./output.js";
import type { SessionRegistry } from "./registry.js";
import { closeHint } from "./worktree.js";

vi.mock("./close-worktree.js", () => ({
  removeMergedWorktree: vi.fn(),
}));
vi.mock("./equalize.js", () => ({
  equalize: vi.fn(),
  describeFailure: vi.fn(() => "herdr said no"),
}));
vi.mock("./names.js", () => ({
  sessionNameError: vi.fn(() => undefined),
}));
vi.mock("./output.js", async (original) => ({
  ...(await original<typeof import("./output.js")>()),
  fail: vi.fn(),
}));
// A plain object, not the class: a static method reference would be an unbound method.
const opener = vi.hoisted(() => ({
  open: vi.fn<(deps: CliDeps) => Promise<SessionRegistry>>(),
}));
vi.mock("./registry.js", () => ({ SessionRegistry: opener }));
vi.mock("./worktree.js", () => ({
  closeHint: vi.fn(() => "HINT"),
}));

const CLOSED_AT = "2026-01-02T03:06:00.000Z";
const WORKTREE_FLAG = { "remove-worktree": true };

/** The registry this test reads and writes, handed to close through the mocked class. */
function registryOf(record: typeof SPAWNED | undefined) {
  const registry = fakeRegistry(record);
  opener.open.mockResolvedValue(asRegistry(registry));
  return registry;
}

const failures = () => vi.mocked(fail).mock.calls;
const pairs = (s: Scene) => s.runner.run.mock.calls.map((c) => [c[0], c[1]]);

beforeEach(() => {
  // The real fail returns its exit code, and close returns what it returns.
  vi.mocked(fail).mockImplementation((_deps, _json, code) => code);
  vi.mocked(equalize).mockResolvedValue({ status: "equalized" });
  vi.mocked(removeMergedWorktree).mockResolvedValue({
    removed: true,
    message:
      "Removed worktree /main/.claude/worktrees/x and deleted branch feat/x.",
  });
});

describe("session close refusals, touching nothing", () => {
  it("asks for a session name, opening no registry and running no command", async () => {
    const s = scene({ operand: undefined });
    expect(await close(s.context)).toBe(2);
    expect(failures()).toEqual([
      [
        s.context.deps,
        false,
        2,
        "Missing the session name: session close <name>.",
      ],
    ]);
    expect(opener.open).not.toHaveBeenCalled();
    expect(s.runner.run).not.toHaveBeenCalled();
  });

  it("rejects an invalid name with the name error, before the registry", async () => {
    vi.mocked(sessionNameError).mockReturnValueOnce(
      "Session name must be a slug.",
    );
    const s = scene({ operand: "Bad Name" });
    expect(await close(s.context)).toBe(2);
    expect(failures()[0]?.[3]).toBe("Session name must be a slug.");
    expect(opener.open).not.toHaveBeenCalled();
  });

  it("refuses outside Herdr, opening nothing", async () => {
    const s = scene({ env: {} });
    expect(await close(s.context)).toBe(1);
    expect(failures()[0]?.[3]).toContain("Not inside Herdr");
    expect(opener.open).not.toHaveBeenCalled();
    expect(s.runner.run).not.toHaveBeenCalled();
  });

  it("refuses a name this tool did not create, closing no pane", async () => {
    registryOf(undefined);
    const s = scene();
    expect(await close(s.context)).toBe(1);
    expect(failures()[0]?.[3]).toContain("did not create a session named");
    expect(s.runner.run).not.toHaveBeenCalled();
  });

  it("refuses a pane another caller spawned, naming the one that may close it", async () => {
    registryOf(SPAWNED);
    const s = scene({ env: { HERDR_ENV: "1", HERDR_PANE_ID: "w3:p77" } });
    expect(await close(s.context)).toBe(1);
    expect(failures()[0]?.[3]).toContain("spawned from pane w3:p1, not w3:p77");
    expect(s.runner.run).not.toHaveBeenCalled();
  });

  it("refuses a session whose result is not recorded, naming session wait", async () => {
    registryOf(UNRESULTED);
    const s = scene();
    expect(await close(s.context)).toBe(1);
    expect(failures()[0]?.[3]).toContain(
      "Run `session wait image-trust-writer` first.",
    );
    expect(s.runner.run).not.toHaveBeenCalled();
  });

  it("refuses a session already closed, closing nothing twice", async () => {
    registryOf({ ...SPAWNED, closedAt: CLOSED_AT });
    const s = scene();
    expect(await close(s.context)).toBe(1);
    expect(failures()[0]?.[3]).toContain("already closed");
    expect(s.runner.run).not.toHaveBeenCalled();
  });
});

describe("session close closes the pane and records it", () => {
  it("closes the caller's child pane, records closedAt, equalizes from the caller pane, and prints the hint", async () => {
    const registry = registryOf(SPAWNED);
    const s = scene();
    expect(await close(s.context)).toBe(0);
    expect(pairs(s)).toEqual([["herdr", ["pane", "close", "w3:p9"]]]);
    expect(registry.write).toHaveBeenCalledWith({
      ...SPAWNED,
      closedAt: CLOSED_AT,
    });
    expect(equalize).toHaveBeenCalledWith(s.runner.runner, "w3:p1");
    expect(closeHint).toHaveBeenCalledWith(WORKTREE);
    expect(s.stdout).toHaveBeenCalledWith(
      "Closed image-trust-writer (pane w3:p9). HINT\n",
    );
    expect(removeMergedWorktree).not.toHaveBeenCalled();
  });

  it("keeps the session open and reports herdr's words when the pane cannot be closed", async () => {
    const registry = registryOf(SPAWNED);
    vi.mocked(describeFailure).mockReturnValueOnce("pane_not_found");
    const s = scene({ herdr: { code: 1, stderr: "pane_not_found" } });
    expect(await close(s.context)).toBe(1);
    expect(failures()[0]?.[3]).toBe(
      "herdr pane close w3:p9 failed: pane_not_found",
    );
    expect(registry.write).not.toHaveBeenCalled();
  });

  it("notes a failed equalize on stderr, and still reports the close", async () => {
    registryOf(SPAWNED);
    vi.mocked(equalize).mockResolvedValue({
      status: "failed",
      reason: "layout gone",
    });
    const s = scene();
    expect(await close(s.context)).toBe(0);
    expect(s.stderr).toHaveBeenCalledWith(
      "Closed, but equalizing failed: layout gone\n",
    );
  });

  it("prints no hint for a session without a worktree", async () => {
    registryOf(WITHOUT_WORKTREE);
    const s = scene();
    expect(await close(s.context)).toBe(0);
    expect(s.stdout).toHaveBeenCalledWith(
      "Closed image-trust-writer (pane w3:p9).\n",
    );
    expect(closeHint).not.toHaveBeenCalled();
  });
});

describe("session close JSON without --remove-worktree", () => {
  it("prints the close and the hint, with no removal field, and removes nothing", async () => {
    registryOf(SPAWNED);
    const s = scene({ json: true });
    expect(await close(s.context)).toBe(0);
    expect(JSON.parse(s.stdout.mock.calls[0]?.[0] ?? "")).toEqual({
      name: "image-trust-writer",
      paneId: "w3:p9",
      closed: true,
      equalize: { status: "equalized" },
      hint: "HINT",
    });
    expect(removeMergedWorktree).not.toHaveBeenCalled();
  });
});

describe("session close --remove-worktree", () => {
  it("removes the merged worktree from the caller's directory and names what it removed, with no hint", async () => {
    registryOf(SPAWNED);
    const s = scene({ flags: WORKTREE_FLAG });
    expect(await close(s.context)).toBe(0);
    expect(removeMergedWorktree).toHaveBeenCalledWith(
      s.runner.runner,
      WORKTREE,
      "/main",
    );
    expect(s.stdout).toHaveBeenCalledWith(
      "Closed image-trust-writer (pane w3:p9). Removed worktree /main/.claude/worktrees/x and deleted branch feat/x.\n",
    );
    expect(closeHint).not.toHaveBeenCalled();
  });

  it("closes the pane, keeps the worktree, and exits 1 with the reason on stderr", async () => {
    const registry = registryOf(SPAWNED);
    vi.mocked(removeMergedWorktree).mockResolvedValue({
      removed: false,
      reason: "branch feat/x is unmerged: no merged PR has it as its head.",
    });
    const s = scene({ flags: WORKTREE_FLAG });
    expect(await close(s.context)).toBe(1);
    expect(pairs(s)).toEqual([["herdr", ["pane", "close", "w3:p9"]]]);
    expect(registry.write).toHaveBeenCalledTimes(1);
    expect(s.stderr).toHaveBeenCalledWith(
      "branch feat/x is unmerged: no merged PR has it as its head.\n",
    );
    expect(s.stdout).toHaveBeenCalledWith(
      "Closed image-trust-writer (pane w3:p9).\n",
    );
  });

  it("exits 1 and removes nothing for a session that has no worktree", async () => {
    registryOf(WITHOUT_WORKTREE);
    const s = scene({ flags: WORKTREE_FLAG });
    expect(await close(s.context)).toBe(1);
    expect(removeMergedWorktree).not.toHaveBeenCalled();
    expect(s.stderr).toHaveBeenCalledWith(
      "Session image-trust-writer has no worktree, so there is none to remove.\n",
    );
  });

  it("prints the removal in the JSON output beside the close, and no hint", async () => {
    registryOf(SPAWNED);
    const s = scene({ flags: WORKTREE_FLAG, json: true });
    expect(await close(s.context)).toBe(0);
    expect(JSON.parse(s.stdout.mock.calls[0]?.[0] ?? "")).toEqual({
      name: "image-trust-writer",
      paneId: "w3:p9",
      closed: true,
      equalize: { status: "equalized" },
      removal: {
        removed: true,
        message:
          "Removed worktree /main/.claude/worktrees/x and deleted branch feat/x.",
      },
    });
  });
});
