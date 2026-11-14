import { describe, expect, it } from "vitest";
import { run } from "../cli/index.js";
import {
  LEDGER,
  PATH,
  ghWrites,
  linked,
  record,
  withFlag,
} from "../testing/index.js";

const CLOSE = ["outcome", "close", "--idea", "1", "--ledger", LEDGER];

describe("harness outcome close", () => {
  it("refuses an idea with no recorded outcome and issues no gh call", async () => {
    const { h, issue } = await linked();
    expect(await run([...CLOSE, "--json"], h.deps)).toBe(1);
    const error = JSON.parse(h.err().split("\n")[0] ?? "") as { error: string };
    expect(error.error).toMatch(/no recorded outcome/);
    expect(error.error).toMatch(/harness outcome record/);
    expect(h.runner.calls.filter((c) => c.command === "gh")).toHaveLength(0);
    expect(issue.state).toBe("OPEN");
  });

  it("closes an issue whose outcome is recorded but unpublished, once", async () => {
    const { h, issue } = await linked();
    // Simulate a record that wrote the markdown and then failed on gh.
    await run(record(), h.deps);
    issue.state = "OPEN";
    issue.labels = ["ready-for-agent"];
    issue.comments = [];
    expect(await run(CLOSE, h.deps)).toBe(0);
    expect(issue.state).toBe("CLOSED");
    expect(issue.labels).toContain("outcome:confirmed");
    expect(issue.comments).toHaveLength(1);

    const writes = ghWrites(h).length;
    expect(await run([...CLOSE, "--json"], h.deps)).toBe(0);
    expect(ghWrites(h)).toHaveLength(writes);
  });

  it("does not record a second ledger event when nothing changed", async () => {
    const { h } = await linked();
    await run(record(), h.deps);
    await run(CLOSE, h.deps);
    const lines = (h.get(".kore/state/ledger.jsonl") ?? "").trim().split("\n");
    expect(lines).toHaveLength(1);
  });
});

describe("follow-up ideas", () => {
  it.each(["refuted", "inconclusive"])(
    "a %s outcome creates a new idea that links back and carries no approval",
    async (result) => {
      const { h } = await linked();
      await run(withFlag(record(), "--result", result), h.deps);
      const path = "docs/ideas/0002-follow-up-0001-cache-the-probe-results.md";
      const text = h.get(path) ?? "";
      expect(text).toContain("parent: 0001\n");
      expect(text).toContain("# Idea 0002: Follow up: Cache the probe results");
      expect(text).not.toMatch(/^issue:/m);
      expect(text).not.toMatch(/ready-for-agent|approved|status:/);
      expect(text).not.toMatch(/^outcome:/m);
      expect(h.get("docs/index.md")).toContain("ideas/0002-follow-up-");
      const gh = h.runner.calls.filter(
        (c) => c.command === "gh" && c.args.includes("--add-label"),
      );
      expect(gh.every((c) => !c.args.includes("ready-for-agent"))).toBe(true);
    },
  );

  it("a confirmed outcome creates no follow-up", async () => {
    const { h } = await linked();
    await run(record(), h.deps);
    expect(h.paths().filter((p) => p.startsWith("docs/ideas/"))).toEqual([
      PATH,
    ]);
  });

  it("rerunning close does not create a second follow-up", async () => {
    const { h } = await linked();
    await run(withFlag(record(), "--result", "refuted"), h.deps);
    await run(CLOSE, h.deps);
    expect(h.paths().filter((p) => p.startsWith("docs/ideas/"))).toHaveLength(
      2,
    );
  });

  it("names the follow-up in the issue comment and the command output", async () => {
    const { h, issue } = await linked();
    await run([...withFlag(record(), "--result", "refuted"), "--json"], h.deps);
    expect(issue.comments[0]).toContain("0002");
    expect(JSON.parse(h.out().trim().split("\n").at(-1) ?? "")).toMatchObject({
      followUp: "docs/ideas/0002-follow-up-0001-cache-the-probe-results.md",
    });
  });
});
