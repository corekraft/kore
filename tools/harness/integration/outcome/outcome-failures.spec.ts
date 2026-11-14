import { describe, expect, it } from "vitest";
import { run } from "../../src/cli/index.js";
import { PATH, ghWrites, linked, record } from "../../src/testing/index.js";

describe("harness outcome record failing on gh", () => {
  it("names the failing gh step and how to resume, leaving the outcome recorded", async () => {
    const { h, issue } = await linked();
    const good = h.runner.run.bind(h.runner);
    h.runner.run = (command, args, options) =>
      command === "gh" && args[1] === "close"
        ? Promise.resolve({ stdout: "", stderr: "HTTP 502", code: 1 })
        : good(command, args, options);
    expect(await run(record(), h.deps)).toBe(1);
    expect(h.err()).toMatch(/gh issue close failed for issue 300: HTTP 502/);
    expect(h.err()).toMatch(/harness outcome close/);
    expect(h.get(PATH)).toMatch(/^outcome: confirmed$/m);
    expect(issue.state).toBe("OPEN");
    expect(h.get(".kore/state/ledger.jsonl")).toBeUndefined();

    h.runner.run = good;
    expect(
      await run(
        [
          "outcome",
          "close",
          "--idea",
          "1",
          "--ledger",
          "/repo/.kore/state/ledger.jsonl",
        ],
        h.deps,
      ),
    ).toBe(0);
    expect(issue.state).toBe("CLOSED");
    expect(
      (h.get(".kore/state/ledger.jsonl") ?? "").trim().split("\n"),
    ).toHaveLength(1);
  });

  it("reports unreadable gh output instead of guessing the issue state", async () => {
    const { h } = await linked();
    const good = h.runner.run.bind(h.runner);
    h.runner.run = (command, args, options) =>
      command === "gh" && args[0] === "issue" && args[1] === "view"
        ? Promise.resolve({ stdout: "not json", stderr: "", code: 0 })
        : good(command, args, options);
    expect(await run(record(), h.deps)).toBe(1);
    expect(h.err()).toMatch(/unreadable output for issue 300/);
    expect(ghWrites(h)).toHaveLength(0);
  });
});

describe("harness outcome with a missing label", () => {
  it("names the missing label and the command that creates it, not an auth hint", async () => {
    const { h, issue } = await linked();
    const good = h.runner.run.bind(h.runner);
    h.runner.run = (command, args, options) =>
      command === "gh" && args[1] === "edit"
        ? Promise.resolve({
            stdout: "",
            stderr: "failed to update: 'outcome:confirmed' not found",
            code: 1,
          })
        : good(command, args, options);
    expect(await run(record(), h.deps)).toBe(1);
    expect(h.err()).toContain('The label "outcome:confirmed" does not exist');
    expect(h.err()).toContain(
      "gh label create outcome:confirmed --repo corekraft/kore",
    );
    expect(h.err()).toMatch(/harness outcome close --idea 0001/);
    expect(h.err()).not.toMatch(/auth status/);
    expect(issue.state).toBe("OPEN");
    expect(issue.comments).toHaveLength(0);
  });
});

describe("harness outcome close refusals", () => {
  it("refuses an outcome line the tool did not write, naming how to redo it", async () => {
    const { h } = await linked();
    h.set(
      PATH,
      (h.get(PATH) ?? "").replace("issue: 300", "issue: 300\noutcome: won"),
    );
    expect(
      await run(
        [
          "outcome",
          "close",
          "--idea",
          "1",
          "--ledger",
          "/repo/.kore/state/ledger.jsonl",
        ],
        h.deps,
      ),
    ).toBe(1);
    expect(h.err()).toMatch(/did not write/);
    expect(ghWrites(h)).toHaveLength(0);
  });

  it("requires --idea and names how to list ideas", async () => {
    const { h } = await linked();
    expect(
      await run(
        ["outcome", "close", "--ledger", "/repo/.kore/state/ledger.jsonl"],
        h.deps,
      ),
    ).toBe(1);
    expect(h.err()).toMatch(/Missing --idea.*harness idea list/);
  });
});
