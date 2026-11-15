import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Runner } from "../runtime/index.js";
import { GitRevert, REVERT_BODY_SAFETY } from "./git-revert.js";

const ROOT = "/repo";
const SCRATCH = "/scratch";
const DIR = "/scratch/revert-idea-300";
const URL = "https://github.com/corekraft/kore/pull/55";

type Call = [string, readonly string[], { cwd?: string } | undefined];

function runnerWith(answer: (c: Call) => Partial<ReturnType<typeof ok>>) {
  const calls: Call[] = [];
  const runner: Runner = {
    run: vi.fn((command, args, options) => {
      const call: Call = [command, args, options];
      calls.push(call);
      return Promise.resolve({ ...ok(""), ...answer(call) });
    }),
  };
  return { runner, calls };
}

function ok(stdout: string) {
  return { stdout, stderr: "", code: 0 };
}

const view = JSON.stringify({
  mergeCommit: { oid: "abc123" },
  title: "feat(harness): speed up flow",
  files: [{ path: "tools/harness/src/flow/x.ts" }],
});

function happy([command, args]: Call) {
  if (command === "gh" && args[0] === "pr" && args[1] === "view") {
    return ok(view);
  }
  if (command === "gh" && args[1] === "create") {
    return ok(`${URL}\n`);
  }
  if (command === "gh" && args[1] === "list") {
    return ok("[]");
  }
  return ok("");
}

const text = (calls: Call[]) => calls.map(([c, a]) => `${c} ${a.join(" ")}`);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GitRevert.prepare", () => {
  it("reverts the merge commit on a fresh branch off main and opens a PR, in order", async () => {
    const { runner, calls } = runnerWith(happy);
    const made = await new GitRevert(runner, ROOT, SCRATCH).prepare({
      idea: "0007",
      issue: 300,
      pr: 41,
    });
    expect(made).toEqual({ number: 55, url: URL });
    const lines = text(calls);
    expect(lines.slice(1)).toEqual([
      "git fetch origin main",
      "git worktree add -b revert/idea-300 /scratch/revert-idea-300 origin/main",
      "git revert --no-commit abc123",
      "git commit -m revert(harness): undo refuted idea 0007 (#41) -m Reverts #41, the change for harness idea 0007, whose recorded outcome is refuted.",
      "git push origin revert/idea-300",
      expect.stringMatching(
        /^gh pr create --base main --head revert\/idea-300 /,
      ),
      "git worktree remove --force /scratch/revert-idea-300",
    ]);
    const cwds = calls.map(([, , o]) => o?.cwd);
    expect(cwds.slice(3, 5)).toEqual([DIR, DIR]);
  });
});

describe("GitRevert.prepare safety", () => {
  it("declares no-behaviour-change as the body's safety pattern and refs, never closes, the issue", async () => {
    const { runner, calls } = runnerWith(happy);
    await new GitRevert(runner, ROOT, SCRATCH).prepare({
      idea: "0007",
      issue: 300,
      pr: 41,
    });
    const create = calls.find(([, a]) => a[1] === "create");
    const body = String(create?.[1][create[1].indexOf("--body") + 1]);
    expect(body).toContain(`Safety pattern: ${REVERT_BODY_SAFETY}`);
    expect(REVERT_BODY_SAFETY).toBe("no-behaviour-change");
    expect(body).toContain("Idea: 300");
    expect(body.split("\n").at(-1)).toBe(
      `Safety pattern: ${REVERT_BODY_SAFETY}`,
    );
    expect(body).toContain("Refs #300");
    expect(body).not.toMatch(/\b(closes|fixes|resolves)\b/i);
  });

  it("never merges, approves or pushes to main", async () => {
    const { runner, calls } = runnerWith(happy);
    await new GitRevert(runner, ROOT, SCRATCH).prepare({
      idea: "0007",
      issue: 300,
      pr: 41,
    });
    const lines = text(calls).join("\n");
    expect(lines).not.toMatch(/pr merge|pr review|--admin|push origin main/);
  });

  it("removes the scratch worktree and opens nothing when the revert conflicts", async () => {
    const { runner, calls } = runnerWith((c) =>
      c[1][0] === "revert" ? { code: 1, stderr: "CONFLICT" } : happy(c),
    );
    await expect(
      new GitRevert(runner, ROOT, SCRATCH).prepare({
        idea: "0007",
        issue: 300,
        pr: 41,
      }),
    ).rejects.toThrow(
      "Reverting #41 failed: CONFLICT. Revert it by hand, then rerun `harness evaluate`.",
    );
    const lines = text(calls);
    expect(lines.some((l) => l.startsWith("gh pr create"))).toBe(false);
    expect(lines.some((l) => l.startsWith("git push"))).toBe(false);
    expect(lines.slice(-2)).toEqual([
      "git worktree remove --force /scratch/revert-idea-300",
      "git branch -D revert/idea-300",
    ]);
  });
});

