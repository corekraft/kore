import { describe, expect, it } from "vitest";
import { FakeRunner } from "../runtime/runner-support.js";
import { run } from "./cli.js";
import { harness } from "./ledger-commands-support.js";

describe("ledger poll-github outcome signals", () => {
  it("also polls the outcome signals, keeping owner actions only for the --owner login", async () => {
    const h = harness("", { env: { KORE_ROOT: "/repo" } });
    const comment = (login: string) => ({
      id: login === "junners" ? 1 : 2,
      created_at: "2026-01-05T10:00:00Z",
      issue_url: "https://api.github.com/repos/corekraft/kore/issues/7",
      user: { login },
    });
    const runner = new FakeRunner([
      {
        match: (c, a) => c === "gh" && a[0] === "run",
        result: {
          stdout: JSON.stringify([
            {
              databaseId: 5,
              conclusion: "failure",
              updatedAt: "2026-01-05T09:00:00Z",
            },
          ]),
        },
      },
      {
        match: (c, a) => c === "gh" && a.join(" ").includes("issues/comments"),
        result: {
          stdout: JSON.stringify([comment("junners"), comment("other")]),
        },
      },
      { match: (c) => c === "gh", result: { stdout: "[]" } },
    ]);
    const deps = { ...h.deps, runner };
    expect(
      await run(
        ["ledger", "poll-github", "--owner", "junners", "--json"],
        deps,
      ),
    ).toBe(0);
    const kinds = (
      JSON.parse(h.out()) as { events: { kind: string }[] }
    ).events.map((e) => e.kind);
    expect(kinds.sort()).toEqual(["ci.main", "ci.nightly", "owner.action"]);
  });
});

describe("ledger poll-github owner login", () => {
  it("takes the owner login from the harness config, else the repository's owner", async () => {
    const h = harness("", { env: { KORE_ROOT: "/repo" } });
    h.fs.files.set(
      "/repo/.claude/harness.json",
      JSON.stringify({ ownerLogin: "junners" }),
    );
    const seen: string[] = [];
    const runner = new FakeRunner([
      {
        match: (c, a) => c === "gh" && a.join(" ").includes("issues/events"),
        result: {
          stdout: JSON.stringify([
            {
              id: 1,
              created_at: "2026-01-05T10:00:00Z",
              issue: { number: 3 },
              actor: { login: "junners" },
            },
            {
              id: 2,
              created_at: "2026-01-05T10:01:00Z",
              issue: { number: 3 },
              actor: { login: "corekraft" },
            },
          ]),
        },
      },
      { match: (c) => c === "gh", result: { stdout: "[]" } },
    ]);
    await run(["ledger", "poll-github", "--json"], { ...h.deps, runner });
    seen.push(
      ...(JSON.parse(h.out()) as { events: { id: string }[] }).events.map(
        (e) => e.id,
      ),
    );
    expect(seen).toEqual(["github:owner.action:event:1"]);
  });
});
