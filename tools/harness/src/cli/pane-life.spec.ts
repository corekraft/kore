import { describe, expect, it } from "vitest";
import { FakeRunner } from "../runtime/runner-support.js";
import { run } from "./cli.js";
import { harness } from "./ledger-commands-support.js";

const PANE = "w3:p74";
const SESSION = "sess-1";
const AGENT = "pane-life-writer";

const agents = (status?: string) =>
  JSON.stringify({
    result: {
      agents:
        status === undefined
          ? []
          : [{ pane_id: PANE, agent_status: status, name: AGENT }],
    },
  });

/** One spawned pane, run through the real record, poll and list commands against fixtures. */
function scenario() {
  const h = harness("", { env: { KORE_ROOT: "/repo" } });
  const answer = { stdout: agents(), code: 0 };
  const runner = new FakeRunner([
    { match: (c) => c === "herdr", result: answer },
  ]);
  let tick = 0;
  const clock = {
    now: () => new Date(Date.UTC(2026, 0, 2, 3, 0, tick++)),
    sleep: () => Promise.resolve(),
  };
  const deps = { ...h.deps, runner, clock };
  const at = (n: number) => `2026-01-02T03:00:${String(n).padStart(2, "0")}Z`;
  const record = (kind: string, n: number, extra: string[] = []) =>
    run(
      [
        "ledger",
        "record",
        "--source",
        "claude",
        "--kind",
        kind,
        "--occurred-at",
        at(n),
        "--session",
        SESSION,
        "--pane",
        PANE,
        ...extra,
      ],
      deps,
    );
  const poll = async (status?: string) => {
    answer.stdout = agents(status);
    return run(["ledger", "poll-herdr"], deps);
  };
  return { h, deps, record, poll };
}

type Listed = {
  kind: string;
  occurredAt: string;
  session?: string;
  pane?: string;
};

async function listPane(s: ReturnType<typeof scenario>): Promise<Listed[]> {
  const out: string[] = [];
  const deps = { ...s.deps, stdout: (t: string) => out.push(t) };
  await run(["ledger", "list", "--pane", PANE, "--json"], deps);
  return (JSON.parse(out.join("")) as { events: Listed[] }).events;
}

describe("a spawned pane's whole life", () => {
  it("is rebuilt in order from the ledger, joined by session and pane id", async () => {
    const s = scenario();
    expect(await s.poll("working")).toBe(0);
    expect(await s.record("session.start", 10)).toBe(0);
    expect(await s.record("tool.start", 11, ["--tool", "Bash"])).toBe(0);
    expect(
      await s.record("tool.end", 12, [
        "--tool",
        "Bash",
        "--outcome",
        "success",
      ]),
    ).toBe(0);
    expect(await s.record("session.stop", 13)).toBe(0);
    expect(await s.poll("idle")).toBe(0);
    expect(await s.poll()).toBe(0);

    const events = await listPane(s);

    const claude = events.filter((e) => e.session === SESSION);
    expect(claude.map((e) => e.kind)).toEqual([
      "session.start",
      "tool.start",
      "tool.end",
      "session.stop",
    ]);
    expect(
      events.filter((e) => e.kind.startsWith("pane.")).map((e) => e.kind),
    ).toEqual(["pane.spawned", "pane.busy", "pane.waiting", "pane.closed"]);

    // Every event is timestamped, and the claude events keep their order in time.
    expect(events.every((e) => !Number.isNaN(Date.parse(e.occurredAt)))).toBe(
      true,
    );
    const times = claude.map((e) => Date.parse(e.occurredAt));
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  it("leaves the start, tool sequence, wait and close that the exit criterion names", async () => {
    const s = scenario();
    await s.poll("working");
    await s.record("session.start", 10);
    await s.record("tool.start", 11, ["--tool", "Edit"]);
    await s.record("tool.end", 12, ["--tool", "Edit", "--outcome", "success"]);
    await s.poll("idle");
    await s.poll();
    const out: string[] = [];
    await run(["ledger", "list", "--pane", PANE], {
      ...s.deps,
      stdout: (t) => out.push(t),
    });
    const lines = out.join("").trimEnd().split("\n");
    for (const kind of [
      "session.start",
      "tool.start",
      "tool.end",
      "pane.waiting",
      "pane.closed",
    ]) {
      expect(lines.some((l) => l.includes(` ${kind} `))).toBe(true);
    }
    expect(lines.every((l) => l.includes(PANE))).toBe(true);
  });
});

describe("a pane's life among other panes", () => {
  it("keeps another pane's events out of this pane's life", async () => {
    const s = scenario();
    await s.poll("working");
    await run(
      [
        "ledger",
        "record",
        "--source",
        "claude",
        "--kind",
        "session.start",
        "--occurred-at",
        "2026-01-02T03:00:10Z",
        "--session",
        "other",
        "--pane",
        "w3:p99",
      ],
      s.deps,
    );
    const events = await listPane(s);
    expect(events.every((e) => e.pane === PANE)).toBe(true);
    expect(events.some((e) => e.session === "other")).toBe(false);
  });
});
