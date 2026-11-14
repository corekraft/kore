import { describe, expect, it } from "vitest";
import { run } from "../cli/index.js";
import {
  ISSUE,
  PATH,
  ghWrites,
  linked,
  record,
  withFlag,
} from "../testing/index.js";

const CASES = [
  ["confirmed", "experiment", "comparison"],
  ["refuted", "usage", "journal"],
  ["inconclusive", "verification", "live-run"],
] as const;

describe("harness outcome record", () => {
  it.each(CASES)(
    "writes a %s %s outcome from %s into the markdown and onto the issue, then closes it",
    async (result, kind, source) => {
      const { h, issue } = await linked();
      let argv = withFlag(record(), "--result", result);
      argv = withFlag(withFlag(argv, "--kind", kind), "--source", source);
      expect(await run([...argv, "--json"], h.deps)).toBe(0);

      const file = h.get(PATH) ?? "";
      expect(file).toContain(`outcome: ${result}\n`);
      expect(file).toMatch(/\n## Outcome\n/);
      expect(file).toContain(`- Kind: ${kind}`);
      expect(file).toContain(`- Source: ${source}`);
      expect(file).toContain("Up time fell from 41s to 29s.");

      expect(issue.comments).toHaveLength(1);
      expect(issue.comments[0]).toContain("Up time fell from 41s to 29s.");
      expect(issue.comments[0]).toContain(`Result: ${result}`);
      expect(issue.labels.filter((l) => l.startsWith("outcome:"))).toEqual([
        `outcome:${result}`,
      ]);
      expect(issue.labels).toContain("ready-for-agent");
      expect(issue.state).toBe("CLOSED");
      expect(JSON.parse(h.out().trim().split("\n").at(-1) ?? "")).toMatchObject(
        { idea: "0001", result, issue: ISSUE },
      );
    },
  );

  it("leaves exactly one outcome label by removing a stale one", async () => {
    const { h, issue } = await linked({
      labels: ["outcome:refuted", "ready-for-agent"],
    });
    await run(record(), h.deps);
    expect(issue.labels.filter((l) => l.startsWith("outcome:"))).toEqual([
      "outcome:confirmed",
    ]);
  });

  it("records an outcome event in the ledger", async () => {
    const { h } = await linked();
    await run(record(), h.deps);
    const events = (h.get(".kore/state/ledger.jsonl") ?? "")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: "outcome",
      source: "github",
      idea: "0001",
      label: "outcome:confirmed",
      number: 300,
    });
  });

  it("refuses to record a second outcome and points at close", async () => {
    const { h } = await linked();
    await run(record(), h.deps);
    const before = h.get(PATH);
    const writes = ghWrites(h).length;
    expect(await run(withFlag(record(), "--result", "refuted"), h.deps)).toBe(
      1,
    );
    expect(h.err()).toMatch(/already has an outcome \(confirmed\)/);
    expect(h.err()).toMatch(/harness outcome close/);
    expect(h.get(PATH)).toBe(before);
    expect(ghWrites(h)).toHaveLength(writes);
  });
});

describe("harness outcome record refusals", () => {
  it("refuses an idea with no linked issue before changing anything", async () => {
    const { h } = await linked();
    const text = (h.get(PATH) ?? "").replace("issue: 300\n", "");
    h.set(PATH, text);
    expect(await run(record(), h.deps)).toBe(1);
    expect(h.err()).toMatch(/harness idea sync/);
    expect(h.get(PATH)).toBe(text);
    expect(ghWrites(h)).toHaveLength(0);
  });

  it.each([
    ["--kind", "guess", /--kind "guess".*experiment, usage, verification/],
    ["--source", "vibes", /--source "vibes".*live-run, journal/],
    ["--result", "won", /--result "won".*confirmed, refuted, inconclusive/],
  ])("rejects an unknown %s with the allowed values", async (flag, v, msg) => {
    const { h } = await linked();
    const before = h.get(PATH);
    expect(await run(withFlag(record(), flag, v), h.deps)).toBe(1);
    expect(h.err()).toMatch(msg);
    expect(h.get(PATH)).toBe(before);
    expect(h.runner.calls).toHaveLength(0);
  });

  it.each(["--kind", "--source", "--evidence", "--result", "--summary"])(
    "rejects a missing %s before any write",
    async (flag) => {
      const { h } = await linked();
      const argv = record();
      argv.splice(argv.indexOf(flag), 2);
      expect(await run(argv, h.deps)).toBe(1);
      expect(h.err()).toContain(`Missing ${flag}`);
      expect(ghWrites(h)).toHaveLength(0);
    },
  );

  it("rejects a summary that would start a new section in the idea", async () => {
    const { h } = await linked();
    const before = h.get(PATH);
    expect(
      await run(
        withFlag(record(), "--summary", "ok\n## Hypothesis\nx"),
        h.deps,
      ),
    ).toBe(1);
    expect(h.err()).toMatch(/must not start a line with #/);
    expect(h.get(PATH)).toBe(before);
  });

  it("fails before any write when the ledger cannot be located", async () => {
    const { h } = await linked();
    const argv = record();
    argv.splice(argv.indexOf("--ledger"), 2);
    expect(await run(argv, h.deps)).toBe(1);
    expect(h.err()).toMatch(/ledger/);
    expect(ghWrites(h)).toHaveLength(0);
    expect(h.get(PATH)).not.toMatch(/^outcome:/m);
  });

  it("keeps the outcome out of the issue body on the next sync", async () => {
    const { h } = await linked();
    await run(record(), h.deps);
    h.runner.calls.length = 0;
    await run(["idea", "sync", "--idea", "1"], h.deps);
    const bodies = h.runner.calls.map((c) => c.options?.input ?? "").join("\n");
    expect(bodies).not.toContain("Up time fell");
    expect(bodies).not.toContain("## Outcome");
  });
});
