// Feedback hook: the post-edit checks, the stop checks, and the dispatch that
// records ledger events around them. Token counting, ledger writes, the
// temporary directory and the path helpers are mocks; the error class is real.

import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CliDeps, FileSystem, Runner } from "../runtime/index.js";
import { CommandError } from "../runtime/index.js";
import {
  bound,
  feedback,
  isHarnessSource,
  isTrackedSource,
  postEdit,
  stop,
  type FeedbackDeps,
} from "./feedback.js";
import { readTokens, tokenStateFile } from "./feedback-tokens.js";
import { recordEvent } from "./ledger-event.js";

vi.mock("node:os");
vi.mock("node:path");
vi.mock("./feedback-tokens.js");
vi.mock("./ledger-event.js");
vi.mock("../runtime/index.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../runtime/index.js")>();
  return { CommandError: real.CommandError };
});

const ROOT = "/repo";
const KORE_TS = `${ROOT}/tools/kore/src/a.ts`;
const HARNESS_TS = `${ROOT}/tools/harness/src/hook/x.ts`;
const lines = (count: number) =>
  Array.from({ length: count }, (_, i) => `line ${i + 1}`).join("\n");

/** Typed checks: `run` is a mock; `mark`, `isMarked` and `clear` act on a set of changed projects. */
function fakeChecks() {
  const marked = new Set<string>();
  const fns = {
    run: vi.fn<FeedbackDeps["run"]>(() =>
      Promise.resolve({ status: 0, output: "" }),
    ),
    mark: vi.fn((project: string) => Promise.resolve(void marked.add(project))),
    isMarked: vi.fn((project: string) => Promise.resolve(marked.has(project))),
    clear: vi.fn((project: string) =>
      Promise.resolve(void marked.delete(project)),
    ),
  };
  const checks: FeedbackDeps = { root: ROOT, ...fns };
  return { checks, marked, fns };
}

/** A typed CliDeps for the dispatch: file system and runner are mocks; the root is the project dir. */
function fakeCli() {
  const fs = {
    writeFile: vi.fn<FileSystem["writeFile"]>(() => Promise.resolve()),
    exists: vi.fn<FileSystem["exists"]>(() => Promise.resolve(false)),
    remove: vi.fn<FileSystem["remove"]>(() => Promise.resolve()),
  };
  const runner = {
    run: vi.fn<Runner["run"]>(() =>
      Promise.resolve({ code: 0, stdout: "", stderr: "" }),
    ),
  };
  const env = { CLAUDE_PROJECT_DIR: ROOT };
  return {
    deps: { fs, runner, env, cwd: "/elsewhere" } as unknown as CliDeps,
    fs,
    runner,
  };
}

beforeEach(() => {
  vi.mocked(tmpdir).mockReturnValue("/tmp");
  vi.mocked(join).mockImplementation((...parts) => parts.join("/"));
  vi.mocked(tokenStateFile).mockReturnValue("/state/tokens.json");
  vi.mocked(readTokens).mockResolvedValue({ total: 0, grew: false });
});

describe("feedback source matching and bounds", () => {
  it("tracks only TypeScript under tools/kore/src, or under tools/harness/src and tests", () => {
    expect(isTrackedSource("tools/kore/src/cli/cli.ts", ROOT)).toBe(true);
    expect(isTrackedSource("tools/kore/package.json", ROOT)).toBe(false);
    expect(isHarnessSource("/repo/tools/harness/tests/a.spec.ts", ROOT)).toBe(
      true,
    );
    expect(isHarnessSource("tools/kore/src/a.ts", ROOT)).toBe(false);
  });

  it("leaves short output whole, and keeps the first 40 lines of a long report with a pointer", () => {
    expect(bound(lines(40), "cmd")).toBe(lines(40));
    const result = bound(lines(100), "npm run check");
    expect(result).toMatch(/line 40\n/);
    expect(result).not.toMatch(/line 41/);
    expect(result).toMatch(/60 more lines cut.*npm run check/);
  });
});

