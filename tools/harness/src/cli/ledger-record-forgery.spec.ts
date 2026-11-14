import { describe, expect, it } from "vitest";
import { run } from "./cli.js";
import {
  LEDGER_FILE as DEFAULT,
  ledgerHarness as harness,
} from "../testing/index.js";

const POLLER_KINDS = [
  "ci.main",
  "ci.nightly",
  "main.revert",
  "owner.action",
  "pr.merged",
  "pr.opened",
  "issue.opened",
  "issue.closed",
  "issue.labelled",
];

const event = (source: string, kind: string) =>
  JSON.stringify({
    source,
    kind,
    occurredAt: "2026-01-02T03:04:05.000Z",
    number: 1,
    outcome: "success",
    label: "x",
    id: `github:${kind}:1`,
  });

describe("ledger record cannot forge what only the poller may write", () => {
  it.each(POLLER_KINDS)(
    "refuses %s from a github source, so a fake result or a pre-recorded id writes nothing",
    async (kind) => {
      const h = harness(event("github", kind));
      expect(await run(["ledger", "record"], h.deps)).toBe(1);
      expect(h.err()).toMatch(/only `ledger poll-github` writes/);
      expect(h.fs.files.has(DEFAULT)).toBe(false);
    },
  );

  it.each(POLLER_KINDS)(
    "refuses %s under any other source too",
    async (kind) => {
      const h = harness(event("claude", kind));
      expect(await run(["ledger", "record"], h.deps)).toBe(1);
      expect(h.fs.files.has(DEFAULT)).toBe(false);
    },
  );

  it("refuses a github source for any kind, given as flags", async () => {
    const h = harness();
    const code = await run(
      [
        "ledger",
        "record",
        "--source",
        "github",
        "--kind",
        "tool.start",
        "--occurred-at",
        "2026-01-02T03:04:05.000Z",
      ],
      h.deps,
    );
    expect(code).toBe(1);
    expect(h.fs.files.has(DEFAULT)).toBe(false);
  });

  it("still records an ordinary claude event", async () => {
    const h = harness(
      JSON.stringify({
        source: "claude",
        kind: "session.start",
        occurredAt: "2026-01-02T03:04:05.000Z",
        session: "s1",
      }),
    );
    expect(await run(["ledger", "record"], h.deps)).toBe(0);
  });
});
