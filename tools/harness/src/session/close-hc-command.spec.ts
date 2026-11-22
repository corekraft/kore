import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeTerminals } from "../terminal/index.js";
import { closeOnHc } from "./close-hc.js";
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

  it("refuses --remove-worktree before closeOnHc runs, since hc does not remove worktrees yet", async () => {
    const code = await closeHcSession(
      contextOf(deps, { options: { "remove-worktree": true } }),
      new FakeTerminals(),
      asRegistry(registry),
      RECORD,
    );

    expect(code).toBe(FAILED);
    expect(fail).toHaveBeenCalledExactlyOnceWith(
      deps,
      false,
      FAILED,
      "session close image-trust-writer --remove-worktree is not on hc yet, so nothing was closed. Close it without the flag, then remove its worktree with git once its pull request is merged.",
    );
    expect(closeOnHc).not.toHaveBeenCalled();
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
