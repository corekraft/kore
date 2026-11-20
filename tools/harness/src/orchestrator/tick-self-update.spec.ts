import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RunResult, Runner } from "../runtime/index.js";
import { TickSelfUpdate } from "./tick-self-update.js";

const ROOT = "/repo";
const ok = (stdout = ""): RunResult => ({ stdout, stderr: "", code: 0 });
const failed = (stderr: string): RunResult => ({ stdout: "", stderr, code: 1 });

/** Answers keyed by command line; a key with several answers gives them in turn, the last one repeating. */
type Answers = Record<string, RunResult | RunResult[]>;

const MAIN_BEHIND: Answers = {
  "git rev-parse --abbrev-ref HEAD": ok("main\n"),
  "git status --porcelain": ok(""),
  "git fetch --quiet origin main": ok(""),
  "git rev-list --count HEAD..origin/main": ok("2\n"),
  "git merge-base --is-ancestor HEAD origin/main": ok(""),
  "git rev-parse HEAD": [ok("aaa111\n"), ok("bbb222\n")],
  "git pull --ff-only": ok("Fast-forward\n"),
  "git diff --name-only aaa111 bbb222": ok("tools/harness/src/hook/guard.ts\n"),
  "mise run harness-build": ok(""),
};

function fakeRunner(answers: Answers) {
  const calls: string[] = [];
  const queues = new Map<string, RunResult[]>(
    Object.entries(answers).map(([key, value]) => [
      key,
      Array.isArray(value) ? [...value] : [value],
    ]),
  );
  const run = vi.fn(async (command: string, args: readonly string[]) => {
    const key = [command, ...args].join(" ");
    calls.push(key);
    const queue = queues.get(key);
    if (queue === undefined) {
      return ok();
    }
    return queue.length > 1
      ? (queue.shift() as RunResult)
      : (queue[0] as RunResult);
  });
  return { runner: { run } as unknown as Runner, calls };
}

