import { describe, expect, it } from "vitest";
import { FakeRunner } from "../runtime/runner-support.js";
import { run } from "./cli.js";
import { harness } from "./ledger-commands-support.js";

const comment = (id: number, login: string) => ({
  id,
  created_at: "2026-01-05T10:00:00Z",
  issue_url: "https://api.github.com/repos/corekraft/kore/issues/7",
  user: { login },
});

/** gh answers the issue comments as given and everything else as an empty list. */
function polling(comments: unknown[], config?: unknown) {
  const h = harness("", { env: { KORE_ROOT: "/repo" } });
  if (config !== undefined) {
    h.fs.files.set("/repo/.claude/harness.json", JSON.stringify(config));
  }
  const runner = new FakeRunner([
    {
      match: (c, a) => c === "gh" && a.join(" ").includes("issues/comments"),
      result: { stdout: JSON.stringify(comments) },
    },
    { match: (c) => c === "gh", result: { stdout: "[]" } },
  ]);
  const ids = async (argv: string[]) => {
    await run(argv, { ...h.deps, runner });
    return (
      JSON.parse(h.out()) as { events: { id: string; kind: string }[] }
    ).events
      .filter((e) => e.kind === "owner.action")
      .map((e) => e.id);
  };
  return { ids, runner, h };
}

describe("ledger poll-github owner login", () => {
  it("keeps only the login in the harness config", async () => {
    const p = polling([comment(1, "junners"), comment(2, "other")], {
      ownerLogin: "junners",
    });
    expect(await p.ids(["ledger", "poll-github", "--json"])).toEqual([
      "github:owner.action:comment:1",
    ]);
  });

  it("falls back to the repository's owner when the config names no login", async () => {
    const p = polling([comment(1, "acme"), comment(2, "junners")]);
    expect(
      await p.ids(["ledger", "poll-github", "--repo", "acme/app", "--json"]),
    ).toEqual(["github:owner.action:comment:1"]);
  });

  it("has no flag to override the login, so a caller cannot choose whose actions count", async () => {
    const p = polling([comment(1, "junners")], { ownerLogin: "junners" });
    const code = await run(["ledger", "poll-github", "--owner", "someone"], {
      ...p.h.deps,
      runner: p.runner,
    });
    expect(code).not.toBe(0);
    expect(p.runner.calls).toHaveLength(0);
  });

  it("names a bad harness config instead of polling", async () => {
    const p = polling([], { ownerLogin: "two words" });
    const code = await run(["ledger", "poll-github"], {
      ...p.h.deps,
      runner: p.runner,
    });
    expect(code).toBe(1);
    expect(p.h.err()).toContain("ownerLogin");
  });
});

describe("ledger poll-github outcome signals", () => {
  it("also polls the outcome signals and counts them in the total", async () => {
    const h = harness("", { env: { KORE_ROOT: "/repo" } });
    const runner = new FakeRunner([
      {
        match: (c, a) => c === "gh" && a[0] === "run",
        result: {
          stdout: JSON.stringify([
            {
              databaseId: 5,
              conclusion: "failure",
              updatedAt: "2026-01-05T09:00:00Z",
              attempt: 1,
            },
          ]),
        },
      },
      { match: (c) => c === "gh", result: { stdout: "[]" } },
    ]);
    expect(
      await run(["ledger", "poll-github", "--json"], { ...h.deps, runner }),
    ).toBe(0);
    const kinds = (
      JSON.parse(h.out()) as { events: { kind: string }[] }
    ).events.map((e) => e.kind);
    expect(kinds.sort()).toEqual(["ci.main", "ci.nightly"]);
  });

  it("passes --since to the signals", async () => {
    const h = harness("", { env: { KORE_ROOT: "/repo" } });
    const runner = new FakeRunner([
      { match: (c) => c === "gh", result: { stdout: "[]" } },
    ]);
    await run(["ledger", "poll-github", "--since", "2026-01-05T00:00:00Z"], {
      ...h.deps,
      runner,
    });
    expect(
      runner.calls.some((c) =>
        c.args.join(" ").includes("--created >=2026-01-05"),
      ),
    ).toBe(true);
  });
});
