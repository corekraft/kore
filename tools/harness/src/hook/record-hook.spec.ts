// `harness hook record session-start`, ported from the record.mjs cases in
// .claude/hooks/ledger.test.mjs.
// Plan: infra/plans/8-harness-measurement.md#step-3-stage-event-ledger

import { describe, expect, it } from "vitest";
import { run } from "../cli/index.js";
import { testHarness } from "../testing/index.js";
import { LEDGER } from "./feedback-support.js";

/** The ledger's events from a fake file map, one JSON object per line. */
const ledgerEvents = (files: Map<string, string>) =>
  (files.get(LEDGER) ?? "")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);

async function record(payload: unknown, env: Record<string, string> = {}) {
  const h = testHarness({ env: { KORE_ROOT: "/repo", ...env } });
  h.deps.stdin = () => Promise.resolve(JSON.stringify(payload));
  const code = await run(["hook", "record", "session-start"], h.deps);
  return { code, out: h.out(), err: h.err(), events: ledgerEvents(h.files) };
}

describe("hook record session-start", () => {
  for (const source of ["startup", "clear", "resume"]) {
    it(`a ${source} records a session start with session and pane, and prints nothing`, async () => {
      const result = await record(
        { session_id: "s1", source },
        { HERDR_PANE_ID: "w9:p9" },
      );
      expect(result).toMatchObject({ code: 0, out: "", err: "" });
      expect(result.events).toMatchObject([
        {
          source: "claude",
          kind: "session.start",
          session: "s1",
          pane: "w9:p9",
        },
      ]);
    });
  }

  it("a compaction records nothing, since it continues the same session", async () => {
    const result = await record({ session_id: "s1", source: "compact" });
    expect(result).toMatchObject({ code: 0, out: "", events: [] });
  });

  it("records nothing for a payload that is not an object", async () => {
    const h = testHarness({ env: { KORE_ROOT: "/repo" } });
    h.deps.stdin = () => Promise.resolve("not json");
    expect(await run(["hook", "record", "session-start"], h.deps)).toBe(0);
    expect(ledgerEvents(h.files)).toEqual([]);
  });

  it("records nothing for a mode it does not know", async () => {
    const h = testHarness({ env: { KORE_ROOT: "/repo" } });
    h.deps.stdin = () =>
      Promise.resolve(JSON.stringify({ session_id: "s1", source: "startup" }));
    expect(await run(["hook", "record", "other"], h.deps)).toBe(0);
    expect(ledgerEvents(h.files)).toEqual([]);
  });
});
