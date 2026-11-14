import { describe, expect, it } from "vitest";
import { run } from "./cli.js";
import {
  LEDGER_FILE as DEFAULT,
  ledgerHarness as harness,
} from "../testing/index.js";

const startFlags = [
  "ledger",
  "record",
  "--source",
  "claude",
  "--kind",
  "session.start",
  "--occurred-at",
  "2026-01-02T03:00:00Z",
  "--session",
  "s1",
];

describe("ledger location", () => {
  it.each(["/repo", "/repo/.claude/worktrees/stage-ledger"])(
    "writes one shared ledger under the main checkout root when this checkout is %s",
    async (root) => {
      const h = harness("", { root, cwd: "/repo/sub/dir" });
      expect(await run(startFlags, h.deps)).toBe(0);
      expect([...h.fs.files.keys()]).toEqual([DEFAULT]);
      expect(h.runner.calls[0]).toMatchObject({
        command: "git",
        args: ["rev-parse", "--path-format=absolute", "--git-common-dir"],
        options: { cwd: root },
      });
    },
  );

  it("reads the same shared ledger from a worktree that list is run in", async () => {
    const h = harness("", { root: "/repo/.claude/worktrees/x" });
    h.fs.files.set(DEFAULT, "garbage\n");
    await run(["ledger", "list", "--json"], h.deps);
    expect(JSON.parse(h.out())).toEqual({ events: [], skipped: 1 });
  });

  it("honours KORE_ROOT without asking git", async () => {
    const h = harness("", { env: { KORE_ROOT: "/elsewhere" } });
    expect(await run(startFlags, h.deps)).toBe(0);
    expect([...h.fs.files.keys()]).toEqual([
      "/elsewhere/.kore/state/ledger.jsonl",
    ]);
    expect(h.runner.calls).toEqual([]);
  });

  it("fails with an actionable JSON error when no root is found, writing nothing", async () => {
    const h = harness("", { commonDir: undefined });
    expect(await run([...startFlags, "--json"], h.deps)).toBe(1);
    const error = JSON.parse(h.err()) as { error: string };
    expect(error.error).toContain("KORE_ROOT");
    expect(error.error).toContain("--ledger");
    expect(h.fs.files.size).toBe(0);
  });

  it("fails the same way for list, in plain text too", async () => {
    const h = harness("", { commonDir: undefined });
    expect(await run(["ledger", "list"], h.deps)).toBe(1);
    expect(h.err()).toContain("KORE_ROOT");
  });

  it("does not ask git when --ledger is given, and resolves it against the working directory", async () => {
    const h = harness("", { cwd: "/repo/sub", commonDir: undefined });
    expect(await run([...startFlags, "--ledger", "x.jsonl"], h.deps)).toBe(0);
    expect(h.fs.files.has("/repo/sub/x.jsonl")).toBe(true);
    expect(h.runner.calls).toEqual([]);
  });
});
