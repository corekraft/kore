import { describe, expect, it } from "vitest";
import { FakeRunner } from "../runtime/runner-support.js";
import { run } from "./cli.js";
import { DEFAULT, harness } from "./ledger-commands-support.js";

const agents = JSON.stringify({
  result: {
    agents: [
      { pane_id: "w3:p1", agent_status: "working", name: "orchestrator" },
    ],
  },
});

function polling(stdout: string, code = 0) {
  const h = harness("", { env: { KORE_ROOT: "/repo" } });
  const runner = new FakeRunner([
    { match: (c) => c === "herdr", result: { stdout, code } },
  ]);
  return { ...h, deps: { ...h.deps, runner }, runner };
}

describe("ledger poll-herdr", () => {
  it("appends pane transitions to the shared ledger and reports the count", async () => {
    const h = polling(agents);
    expect(await run(["ledger", "poll-herdr"], h.deps)).toBe(0);
    expect(h.out()).toBe("recorded 2 herdr event(s)\n");
    expect(h.fs.files.get(DEFAULT)?.trimEnd().split("\n")).toHaveLength(2);
  });

  it("appends nothing the second time and says so under --json", async () => {
    const h = polling(agents);
    await run(["ledger", "poll-herdr"], h.deps);
    const again = polling(agents);
    again.fs.files.set(DEFAULT, h.fs.files.get(DEFAULT) ?? "");
    expect(await run(["ledger", "poll-herdr", "--json"], again.deps)).toBe(0);
    expect(JSON.parse(again.out())).toEqual({ recorded: 0, events: [] });
    expect(again.fs.files.get(DEFAULT)).toBe(h.fs.files.get(DEFAULT));
  });

  it("names the herdr failure and writes nothing", async () => {
    const h = polling("", 1);
    expect(await run(["ledger", "poll-herdr"], h.deps)).toBe(1);
    expect(h.err()).toContain("herdr agent list failed");
    expect(h.fs.files.has(DEFAULT)).toBe(false);
  });

  it("reports a failure as JSON under --json", async () => {
    const h = polling("nope");
    expect(await run(["ledger", "poll-herdr", "--json"], h.deps)).toBe(1);
    expect(JSON.parse(h.err())).toMatchObject({ field: "herdr" });
  });
});

describe("ledger poll-github", () => {
  const gh = (code = 0, stdout = "[]") => {
    const h = harness("", { env: { KORE_ROOT: "/repo" } });
    const runner = new FakeRunner([
      { match: (c) => c === "gh", result: { stdout, code } },
    ]);
    return { ...h, deps: { ...h.deps, runner }, runner };
  };

  it("reports the count and passes --repo to gh", async () => {
    const h = gh();
    expect(
      await run(["ledger", "poll-github", "--repo", "acme/app"], h.deps),
    ).toBe(0);
    expect(h.out()).toBe("recorded 0 github event(s)\n");
    expect(h.runner.calls[0]?.args).toContain("acme/app");
  });

  it("defaults the repository to corekraft/kore", async () => {
    const h = gh();
    await run(["ledger", "poll-github"], h.deps);
    expect(h.runner.calls[0]?.args).toContain("corekraft/kore");
  });

  it("refuses a malformed --since before calling gh", async () => {
    const h = gh();
    expect(
      await run(["ledger", "poll-github", "--since", "yesterday"], h.deps),
    ).toBe(2);
    expect(h.err()).toContain("Invalid --since");
    expect(h.runner.calls).toHaveLength(0);
  });

  it("refuses a malformed --repo before calling gh", async () => {
    const h = gh();
    expect(await run(["ledger", "poll-github", "--repo", "nope"], h.deps)).toBe(
      2,
    );
    expect(h.runner.calls).toHaveLength(0);
  });

  it("names the gh failure as JSON under --json", async () => {
    const h = gh(1);
    expect(await run(["ledger", "poll-github", "--json"], h.deps)).toBe(1);
    expect(JSON.parse(h.err())).toMatchObject({ field: "github" });
  });
});
