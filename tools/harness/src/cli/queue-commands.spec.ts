import { describe, expect, it } from "vitest";
import { run } from "./cli.js";
import { DEFAULT, harness } from "./ledger-commands-support.js";
import { ideaText } from "../testing/records-support.js";
import type { FakeResponse } from "../runtime/runner-support.js";

const line = (kind: string, at: string, extra: object) =>
  JSON.stringify({
    schema: 1,
    id: `${kind}-${at}`,
    source: "github",
    kind,
    occurredAt: at,
    recordedAt: at,
    ...extra,
  });

const sendBack = (pr: number, at: string, head = "aaaaaaa") =>
  line("send-back", at, { number: pr, label: `why @${head}` });

function seeded(ledger: string[] = []) {
  const h = harness();
  h.fs.files.set("/repo/docs/ideas", "");
  h.fs.files.set(
    "/repo/docs/ideas/0001-first.md",
    ideaText({ issue: "10" }, "First"),
  );
  h.fs.files.set(
    "/repo/docs/ideas/0002-done.md",
    ideaText({ issue: "11", outcome: "success" }, "Done"),
  );
  h.fs.files.set("/repo/docs/index.md", "# Knowledge Index\n");
  if (ledger.length > 0) {
    h.fs.files.set(DEFAULT, `${ledger.join("\n")}\n`);
  }
  return h;
}

function gh(h: ReturnType<typeof harness>, responses: FakeResponse[]) {
  // Layer our answers over the fake runner's.
  const original = h.runner.run.bind(h.runner);
  h.runner.run = async (command, args, options) => {
    const hit = responses.find((r) => r.match(command, args));
    if (hit === undefined) {
      return await original(command, args, options);
    }
    h.runner.calls.push({ command, args, options });
    return { stdout: "", stderr: "", code: 0, ...hit.result };
  };
}

const ghList = (kind: string, stdout: string): FakeResponse => ({
  match: (c, a) => c === "gh" && a[0] === kind && a[1] === "list",
  result: { stdout },
});
const repoView: FakeResponse = {
  match: (c, a) => c === "gh" && a[0] === "repo",
  result: { stdout: '{"nameWithOwner":"corekraft/kore"}' },
};

describe("harness queue next", () => {
  it("--json lists approved ideas without an outcome and pending send-backs, oldest first", async () => {
    const h = seeded([sendBack(50, "2026-01-03T00:00:00.000Z")]);
    gh(h, [
      repoView,
      ghList(
        "issue",
        JSON.stringify([
          { number: 10, createdAt: "2026-01-05T00:00:00Z" },
          { number: 11, createdAt: "2026-01-01T00:00:00Z" },
        ]),
      ),
      ghList("pr", JSON.stringify([{ number: 50, headRefOid: "aaaaaaa999" }])),
    ]);
    expect(await run(["queue", "next", "--json"], h.deps)).toBe(0);
    expect(JSON.parse(h.out())).toEqual({
      queue: [
        {
          kind: "send-back",
          pr: 50,
          count: 1,
          since: "2026-01-03T00:00:00.000Z",
        },
        {
          kind: "idea",
          idea: "0001",
          issue: 10,
          since: "2026-01-05T00:00:00Z",
        },
      ],
    });
  });

  it("only reads: it records nothing and calls only gh list and view", async () => {
    const h = seeded();
    gh(h, [repoView, ghList("issue", "[]"), ghList("pr", "[]")]);
    expect(await run(["queue", "next"], h.deps)).toBe(0);
    expect(h.out()).toContain("empty");
    expect(h.fs.files.has(DEFAULT)).toBe(false);
    expect(
      h.runner.calls
        .filter((c) => c.command === "gh")
        .every((c) => ["list", "view"].includes(c.args[1] ?? "")),
    ).toBe(true);
  });

  it("fails naming the cause when gh cannot list", async () => {
    const h = seeded();
    gh(h, [
      repoView,
      {
        match: (c, a) => c === "gh" && a[0] === "issue",
        result: { code: 1, stderr: "auth required" },
      },
    ]);
    expect(await run(["queue", "next"], h.deps)).toBe(1);
    expect(h.err()).toContain("auth required");
  });
});

describe("harness queue send-backs", () => {
  it("counts the PR's send-backs exactly and keeps Haiku below two", async () => {
    const h = seeded([
      sendBack(50, "2026-01-01T00:00:00.000Z"),
      sendBack(51, "2026-01-02T00:00:00.000Z"),
    ]);
    h.fs.files.set(
      "/repo/.claude/agents/writer.md",
      "---\nname: writer\nmodel: claude-haiku-5-5\neffort: medium\n---\n",
    );
    expect(await run(["queue", "send-backs", "50", "--json"], h.deps)).toBe(0);
    expect(JSON.parse(h.out())).toEqual({
      pr: 50,
      count: 1,
      model: "claude-haiku-5-5",
      escalate: false,
    });
  });

  it("selects Sonnet at a count of two", async () => {
    const h = seeded([
      sendBack(50, "2026-01-01T00:00:00.000Z"),
      sendBack(50, "2026-01-02T00:00:00.000Z", "bbbbbbb"),
    ]);
    h.fs.files.set(
      "/repo/.claude/agents/writer.md",
      "---\nname: writer\nmodel: claude-haiku-5-5\neffort: medium\n---\n",
    );
    expect(await run(["queue", "send-backs", "50", "--json"], h.deps)).toBe(0);
    expect(JSON.parse(h.out())).toMatchObject({
      count: 2,
      model: "claude-sonnet-5-5",
      escalate: true,
    });
  });

  it("refuses a missing or invalid PR number", async () => {
    const h = seeded();
    expect(await run(["queue", "send-backs", "abc"], h.deps)).toBe(1);
    expect(h.err()).toContain("queue send-backs <pr>");
  });
});

describe("harness queue escalate", () => {
  const twice = [
    sendBack(50, "2026-01-01T00:00:00.000Z"),
    sendBack(50, "2026-01-02T00:00:00.000Z", "bbbbbbb"),
  ];

  it("records an escalation ledger event once the PR was sent back twice", async () => {
    const h = seeded(twice);
    expect(await run(["queue", "escalate", "50"], h.deps)).toBe(0);
    const events = (h.fs.files.get(DEFAULT) ?? "")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(events.at(-1)).toMatchObject({
      kind: "escalation",
      number: 50,
      label: "claude-sonnet-5-5",
    });
  });

  it("records one event per PR however often it is rerun", async () => {
    const h = seeded(twice);
    await run(["queue", "escalate", "50"], h.deps);
    await run(["queue", "escalate", "50"], h.deps);
    const escalations = (h.fs.files.get(DEFAULT) ?? "")
      .split("\n")
      .filter((l) => l.includes('"escalation"'));
    expect(escalations).toHaveLength(1);
  });

  it("refuses and records nothing below two send-backs", async () => {
    const h = seeded([sendBack(50, "2026-01-01T00:00:00.000Z")]);
    expect(await run(["queue", "escalate", "50"], h.deps)).toBe(1);
    expect(h.err()).toContain("sent back 1 time");
    expect(h.fs.files.get(DEFAULT)).not.toContain("escalation");
  });
});
