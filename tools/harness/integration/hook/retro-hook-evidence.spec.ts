// `harness hook retro-scan --evidence`: guard-block locations on top of the default report.
// Docs: infra/plans/5-self-maintenance.md#step-2-deterministic-retrospective-scan

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { fixtures } from "./retro-scan-support.js";
import { removeTemps, repoRoot, retro, temp } from "./retro-hook-support.js";

afterEach(removeTemps);

const STAMP = "2026-11-03T00:00:00.000Z";

/** A Bash call the guard blocked: its tool_use line, then its error result line. */
const blocked = (id: string, rule: string): string[] => [
  JSON.stringify({
    type: "assistant",
    timestamp: STAMP,
    message: { content: [{ type: "tool_use", id, name: "Bash", input: {} }] },
  }),
  JSON.stringify({
    type: "user",
    timestamp: STAMP,
    message: {
      content: [
        {
          type: "tool_result",
          tool_use_id: id,
          is_error: true,
          content: `PreToolUse:Bash hook error: [node guard.ts]: [guard:${rule}] synthetic block ${id}.`,
        },
      ],
    },
  }),
];

/** A transcript folder holding one session, `bravo`, made of the given lines. */
function transcripts(lines: string[]): string {
  const dir = join(temp(), "transcripts");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "bravo.jsonl"), `${lines.join("\n")}\n`);
  return dir;
}

describe("hook retro-scan --evidence", () => {
  it("adds guardEvidence beside the guard counts only when asked", async () => {
    const root = repoRoot();
    const plain = (await retro(root, ["--dir", fixtures])).out;
    expect(JSON.parse(plain)).not.toHaveProperty("guardEvidence");

    const result = await retro(root, ["--dir", fixtures, "--evidence"]);
    expect(result).toMatchObject({ code: 0, err: "" });
    const report = JSON.parse(result.out) as Record<string, unknown>;
    expect(report["guardEvidence"]).toEqual({
      "kubectl-context": [
        {
          session: "alpha",
          line: 16,
          excerpt:
            "PreToolUse:Bash hook error: [node <q>]: [guard:kubectl-context] synthetic block for kubectl-context.",
        },
      ],
    });
    expect(report["guards"]).toEqual(
      (JSON.parse(plain) as Record<string, unknown>)["guards"],
    );
  });

  it("gives each rule its own session:line locations for a transcript with blocks by two rules", async () => {
    const dir = transcripts([
      ...blocked("t1", "role-worktree"),
      ...blocked("t2", "bare-glob"),
      ...blocked("t3", "role-worktree"),
    ]);
    const result = await retro(repoRoot(), ["--dir", dir, "--evidence"]);
    expect(result).toMatchObject({ code: 0, err: "" });
    const report = JSON.parse(result.out) as Record<string, unknown>;
    expect(report["guardEvidence"]).toEqual({
      "bare-glob": [
        {
          session: "bravo",
          line: 4,
          excerpt:
            "PreToolUse:Bash hook error: [node guard.ts]: [guard:bare-glob] synthetic block t2.",
        },
      ],
      "role-worktree": [
        {
          session: "bravo",
          line: 2,
          excerpt:
            "PreToolUse:Bash hook error: [node guard.ts]: [guard:role-worktree] synthetic block t1.",
        },
        {
          session: "bravo",
          line: 6,
          excerpt:
            "PreToolUse:Bash hook error: [node guard.ts]: [guard:role-worktree] synthetic block t3.",
        },
      ],
    });
  });

  it("keeps the first 20 locations per rule and still counts all 25 blocks", async () => {
    const lines = Array.from({ length: 25 }, (_, i) =>
      blocked(`t${i + 1}`, "role-worktree"),
    ).flat();
    const dir = transcripts(lines);
    const result = await retro(repoRoot(), ["--dir", dir, "--evidence"]);
    const report = JSON.parse(result.out) as {
      guards: Record<string, { blocks: number }>;
      guardEvidence: Record<string, { line: number }[]>;
    };
    expect(report.guards["role-worktree"]?.blocks).toBe(25);
    const kept = report.guardEvidence["role-worktree"] ?? [];
    expect(kept).toHaveLength(20);
    expect(kept[0]?.line).toBe(2);
    expect(kept[19]?.line).toBe(40);
  });
});
