// `orchestrate run` end to end with real domains (orchestrator, flag overlay, retro
// filing, flow metric names) and a scripted host in place of gh, herdr and the harness
// tools (ADR 0104). It gates a release only, never a commit or a merge (ADR 0098).

import { describe, expect, it } from "vitest";
import { orchestrateCommands } from "../src/cli/orchestrate-commands.js";
import {
  context,
  host,
  repo,
  PROPOSALS,
  type Event,
} from "./orchestrate-run-support.js";

const FAILED = {
  ok: false,
  declaration: { ok: true },
  checks: { review: { result: "fail", detail: "1 violation" } },
};
const READY = { ok: true, declaration: { ok: true }, checks: {} };
const OUTCOME = {
  idea: "0042",
  kind: "verification",
  source: "comparison",
  result: "confirmed",
  evidence: "PR #50",
  summary: "Merged.",
};

const kinds = (events: Event[]) =>
  events.map((e) =>
    e.name === undefined ? e.kind : `${e.kind}:${e.role ?? ""}:${e.name}`,
  );

async function run(h: ReturnType<typeof host>, root: string) {
  const { context: ctx, stderr } = context(h, root, OUTCOME);
  const code = await orchestrateCommands["run"]?.run(ctx);
  return { code, stderr: stderr.join("") };
}

describe("orchestrate run", () => {
  it("sends a failed precheck back, launches no judge on it, and records each stage in order", async () => {
    const h = host([FAILED, READY]);
    const { code } = await run(h, repo(true));

    expect(code).toBe(0);
    expect(kinds(h.events)).toEqual([
      "session.launch:writer:idea-0042-writer",
      "review.run",
      "precheck",
      "judge.send-back",
      "session.launch:writer:idea-0042-writer",
      "review.run",
      "precheck",
      "session.launch:judge:idea-0042-judge",
      "outcome.recorded",
      "retro.triggered",
      "session.launch:reader:retro-20261115-1020",
      "idea.filed",
      "idea.filed",
    ]);
    // The only judge launch comes after the passing precheck, never after the failed one.
    const judge = kinds(h.events).indexOf(
      "session.launch:judge:idea-0042-judge",
    );
    expect(
      kinds(h.events.slice(0, judge)).filter((k) => k === "precheck"),
    ).toHaveLength(2);
    expect(h.events.filter((e) => e.kind === "judge.send-back")).toEqual([
      { kind: "judge.send-back", pr: 50 },
    ]);
  });

  it("files the retro's ideas exactly once across two runs", async () => {
    const h = host([READY]);
    const root = repo(true);
    await run(h, root);
    await run(h, root);

    expect(h.ideas.size).toBe(PROPOSALS.length);
    expect(h.events.filter((e) => e.kind === "idea.filed")).toHaveLength(
      PROPOSALS.length,
    );
    expect(h.events.filter((e) => e.kind === "retro.triggered")).toHaveLength(
      1,
    );
    expect(
      h.events.filter((e) => e.role === "reader").map((e) => e.name),
    ).toEqual(["retro-20261115-1020"]);
  });

  it("creates no second idea even when the trigger fires again for the same retro", async () => {
    const h = host([READY]);
    h.retroAlwaysNew = true;
    const root = repo(true);
    await run(h, root);
    await run(h, root);

    expect(h.ideaNew).toHaveLength(PROPOSALS.length * 2);
    expect(h.ideas.size).toBe(PROPOSALS.length);
  });

  it("starts no retro and files nothing while automatic-retro is off", async () => {
    const h = host([READY]);
    const { code, stderr } = await run(h, repo(false));

    expect(code).toBe(0);
    expect(stderr).toBe("");
    expect(h.ideaNew).toEqual([]);
    expect(h.events.some((e) => e.role === "reader")).toBe(false);
  });
});
