// The context hook's reads of real state: session transcripts and journals.
// Docs: infra/plans/4-knowledge.md#step-4-upward-context

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { hookRun } from "../../src/testing/index.js";

const { additional, agents, cleanTemps, context, repository, temp } = hookRun;
const { repoPlan: plan } = hookRun;

afterEach(cleanTemps);

describe("harness hook context, session and journal state", () => {
  it("a fresh session counts earlier transcripts but not its own", async () => {
    const root = repository({
      "AGENTS.md": agents,
      "infra/plans/3-agent-harness.md": plan,
    });
    const config = temp("kore-config-");
    const transcripts = join(
      config,
      "projects",
      root.replace(/[^a-zA-Z0-9]/g, "-"),
    );
    mkdirSync(transcripts, { recursive: true });
    for (const id of ["a", "b", "c", "d", "e", "current"]) {
      writeFileSync(join(transcripts, `${id}.jsonl`), "{}\n");
    }
    writeFileSync(join(transcripts, "notes.txt"), "");
    const startup = JSON.stringify({
      source: "startup",
      session_id: "current",
    });

    const first = await context(root, startup, config);
    expect(additional(first)).toMatch(
      /Session brief from infra\/plans\/3-agent-harness\.md/,
    );
    expect(additional(first)).toMatch(
      /5 sessions without a recorded retrospective/,
    );

    rmSync(join(transcripts, "e.jsonl"));
    expect((await context(root, startup, config)).out).not.toMatch(/retro/);
  });

  it("sessions from the day of the last retrospective count toward the next one, with no gap", async () => {
    const today = new Date().toLocaleDateString("sv"); // local YYYY-MM-DD
    const root = repository({
      "AGENTS.md": agents,
      "infra/plans/3-agent-harness.md": `${plan}\nLast retrospective: ${today}\n`,
    });
    const config = temp("kore-config-");
    const transcripts = join(
      config,
      "projects",
      root.replace(/[^a-zA-Z0-9]/g, "-"),
    );
    mkdirSync(transcripts, { recursive: true });
    for (const id of ["a", "b", "c", "d", "e", "f"]) {
      writeFileSync(join(transcripts, `${id}.jsonl`), "{}\n");
    }
    const result = await context(
      root,
      JSON.stringify({ source: "startup", session_id: "current" }),
      config,
    );
    expect(result.out).toMatch(/6 sessions since the last retrospective/);
  });

  it("a missing transcript directory counts no sessions", async () => {
    const root = repository({ "infra/plans/3-agent-harness.md": plan });
    const result = await context(
      root,
      JSON.stringify({ source: "startup", session_id: "s" }),
      temp("kore-config-"),
    );
    expect(result.code).toBe(0);
    expect(additional(result)).not.toMatch(/retro/);
  });
});

describe("harness hook context, journals", () => {
  it("the startup brief carries the journal line without calling any cluster tool", async () => {
    const root = repository();
    const dir = join(root, ".kore/state/journal");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "local.jsonl"),
      `${JSON.stringify({ ts: "2026-11-07T10:00:00.000Z", op: "a", kind: "start", command: "local up" })}\n`,
    );
    const result = await context(
      root,
      JSON.stringify({ source: "startup", session_id: "s" }),
    );
    expect(result.code).toBe(0);
    expect(additional(result)).toMatch(
      /Environment local: last operation `local up` was interrupted/,
    );
    expect(result.runner.calls).toEqual([]);
  });

  it("an unreadable journal entry is skipped and the brief still carries the plan lines", async () => {
    const root = repository({
      "infra/plans/6-plan.md":
        "---\nstatus: active\nsummary: A plan.\nlast-verified: 2026-11-07\n---\n\n## Step 1: Work\n\n- [ ] Build it.\n",
    });
    mkdirSync(join(root, ".kore/state/journal/x.jsonl"), { recursive: true });
    const result = await context(
      root,
      JSON.stringify({ source: "startup", session_id: "s" }),
    );
    expect(result.code).toBe(0);
    expect(additional(result)).toMatch(/Open items: Step 1 \(1\)/);
  });

  it("the brief reads each journal file, skipping malformed lines and files that are not journals", async () => {
    const root = repository({});
    const dir = join(root, ".kore/state/journal");
    mkdirSync(dir, { recursive: true });
    const ts = "2026-11-07T10:00:00.000Z";
    const start = { ts, op: "a", kind: "start", command: "local up" };
    const end = { ts, op: "a", kind: "end", outcome: "ok" };
    writeFileSync(
      join(dir, "local.jsonl"),
      `${JSON.stringify(start)}\nnot json\n${JSON.stringify(end)}\n`,
    );
    writeFileSync(join(dir, "notes.txt"), "Environment notes: not a journal");
    const result = await context(
      root,
      JSON.stringify({ source: "startup", session_id: "s" }),
    );
    expect(additional(result)).toBe(
      "Environment local: last operation `local up` ok on 2026-11-07.",
    );
  });
});