function setup(answers: Answers) {
  const { runner, calls } = fakeRunner(answers);
  const out: string[] = [];
  const err: string[] = [];
  const recordFailure = vi.fn(async () => {});
  const updater = new TickSelfUpdate({
    runner,
    root: ROOT,
    recordFailure,
    stdout: (text) => out.push(text),
    stderr: (text) => err.push(text),
  });
  return { updater, calls, out, err, recordFailure };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("tick self-update: the pull and the build", () => {
  it("pulls origin/main and rebuilds the bundle when a clean main is behind", async () => {
    const { updater, calls, out, err, recordFailure } = setup(MAIN_BEHIND);

    await updater.run();

    expect(calls).toEqual([
      "git rev-parse --abbrev-ref HEAD",
      "git status --porcelain",
      "git fetch --quiet origin main",
      "git rev-list --count HEAD..origin/main",
      "git merge-base --is-ancestor HEAD origin/main",
      "git rev-parse HEAD",
      "git pull --ff-only",
      "git rev-parse HEAD",
      "git diff --name-only aaa111 bbb222",
      "mise run harness-build",
    ]);
    expect(out.join("")).toBe(
      "Updated main to bbb222 and rebuilt the harness bundle.\n",
    );
    expect(err.join("")).toBe("");
    expect(recordFailure).not.toHaveBeenCalled();
  });

  it("does nothing when main already matches origin/main", async () => {
    const { updater, calls, out } = setup({
      ...MAIN_BEHIND,
      "git rev-list --count HEAD..origin/main": ok("0\n"),
    });

    await updater.run();

    expect(calls).toEqual([
      "git rev-parse --abbrev-ref HEAD",
      "git status --porcelain",
      "git fetch --quiet origin main",
      "git rev-list --count HEAD..origin/main",
    ]);
    expect(out.join("")).toBe("");
  });
});

describe("tick self-update: the refusals", () => {
  it("never pulls off main: another branch is reported and the old bundle kept", async () => {
    const { updater, calls, out } = setup({
      ...MAIN_BEHIND,
      "git rev-parse --abbrev-ref HEAD": ok("idea-ticket-1433-writer\n"),
    });

    await updater.run();

    expect(calls).toEqual(["git rev-parse --abbrev-ref HEAD"]);
    expect(out.join("")).toBe(
      "The checkout is on idea-ticket-1433-writer, not main, so the tick keeps the bundle it has.\n",
    );
  });

  it("never pulls over a dirty tree: the change is reported and the old bundle kept", async () => {
    const { updater, calls, out } = setup({
      ...MAIN_BEHIND,
      "git status --porcelain": ok(" M tools/harness/src/hook/guard.ts\n"),
    });

    await updater.run();

    expect(calls).toEqual([
      "git rev-parse --abbrev-ref HEAD",
      "git status --porcelain",
    ]);
    expect(out.join("")).toBe(
      "The checkout has uncommitted changes, so the tick did not update main and keeps the bundle it has.\n",
    );
  });

  it("never pulls a non-fast-forward: the refusal is reported and no pull runs", async () => {
    const { updater, calls, err } = setup({
      ...MAIN_BEHIND,
      "git merge-base --is-ancestor HEAD origin/main": failed(""),
    });

    await updater.run();

    expect(calls).not.toContain("git pull --ff-only");
    expect(calls).not.toContain("mise run harness-build");
    expect(err.join("")).toBe(
      "origin/main is not a fast-forward of this checkout, so the tick did not pull it and keeps the bundle it has.\n",
    );
  });

  it("reports a failed fetch and rebuilds nothing", async () => {
    const { updater, calls, err } = setup({
      ...MAIN_BEHIND,
      "git fetch --quiet origin main": failed("boom\n"),
    });

    await updater.run();

    expect(calls.at(-1)).toBe("git fetch --quiet origin main");
    expect(err.join("")).toBe(
      "git fetch --quiet origin main failed with exit 1: boom\nThe tick keeps the bundle it has.\n",
    );
  });

  it("reports a failed pull and does not rebuild", async () => {
    const { updater, calls, err } = setup({
      ...MAIN_BEHIND,
      "git pull --ff-only": failed("fatal: Not possible to fast-forward\n"),
    });

    await updater.run();

    expect(calls.at(-1)).toBe("git pull --ff-only");
    expect(calls).not.toContain("mise run harness-build");
    expect(err.join("")).toBe(
      "git pull --ff-only failed with exit 1: fatal: Not possible to fast-forward\nThe tick keeps the bundle it has.\n",
    );
  });
});

describe("tick self-update: a failed build", () => {
  it("keeps the old bundle after a failed build, records it, and waits for origin/main to move", async () => {
    const { updater, calls, err, recordFailure } = setup({
      ...MAIN_BEHIND,
      "mise run harness-build": failed("boom\n"),
      "git rev-list --count HEAD..origin/main": [ok("1\n"), ok("0\n")],
    });

    await updater.run();

    expect(err.join("")).toBe(
      "The harness-build after the pull to bbb222 failed with exit 1: boom\nThe tick keeps the bundle it has and waits for origin/main to move.\n",
    );
    expect(recordFailure).toHaveBeenCalledTimes(1);
    expect(recordFailure).toHaveBeenCalledWith(
      "harness-build failed at bbb222 with exit 1",
    );

    const before = calls.length;
    await updater.run();

    expect(calls.slice(before)).toEqual([
      "git rev-parse --abbrev-ref HEAD",
      "git status --porcelain",
      "git fetch --quiet origin main",
      "git rev-list --count HEAD..origin/main",
    ]);
    expect(calls.filter((c) => c === "git pull --ff-only")).toHaveLength(1);
  });

  it("says the loop needs a restart when the update changed the loop's own files", async () => {
    const { updater, out } = setup({
      ...MAIN_BEHIND,
      "git diff --name-only aaa111 bbb222": ok(
        "tools/harness/src/cli/orchestrate-tick-loop.ts\ntools/harness/src/hook/guard.ts\n",
      ),
    });

    await updater.run();

    expect(out.join("")).toBe(
      "Updated main to bbb222 and rebuilt the harness bundle.\nThe tick loop changed; restart orchestrate tick --loop to run the new loop.\n",
    );
  });
});