describe("GitRevert.prepare cleanup", () => {
  it.each(["revert", "commit", "push", "create"])(
    "deletes the local branch when the %s step fails, so a rerun can add its worktree again",
    async (step) => {
      const { runner, calls } = runnerWith((c) => {
        const failing =
          c[1][0] === step || (step === "create" && c[1][1] === "create");
        return failing ? { code: 1, stderr: "boom" } : happy(c);
      });
      await expect(
        new GitRevert(runner, ROOT, SCRATCH).prepare({
          idea: "0007",
          issue: 300,
          pr: 41,
        }),
      ).rejects.toThrow();
      expect(text(calls).slice(-2)).toEqual([
        "git worktree remove --force /scratch/revert-idea-300",
        "git branch -D revert/idea-300",
      ]);
    },
  );

  it("keeps the local branch once the PR is open", async () => {
    const { runner, calls } = runnerWith(happy);
    await new GitRevert(runner, ROOT, SCRATCH).prepare({
      idea: "0007",
      issue: 300,
      pr: 41,
    });
    expect(text(calls).some((l) => l.startsWith("git branch"))).toBe(false);
  });

  it("names the failing gh call when the PR cannot be read", async () => {
    const { runner } = runnerWith((c) =>
      c[0] === "gh" ? { code: 1, stderr: "no auth" } : ok(""),
    );
    await expect(
      new GitRevert(runner, ROOT, SCRATCH).prepare({
        idea: "0007",
        issue: 300,
        pr: 41,
      }),
    ).rejects.toThrow(
      "`gh pr view 41` failed: no auth. Check `gh auth status`, then rerun `harness evaluate`.",
    );
  });
});

describe("GitRevert.existing", () => {
  it("finds a revert PR for the idea's branch in any state", async () => {
    const { runner, calls } = runnerWith(() =>
      ok(JSON.stringify([{ number: 56, url: URL }])),
    );
    expect(await new GitRevert(runner, ROOT, SCRATCH).existing(300)).toEqual({
      number: 56,
      url: URL,
    });
    expect(text(calls)).toEqual([
      "gh pr list --head revert/idea-300 --state all --json number,url",
    ]);
  });

  it("is undefined when there is none", async () => {
    const { runner } = runnerWith(() => ok("[]"));
    expect(
      await new GitRevert(runner, ROOT, SCRATCH).existing(300),
    ).toBeUndefined();
  });
});

describe("GitRevert.touchesGuardrail", () => {
  it.each([
    [".claude/guardrails.yaml", true],
    ["tools/harness/src/flow/x.ts", false],
  ])("for a change to %s is %s", async (path, expected) => {
    const { runner } = runnerWith(() =>
      ok(JSON.stringify({ files: [{ path }] })),
    );
    expect(
      await new GitRevert(runner, ROOT, SCRATCH).touchesGuardrail(41),
    ).toBe(expected);
  });
});