describe("feedback post-edit checks", () => {
  it("runs nothing for tools other than Write and Edit, or for files outside the tracked sources", async () => {
    const { checks, fns } = fakeChecks();
    const bash = { tool_name: "Bash", tool_input: { file_path: KORE_TS } };
    const readme = {
      tool_name: "Edit",
      tool_input: { file_path: "/repo/R.md" },
    };
    expect(await postEdit(bash, checks)).toEqual({});
    expect(await postEdit(readme, checks)).toEqual({});
    expect(fns.run.mock.calls).toEqual([]);
    expect(fns.mark.mock.calls).toEqual([]);
  });

  it("lints and format-checks a kore source, marks the project, and passes", async () => {
    const { checks, fns } = fakeChecks();
    const payload = { tool_name: "Write", tool_input: { file_path: KORE_TS } };
    expect(await postEdit(payload, checks)).toEqual({});
    expect(fns.mark.mock.calls).toEqual([["tools/kore"]]);
    expect(vi.mocked(fns.run).mock.calls).toEqual([
      [
        `${ROOT}/tools/kore/node_modules/.bin/oxlint`,
        ["--deny-warnings", KORE_TS],
      ],
      [`${ROOT}/tools/kore/node_modules/.bin/prettier`, ["--check", KORE_TS]],
    ]);
  });

  it("returns a lint failure to the agent with the command to re-run", async () => {
    const { checks, fns } = fakeChecks();
    fns.run.mockResolvedValueOnce({ status: 1, output: "lint boom" });
    const payload = { tool_name: "Edit", tool_input: { file_path: KORE_TS } };
    expect(await postEdit(payload, checks)).toEqual({
      code: 2,
      stderr: `oxlint reported problems in ${KORE_TS}. Fix them before continuing.\nlint boom\n`,
    });
  });

  it("asks for a kore prettier fix when a kore source is not formatted", async () => {
    const { checks, fns } = fakeChecks();
    vi.mocked(fns.run)
      .mockResolvedValueOnce({ status: 0, output: "" })
      .mockResolvedValueOnce({ status: 1, output: "drift" });
    const payload = { tool_name: "Write", tool_input: { file_path: KORE_TS } };
    expect(await postEdit(payload, checks)).toEqual({
      code: 2,
      stderr: `${KORE_TS} is not formatted. Run \`tools/kore/node_modules/.bin/prettier --write ${KORE_TS}\`.\ndrift\n`,
    });
  });

  it("checks a harness source with the harness tools and the mise format advice", async () => {
    const { checks, fns } = fakeChecks();
    vi.mocked(fns.run)
      .mockResolvedValueOnce({ status: 0, output: "" })
      .mockResolvedValueOnce({ status: 1, output: "drift" });
    const payload = {
      tool_name: "Write",
      tool_input: { file_path: HARNESS_TS },
    };
    expect(await postEdit(payload, checks)).toEqual({
      code: 2,
      stderr: `${HARNESS_TS} is not formatted. Run \`mise run format ${HARNESS_TS}\`.\ndrift\n`,
    });
    expect(fns.mark.mock.calls).toEqual([["tools/harness"]]);
    expect(vi.mocked(fns.run).mock.calls[0]?.[0]).toBe(
      `${ROOT}/tools/harness/node_modules/.bin/oxlint`,
    );
  });
});

describe("feedback stop checks", () => {
  it("passes without a run when no project changed since its last check", async () => {
    const { checks, fns } = fakeChecks();
    expect(await stop({ session_id: "s1" }, checks)).toEqual({});
    expect(fns.run.mock.calls).toEqual([]);
  });

  it("runs the kore typecheck for a changed project and clears its marker on success", async () => {
    const { checks, marked, fns } = fakeChecks();
    marked.add("tools/kore");
    expect(await stop({}, checks)).toEqual({});
    expect(vi.mocked(fns.run).mock.calls).toEqual([
      ["npm", ["--prefix", "tools/kore", "run", "check", "--silent"]],
    ]);
    expect(vi.mocked(fns.clear).mock.calls).toEqual([["tools/kore"]]);
  });

  it("fails with the typecheck report and keeps the marker when it fails", async () => {
    const { checks, marked, fns } = fakeChecks();
    marked.add("tools/kore");
    fns.run.mockResolvedValueOnce({
      status: 1,
      output: "TS2322",
    });
    expect(await stop({}, checks)).toEqual({
      code: 2,
      stderr:
        "Typecheck failed after your TypeScript changes. Fix it before finishing.\nTS2322\n",
    });
    expect(fns.clear.mock.calls).toEqual([]);
  });

  it("checks the harness after the kore check, with its own failure message", async () => {
    const { checks, marked, fns } = fakeChecks();
    marked.add("tools/harness");
    fns.run.mockResolvedValueOnce({ status: 1, output: "bad" });
    expect(await stop({}, checks)).toEqual({
      code: 2,
      stderr:
        "The harness typecheck failed after your TypeScript changes. Fix it before finishing.\nbad\n",
    });
  });

  it("does nothing when the stop is itself a retry of a stop hook", async () => {
    const { checks, marked, fns } = fakeChecks();
    marked.add("tools/kore");
    expect(await stop({ stop_hook_active: true }, checks)).toEqual({});
    expect(fns.run.mock.calls).toEqual([]);
  });
});

