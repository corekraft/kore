import { describe, expect, it } from "vitest";
import { run } from "./cli.js";
import { report, scenario } from "./judge-support.js";

const CONFIG = "/repo/.claude/harness.json";

/** A precheck of PR 42 with the given harness config file, or none, and an optional --reviewer flag. */
function precheckWith(config?: string, flag?: string) {
  const h = scenario({
    files: config === undefined ? {} : { [CONFIG]: config },
  });
  const args = ["judge", "precheck", "42", "--json"];
  if (flag !== undefined) {
    args.push("--reviewer", flag);
  }
  return { h, args };
}

describe("judge precheck JSON names the reviewers it trusted", () => {
  it("names the configured owner login", async () => {
    const { h, args } = precheckWith(JSON.stringify({ ownerLogin: "junners" }));
    await run(args, h.deps);
    expect(report(h)["reviewers"]).toEqual(["junners"]);
  });

  it("names the reviewerLogins list when one is configured", async () => {
    const { h, args } = precheckWith(
      JSON.stringify({
        ownerLogin: "junners",
        reviewerLogins: ["bot-a", "bot-b"],
      }),
    );
    await run(args, h.deps);
    expect(report(h)["reviewers"]).toEqual(["bot-a", "bot-b"]);
  });

  it("names the --reviewer logins when the flag overrides the configuration", async () => {
    const { h, args } = precheckWith(
      JSON.stringify({ reviewerLogins: ["bot-a"] }),
      "bot-b,bot-c",
    );
    await run(args, h.deps);
    expect(report(h)["reviewers"]).toEqual(["bot-b", "bot-c"]);
  });
});

describe("judge precheck readable output names the reviewers", () => {
  it("prints a reviewers line after the pattern line", async () => {
    const { h } = precheckWith(JSON.stringify({ ownerLogin: "junners" }));
    await run(["judge", "precheck", "42"], h.deps);
    expect(h.out()).toContain(
      "pattern: no-behaviour-change (idea #193)\nreviewers: junners\n",
    );
  });
});

describe("judge precheck error output for an unreadable config", () => {
  it("names the file and the key, and fails", async () => {
    const { h, args } = precheckWith(JSON.stringify({ reviewerLogins: [] }));
    expect(await run(args, h.deps)).toBe(1);
    expect(h.err()).toContain(".claude/harness.json");
    expect(h.err()).toContain('key "reviewerLogins"');
  });
});
