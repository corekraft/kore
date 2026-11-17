// The stop hook records the priced token split beside token.usage: one token.split reading
// per model whose count grew, and nothing on a stop retry. The ledger, the token readers and
// the split reader are mocks; the rest of the stop checks see no marker and run nothing.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SplitOrigin } from "../ledger/index.js";
import type { CliDeps } from "../runtime/index.js";
import { feedback } from "./feedback.js";
import { readSplit, splitStateFile } from "./feedback-split.js";
import { readTokens, tokenStateFile } from "./feedback-tokens.js";
import { recordEvent } from "./ledger-event.js";

vi.mock("./feedback-tokens.js", () => ({
  readTokens: vi.fn(),
  tokenStateFile: vi.fn(),
}));
vi.mock("./feedback-split.js", () => ({
  readSplit: vi.fn(),
  splitStateFile: vi.fn(),
}));
vi.mock("./ledger-event.js", () => ({ recordEvent: vi.fn() }));

/** A stop with no changed-file marker, so the stop checks run nothing; the file system says so. */
function fakeDeps() {
  return {
    fs: { exists: vi.fn(() => Promise.resolve(false)) },
    env: {},
    cwd: "/repo",
    runner: { run: vi.fn() },
  } as unknown as CliDeps;
}

beforeEach(() => {
  vi.mocked(tokenStateFile).mockReturnValue("/state/tokens.json");
  vi.mocked(splitStateFile).mockReturnValue("/state/split.json");
  vi.mocked(readTokens).mockResolvedValue({ total: 0, grew: false, added: "" });
  vi.mocked(readSplit).mockResolvedValue([]);
  vi.mocked(recordEvent).mockReset();
});

describe("feedback stop records the token split", () => {
  it("records one token split reading per model whose count grew, after the token usage", async () => {
    const deps = fakeDeps();
    const payload = { session_id: "s1", transcript_path: "/t.jsonl" };
    const reading: SplitOrigin = {
      model: "claude-haiku-5-5",
      firstPrompt: 100,
      lowRequests: 2,
      lowInput: 10,
      lowCacheWrite5m: 0,
      lowCacheWrite1h: 0,
      lowCacheRead: 0,
      lowOutput: 1,
      highRequests: 0,
      highInput: 0,
      highCacheWrite5m: 0,
      highCacheWrite1h: 0,
      highCacheRead: 0,
      highOutput: 0,
    };
    vi.mocked(readTokens).mockResolvedValue({
      total: 120,
      grew: true,
      added: "",
    });
    vi.mocked(readSplit).mockResolvedValue([reading]);
    await feedback("stop", payload, deps);
    expect(vi.mocked(readSplit).mock.calls).toEqual([
      [deps.fs, "/t.jsonl", "/state/split.json"],
    ]);
    expect(vi.mocked(recordEvent).mock.calls).toEqual([
      [deps, "session.stop", payload],
      [deps, "token.usage", payload, undefined, { tokens: 120 }],
      [deps, "token.split", payload, undefined, reading],
    ]);
  });

  it("records no token split on a stop retry, which reads no transcript", async () => {
    const deps = fakeDeps();
    await feedback("stop", { session_id: "s1", stop_hook_active: true }, deps);
    expect(vi.mocked(readSplit)).not.toHaveBeenCalled();
    expect(vi.mocked(recordEvent)).not.toHaveBeenCalled();
  });
});