describe("feedback dispatch", () => {
  it("rejects an unknown or missing mode, listing the modes", async () => {
    const { deps } = fakeCli();
    await expect(feedback("bogus", {}, deps)).rejects.toThrow(
      new CommandError(
        'Unknown feedback mode "bogus". Modes: post-edit, stop, tool-failure.',
      ),
    );
    await expect(feedback(undefined, {}, deps)).rejects.toThrow(
      'Unknown feedback mode "". Modes: post-edit, stop, tool-failure.',
    );
    expect(await feedback("post-edit", undefined, deps)).toEqual({});
    expect(vi.mocked(recordEvent)).not.toHaveBeenCalled();
  });
});

describe("feedback dispatch, ledger events and markers", () => {
  it("clears each changed project's marker once its stop check passes", async () => {
    const { deps, fs } = fakeCli();
    fs.exists.mockResolvedValue(true);
    await feedback("stop", {}, deps);
    expect(fs.remove.mock.calls).toEqual([
      ["/tmp/kore-ts-changed-default"],
      ["/tmp/kore-harness-changed-default"],
    ]);
  });

  it("records a failed tool end and nothing else in tool-failure mode", async () => {
    const { deps, runner } = fakeCli();
    const payload = { tool_name: "Bash" };
    expect(await feedback("tool-failure", payload, deps)).toEqual({});
    expect(vi.mocked(recordEvent).mock.calls).toEqual([
      [deps, "tool.end", payload, "failure"],
    ]);
    expect(runner.run).not.toHaveBeenCalled();
  });

  it("records a successful tool end, then runs the post-edit checks in the project dir", async () => {
    const { deps, fs, runner } = fakeCli();
    const payload = { tool_name: "Edit", tool_input: { file_path: KORE_TS } };
    expect(await feedback("post-edit", payload, deps)).toEqual({});
    expect(vi.mocked(recordEvent).mock.calls).toEqual([
      [deps, "tool.end", payload, "success"],
    ]);
    expect(fs.writeFile.mock.calls).toEqual([
      ["/tmp/kore-ts-changed-default", ""],
    ]);
    expect(runner.run.mock.calls[0]).toEqual([
      `${ROOT}/tools/kore/node_modules/.bin/oxlint`,
      ["--deny-warnings", KORE_TS],
      { cwd: ROOT },
    ]);
  });

  it("records the session stop and the tokens it grew by, in stop mode", async () => {
    const { deps } = fakeCli();
    const payload = { session_id: "s1", transcript_path: "/t.jsonl" };
    vi.mocked(readTokens).mockResolvedValue({ total: 120, grew: true });
    await feedback("stop", payload, deps);
    expect(vi.mocked(readTokens).mock.calls).toEqual([
      [deps.fs, "/t.jsonl", "/state/tokens.json"],
    ]);
    expect(vi.mocked(recordEvent).mock.calls).toEqual([
      [deps, "session.stop", payload],
      [deps, "token.usage", payload, undefined, { tokens: 120 }],
    ]);
  });

  it("records no token usage when the transcript did not grow, and none on a stop retry", async () => {
    const { deps } = fakeCli();
    vi.mocked(readTokens).mockResolvedValue({ total: 120, grew: false });
    await feedback("stop", { session_id: "s1" }, deps);
    expect(vi.mocked(recordEvent).mock.calls.map((c) => c[1])).toEqual([
      "session.stop",
    ]);
    vi.mocked(recordEvent).mockClear();
    await feedback("stop", { stop_hook_active: true }, deps);
    expect(vi.mocked(recordEvent)).not.toHaveBeenCalled();
  });
});
