import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeTerminals } from "../terminal/index.js";
import { closeOnHc } from "./close-hc.js";
import { removeMergedWorktree } from "./close-worktree.js";
import { closeHcSession } from "./close-hc-command.js";
import {
  contextOf,
  fakeDeps,
  fakeRegistry,
  asRegistry,
  type FakeDeps,
} from "./deps-support.js";
import { FAILED, fail } from "./output.js";
import type { SessionRecord } from "./registry.js";

vi.mock("./close-hc.js", () => ({ closeOnHc: vi.fn() }));
vi.mock("./close-worktree.js", () => ({ removeMergedWorktree: vi.fn() }));
vi.mock("./output.js", async (original) => ({
  ...(await original<typeof import("./output.js")>()),
  fail: vi.fn((_deps: unknown, _json: unknown, code: number) => code),
}));

const CLOSED_AT = "2026-01-02T03:04:05.000Z";
const RECORD: SessionRecord = {
  version: 1,
  backend: "hc",
  name: "image-trust-writer",
  paneId: "t2",
  terminal: "t2",
  model: "claude-sonnet-5-5",
  role: "writer",
  effort: "high",
  createdAt: CLOSED_AT,
  result: { outcome: "done", at: CLOSED_AT },
};

let deps: FakeDeps;
const registry = fakeRegistry();

beforeEach(() => {
  vi.resetAllMocks();
  deps = fakeDeps();
});

describe("closeHcSession closes a starting record that has no terminal", () => {
  it("says the session never started a terminal, instead of naming one", async () => {
    vi.mocked(closeOnHc).mockResolvedValue({ closedAt: CLOSED_AT });
    const { terminal: _terminal, ...starting } = RECORD;

    const code = await closeHcSession(
      contextOf(deps),
      new FakeTerminals(),
      asRegistry(registry),
      { ...starting, paneId: "", starting: true },
    );

    expect(code).toBe(0);
    expect(deps.stdout).toHaveBeenCalledExactlyOnceWith(
      "Closed image-trust-writer (it never started a terminal).\n",
    );
  });
});

describe("closeHcSession prints the close, or the reason it was refused", () => {
  it("prints the terminal it closed and exits 0", async () => {
    vi.mocked(closeOnHc).mockResolvedValue({ closedAt: CLOSED_AT });

    const code = await closeHcSession(
      contextOf(deps),
      new FakeTerminals(),
      asRegistry(registry),
      RECORD,
    );

    expect(code).toBe(0);
    expect(deps.stdout).toHaveBeenCalledExactlyOnceWith(
      "Closed image-trust-writer (terminal t2).\n",
    );
  });

  it("prints the close as JSON with --json", async () => {
    vi.mocked(closeOnHc).mockResolvedValue({ closedAt: CLOSED_AT });

    await closeHcSession(
      contextOf(deps, { json: true }),
      new FakeTerminals(),
      asRegistry(registry),
      RECORD,
    );

    expect(deps.stdout).toHaveBeenCalledExactlyOnceWith(
      '{"name":"image-trust-writer","terminal":"t2","closed":true}\n',
    );
  });

  it("fails through fail with the refusal from closeOnHc, and exits 1", async () => {
    vi.mocked(closeOnHc).mockResolvedValue({
      error: "Not inside an hc terminal (HC_TERMINAL_ID is unset).",
    });

    const code = await closeHcSession(
      contextOf(deps),
      new FakeTerminals(),
      asRegistry(registry),
      RECORD,
    );

    expect(code).toBe(FAILED);
    expect(fail).toHaveBeenCalledExactlyOnceWith(
      deps,
      false,
      FAILED,
      "Not inside an hc terminal (HC_TERMINAL_ID is unset).",
    );
  });
});

const WORKTREE = { path: "/main/.claude/worktrees/x", branch: "feat/x" };
const WITH_WORKTREE: SessionRecord = { ...RECORD, worktree: WORKTREE };
const ASKED = { options: { "remove-worktree": true } };
const RERUN = "session close image-trust-writer --remove-worktree";

