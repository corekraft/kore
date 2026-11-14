import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_LEDGER } from "../ledger/index.js";
import { mainRoot } from "../runtime/index.js";
import {
  asRegistry,
  contextOf,
  fakeDeps,
  fakeRegistry,
  type FakeDeps,
  type FakeRegistry,
} from "./deps-support.js";
import { FAILED, fail } from "./output.js";
import type { SessionRecord } from "./registry.js";
import { finish } from "./spawn-finish.js";
import { formatWait, waitForResult, type WaitResult } from "./wait.js";

vi.mock("node:path");
// The ledger's constructor and record are spies the spec holds, so no prototype is referenced.
const ledger = vi.hoisted(() => ({
  construct: vi.fn<(...args: unknown[]) => void>(),
  record: vi.fn<(event: object) => Promise<unknown>>(),
}));

vi.mock("../ledger/index.js", () => ({
  DEFAULT_LEDGER: ".kore/state/ledger.jsonl",
  Ledger: class {
    constructor(...args: unknown[]) {
      ledger.construct(...args);
    }
    record(event: object) {
      return ledger.record(event);
    }
  },
}));
vi.mock("../runtime/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../runtime/index.js")>()),
  mainRoot: vi.fn(),
}));
vi.mock("./wait.js");
vi.mock("./output.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./output.js")>()),
  fail: vi.fn(),
}));

const WORKTREE = { path: "/main/.claude/worktrees/x", branch: "feat/x" };
const RECORD: SessionRecord = {
  name: "image-trust-writer",
  paneId: "w3:p9",
  callerPane: "w3:p1",
  model: "claude-opus-5-5",
  role: "writer",
  effort: "high",
  createdAt: "2026-01-02T03:04:05.000Z",
};
const VERIFIED = { status: "verified" as const };
const LEDGER = "/main/.kore/state/ledger.jsonl";
const WAITED: WaitResult = {
  name: "image-trust-writer",
  paneId: "w3:p9",
  model: "claude-opus-5-5",
  outcome: "done",
  summary: "pane w3:p9",
};

let deps: FakeDeps;
let registry: FakeRegistry;

beforeEach(() => {
  deps = fakeDeps();
  registry = fakeRegistry();
  vi.mocked(join).mockImplementation((...parts: string[]) => parts.join("/"));
  vi.mocked(mainRoot).mockResolvedValue("/main");
  vi.mocked(fail).mockImplementation((_deps, _json, code) => code);
  vi.mocked(waitForResult).mockResolvedValue(WAITED);
  vi.mocked(formatWait).mockReturnValue("finished.\n");
});

/** Finishes the record with the given check, over the shared deps and a fresh registry. */
function run(
  options: Record<string, string | boolean> = {},
  json = false,
  record: SessionRecord = RECORD,
  modelCheck:
    typeof VERIFIED | { status: "unverified"; reason: string } = VERIFIED,
): Promise<number> {
  return finish(contextOf(deps, { json, options }), {
    registry: asRegistry(registry),
    record,
    modelCheck,
    timeoutMs: 60_000,
  });
}

describe("finish records the session before it reports", () => {
  it("creates the registry record first", async () => {
    await run({ "no-wait": true });

    expect(registry.create).toHaveBeenCalledExactlyOnceWith(RECORD);
  });

  it("appends a session.launch event to the main checkout's ledger", async () => {
    await run({ "no-wait": true });

    expect(ledger.construct).toHaveBeenCalledWith(
      deps.fs,
      deps.clock,
      deps.ids,
      LEDGER,
    );
    expect(join).toHaveBeenCalledWith("/main", DEFAULT_LEDGER);
    expect(ledger.record).toHaveBeenCalledExactlyOnceWith({
      source: "herdr",
      kind: "session.launch",
      occurredAt: RECORD.createdAt,
      pane: "w3:p9",
      agent: "image-trust-writer",
      role: "writer",
      tier: "claude-opus-5-5",
    });
  });

  it("keeps the spawn going when the ledger cannot record the event", async () => {
    ledger.record.mockRejectedValue(new Error("ledger down"));

    const code = await run({ "no-wait": true });

    expect(code).toBe(0);
    expect(registry.create).toHaveBeenCalledOnce();
  });

  it("records no ledger event outside a repository", async () => {
    vi.mocked(mainRoot).mockResolvedValue(undefined);

    await run({ "no-wait": true });

    expect(ledger.construct).not.toHaveBeenCalled();
    expect(registry.create).toHaveBeenCalledOnce();
  });
});

