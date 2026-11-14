import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CliDeps } from "../runtime/index.js";
import {
  asRegistry,
  contextOf,
  fakeDeps,
  fakeRegistry,
  type FakeDeps,
} from "./deps-support.js";
import { FAILED, USAGE_ERROR, fail } from "./output.js";
import { launch } from "./launch.js";
import { roleToken } from "./role-token.js";
import { spawn } from "./spawn.js";
import { check, type Checked } from "./spawn-check.js";
import { finish } from "./spawn-finish.js";
import { openPane, type Opened } from "./spawn-pane.js";
import type { SessionRegistry } from "./registry.js";

const opener = vi.hoisted(() => ({
  open: vi.fn<(deps: CliDeps) => Promise<SessionRegistry>>(),
}));

vi.mock("./registry.js", () => ({ SessionRegistry: opener }));
vi.mock("./spawn-check.js");
vi.mock("./role-token.js");
vi.mock("./spawn-pane.js");
vi.mock("./launch.js");
vi.mock("./spawn-finish.js");
vi.mock("./output.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./output.js")>()),
  fail: vi.fn(),
}));

const VALUES = {
  role: "writer",
  name: "image-trust-writer",
  brief: "Do the thing.",
  model: "claude-opus-5-5",
  effort: "high",
};
const CHECKED: Checked = {
  values: VALUES,
  callerPane: "w3:p1",
  timeoutMs: 60_000,
};
const WORKTREE = { path: "/main/.claude/worktrees/x", branch: "feat/x" };
const CREATED_AT = "2026-01-02T03:04:05.000Z";

/** What openPane hands back for a pane it opened, with a worktree only when the spec places one. */
function opened(worktree?: typeof WORKTREE): Opened {
  return {
    paneId: "w3:p9",
    leftOpen: "The pane w3:p9 was left open.",
    placed: {
      cwd: "/repo",
      left: "",
      ...(worktree === undefined ? {} : { worktree }),
    },
    explain: vi.fn((error: string) => `explained: ${error}`),
  };
}

/** Every step answers the success path; a test overrides the one step it covers. */
function succeed(): void {
  vi.mocked(check).mockResolvedValue(CHECKED);
  vi.mocked(roleToken).mockResolvedValue(undefined);
  opener.open.mockResolvedValue(asRegistry(fakeRegistry()));
  vi.mocked(openPane).mockResolvedValue(opened());
  vi.mocked(launch).mockResolvedValue({ status: "verified" });
  vi.mocked(finish).mockResolvedValue(0);
  vi.mocked(fail).mockImplementation((_deps, _json, code) => code);
}

let deps: FakeDeps;

beforeEach(() => {
  deps = fakeDeps();
  succeed();
});

describe("spawn refuses before anything is opened", () => {
  it("returns the check's usage error, without resolving the token or opening the registry", async () => {
    vi.mocked(check).mockResolvedValue({
      error: "Missing --name.",
      code: USAGE_ERROR,
    });

    const code = await spawn(contextOf(deps));

    expect(code).toBe(USAGE_ERROR);
    expect(fail).toHaveBeenCalledExactlyOnceWith(
      deps,
      false,
      USAGE_ERROR,
      "Missing --name.",
    );
    expect(roleToken).not.toHaveBeenCalled();
    expect(opener.open).not.toHaveBeenCalled();
  });

  it("fails before any pane is split when the role's identity is missing", async () => {
    vi.mocked(roleToken).mockResolvedValue({
      error: "The writer identity is missing.",
    });

    const code = await spawn(contextOf(deps));

    expect(code).toBe(FAILED);
    expect(fail).toHaveBeenCalledWith(
      deps,
      false,
      FAILED,
      "The writer identity is missing.",
    );
    expect(openPane).not.toHaveBeenCalled();
  });
});

describe("spawn opens the pane", () => {
  it("passes the role's token to the pane when it has one", async () => {
    vi.mocked(roleToken).mockResolvedValue({ token: "ghs_writer" });
    const registry = asRegistry(fakeRegistry());
    opener.open.mockResolvedValue(registry);

    await spawn(contextOf(deps));

    expect(roleToken).toHaveBeenCalledWith(deps, "writer");
    expect(opener.open).toHaveBeenCalledWith(deps);
    expect(openPane).toHaveBeenCalledWith(
      contextOf(deps),
      CHECKED,
      registry,
      "ghs_writer",
    );
  });

  it("passes no token for a role that has no identity", async () => {
    await spawn(contextOf(deps));

    expect(openPane).toHaveBeenCalledWith(
      contextOf(deps),
      CHECKED,
      expect.anything(),
      undefined,
    );
  });

  it("fails with the pane's error, and launches nothing, when the pane cannot be opened", async () => {
    vi.mocked(openPane).mockResolvedValue({
      error: "herdr pane split failed.",
    });

    const code = await spawn(contextOf(deps));

    expect(code).toBe(FAILED);
    expect(fail).toHaveBeenCalledWith(
      deps,
      false,
      FAILED,
      "herdr pane split failed.",
    );
    expect(launch).not.toHaveBeenCalled();
    expect(finish).not.toHaveBeenCalled();
  });
});

describe("spawn launches the role", () => {
  it("explains a failed agent start through the opened pane, and records nothing", async () => {
    const explain = vi.fn((error: string) => `explained: ${error}`);
    vi.mocked(openPane).mockResolvedValue({ ...opened(), explain });
    vi.mocked(launch).mockResolvedValue({ error: "agent start failed" });

    const code = await spawn(contextOf(deps));

    expect(code).toBe(FAILED);
    expect(explain).toHaveBeenCalledWith("agent start failed");
    expect(fail).toHaveBeenCalledWith(
      deps,
      false,
      FAILED,
      "explained: agent start failed",
    );
    expect(finish).not.toHaveBeenCalled();
  });

  it("launches the checked role in the opened pane, naming the pane left open", async () => {
    await spawn(contextOf(deps));

    expect(launch).toHaveBeenCalledWith(deps, {
      ...VALUES,
      paneId: "w3:p9",
      callerPane: "w3:p1",
      leftOpen: "The pane w3:p9 was left open.",
    });
  });
});

describe("spawn records the session", () => {
  it("records the session with its worktree and the clock's creation time", async () => {
    const registry = asRegistry(fakeRegistry());
    opener.open.mockResolvedValue(registry);
    vi.mocked(openPane).mockResolvedValue(opened(WORKTREE));

    await spawn(contextOf(deps));

    expect(finish).toHaveBeenCalledWith(contextOf(deps), {
      registry,
      modelCheck: { status: "verified" },
      record: {
        name: "image-trust-writer",
        paneId: "w3:p9",
        callerPane: "w3:p1",
        model: "claude-opus-5-5",
        role: "writer",
        effort: "high",
        worktree: WORKTREE,
        createdAt: CREATED_AT,
      },
      timeoutMs: 60_000,
    });
  });

  it("records no worktree field when the spawn placed none", async () => {
    await spawn(contextOf(deps));

    const record = vi.mocked(finish).mock.calls[0]?.[1].record;
    expect(record).not.toHaveProperty("worktree");
  });

  it("returns the exit code that finish returns", async () => {
    vi.mocked(finish).mockResolvedValue(1);

    await expect(spawn(contextOf(deps))).resolves.toBe(1);
  });
});