describe("closeHcSession --remove-worktree removes the worktree once the terminal is closed", () => {
  it("closes the terminal, then removes the worktree and its branch, and says so", async () => {
    vi.mocked(closeOnHc).mockResolvedValue({ closedAt: CLOSED_AT });
    vi.mocked(removeMergedWorktree).mockResolvedValue({
      removed: true,
      message: "Removed worktree /w and deleted branch feat/x.",
    });

    const code = await closeHcSession(
      contextOf(deps, ASKED),
      new FakeTerminals(),
      asRegistry(registry),
      WITH_WORKTREE,
    );

    expect(code).toBe(0);
    expect(removeMergedWorktree).toHaveBeenCalledExactlyOnceWith(
      deps.runner,
      WORKTREE,
      deps.cwd,
      RERUN,
    );
    expect(deps.stdout).toHaveBeenCalledExactlyOnceWith(
      "Closed image-trust-writer (terminal t2). Removed worktree /w and deleted branch feat/x.\n",
    );
  });

  it("keeps the worktree, prints why and exits 1 when its pull request is not merged, the terminal staying closed", async () => {
    vi.mocked(closeOnHc).mockResolvedValue({ closedAt: CLOSED_AT });
    vi.mocked(removeMergedWorktree).mockResolvedValue({
      removed: false,
      reason: "branch feat/x is unmerged.",
    });

    const code = await closeHcSession(
      contextOf(deps, ASKED),
      new FakeTerminals(),
      asRegistry(registry),
      WITH_WORKTREE,
    );

    expect(code).toBe(FAILED);
    expect(deps.stderr).toHaveBeenCalledExactlyOnceWith(
      "branch feat/x is unmerged.\n",
    );
    expect(deps.stdout).toHaveBeenCalledExactlyOnceWith(
      "Closed image-trust-writer (terminal t2).\n",
    );
  });

  it("says a session without a worktree has none to remove, and removes nothing", async () => {
    vi.mocked(closeOnHc).mockResolvedValue({ closedAt: CLOSED_AT });

    const code = await closeHcSession(
      contextOf(deps, ASKED),
      new FakeTerminals(),
      asRegistry(registry),
      RECORD,
    );

    expect(code).toBe(FAILED);
    expect(removeMergedWorktree).not.toHaveBeenCalled();
    expect(deps.stderr).toHaveBeenCalledExactlyOnceWith(
      "Session image-trust-writer has no worktree, so there is none to remove.\n",
    );
  });
});

describe("closeHcSession --remove-worktree retries and reports", () => {
  it("retries only the removal on a session already closed, closing nothing again", async () => {
    vi.mocked(removeMergedWorktree).mockResolvedValue({
      removed: true,
      message: "Removed worktree /w and deleted branch feat/x.",
    });

    const code = await closeHcSession(
      contextOf(deps, ASKED),
      new FakeTerminals(),
      asRegistry(registry),
      { ...WITH_WORKTREE, closedAt: CLOSED_AT },
    );

    expect(code).toBe(0);
    expect(closeOnHc).not.toHaveBeenCalled();
    expect(deps.stdout).toHaveBeenCalledExactlyOnceWith(
      "Session image-trust-writer was already closed (terminal t2). Removed worktree /w and deleted branch feat/x.\n",
    );
  });

  it("prints the removal as JSON with --json", async () => {
    vi.mocked(closeOnHc).mockResolvedValue({ closedAt: CLOSED_AT });
    const removal = { removed: true as const, message: "Removed." };
    vi.mocked(removeMergedWorktree).mockResolvedValue(removal);

    await closeHcSession(
      contextOf(deps, { ...ASKED, json: true }),
      new FakeTerminals(),
      asRegistry(registry),
      WITH_WORKTREE,
    );

    expect(deps.stdout).toHaveBeenCalledExactlyOnceWith(
      `${JSON.stringify({ name: "image-trust-writer", terminal: "t2", closed: true, removal })}\n`,
    );
  });

  it("does not remove the worktree when the close is refused", async () => {
    vi.mocked(closeOnHc).mockResolvedValue({
      error: "Not inside an hc terminal.",
    });

    const code = await closeHcSession(
      contextOf(deps, ASKED),
      new FakeTerminals(),
      asRegistry(registry),
      WITH_WORKTREE,
    );

    expect(code).toBe(FAILED);
    expect(removeMergedWorktree).not.toHaveBeenCalled();
  });
});