describe("finish with --no-wait reports at once", () => {
  it("says the session is spawned, its verdict and where its result will come", async () => {
    const code = await run({ "no-wait": true });

    expect(code).toBe(0);
    expect(deps.stdout).toHaveBeenCalledExactlyOnceWith(
      "Spawned image-trust-writer (claude-opus-5-5; model verified) in pane w3:p9; it will broadcast to w3:p1 when it finishes. Collect its result with `session wait image-trust-writer`.\n",
    );
    expect(waitForResult).not.toHaveBeenCalled();
  });

  it("names an unverified model and its reason in the verdict", async () => {
    await run({ "no-wait": true }, false, RECORD, {
      status: "unverified",
      reason: "the screen shows haiku",
    });

    expect(deps.stdout).toHaveBeenCalledWith(
      expect.stringContaining(
        "(claude-opus-5-5; model unverified: the screen shows haiku)",
      ),
    );
  });

  it("prints one JSON object with the worktree and the model check under --json", async () => {
    await run({ "no-wait": true }, true, { ...RECORD, worktree: WORKTREE });

    expect(deps.stdout).toHaveBeenCalledExactlyOnceWith(
      '{"name":"image-trust-writer","paneId":"w3:p9","model":"claude-opus-5-5","role":"writer","effort":"high","worktree":{"path":"/main/.claude/worktrees/x","branch":"feat/x"},"modelCheck":{"status":"verified"}}\n',
    );
  });
});

describe("finish waits for the result and reports it", () => {
  it("waits on the record with the timeout, through the registry", async () => {
    vi.mocked(waitForResult).mockResolvedValue(WAITED);

    await run();

    expect(waitForResult).toHaveBeenCalledWith(
      deps,
      asRegistry(registry),
      RECORD,
      60_000,
    );
  });

  it("fails with the wait's error and prints no result", async () => {
    vi.mocked(waitForResult).mockResolvedValue({ error: "timed out" });

    const code = await run();

    expect(code).toBe(FAILED);
    expect(fail).toHaveBeenCalledWith(deps, false, FAILED, "timed out");
    expect(deps.stdout).not.toHaveBeenCalled();
  });

  it("prints the formatted result, with the verdict, as text", async () => {
    vi.mocked(waitForResult).mockResolvedValue(WAITED);
    vi.mocked(formatWait).mockReturnValue(
      "image-trust-writer (claude-opus-5-5) finished: RESULT done; summary in pane w3:p9.\n",
    );

    const code = await run();

    expect(code).toBe(0);
    expect(deps.stdout).toHaveBeenCalledExactlyOnceWith(
      "image-trust-writer (claude-opus-5-5) finished: RESULT done; summary in pane w3:p9. (model verified).\n",
    );
  });

  it("prints the result with the role, effort and model check as one JSON object under --json", async () => {
    vi.mocked(waitForResult).mockResolvedValue(WAITED);

    await run({}, true);

    expect(deps.stdout).toHaveBeenCalledExactlyOnceWith(
      '{"name":"image-trust-writer","paneId":"w3:p9","model":"claude-opus-5-5","outcome":"done","summary":"pane w3:p9","role":"writer","effort":"high","modelCheck":{"status":"verified"}}\n',
    );
  });
});
