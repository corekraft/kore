import { describe, expect, it } from "vitest";
import { run, setup } from "./github-signals-support.js";

describe("pollSignals workflow runs", () => {
  it("records main's check conclusions and the nightly's, at the time GitHub concluded them", async () => {
    const t = setup({
      "--workflow check.yml": [
        run(1, "success", "2026-01-05T10:00:00Z"),
        run(2, "failure", "2026-01-05T11:00:00Z"),
      ],
      "--workflow nightly.yml": [run(3, "success", "2026-01-06T03:20:00Z")],
    });
    expect(await t.poll()).toMatchObject({ ok: true, recorded: 3 });
    const events = await t.stored();
    expect(events.map((e) => [e.kind, e.outcome, e.occurredAt])).toEqual([
      ["ci.main", "success", "2026-01-05T10:00:00Z"],
      ["ci.main", "failure", "2026-01-05T11:00:00Z"],
      ["ci.nightly", "success", "2026-01-06T03:20:00Z"],
    ]);
    expect(JSON.stringify(events)).not.toMatch(/secret/);
  });

  it("counts every conclusion but success as a failure: a cancelled or never-started run is not dropped", async () => {
    const t = setup({
      "--workflow check.yml": [
        run(1, "timed_out", "2026-01-05T10:00:00Z"),
        run(2, "cancelled", "2026-01-05T11:00:00Z"),
        run(3, "startup_failure", "2026-01-05T12:00:00Z"),
        run(4, "success", "2026-01-05T13:00:00Z"),
      ],
    });
    await t.poll();
    expect((await t.stored()).map((e) => e.outcome)).toEqual([
      "failure",
      "failure",
      "failure",
      "success",
    ]);
  });

  it("asks for push runs on main and scheduled nightly runs only, so a run an agent dispatches is not counted", async () => {
    const t = setup({});
    await t.poll();
    const check = t.calls.find((c) => c.includes("check.yml"));
    expect(check).toContain("--branch main");
    expect(check).toContain("--event push");
    expect(t.calls.find((c) => c.includes("nightly.yml"))).toContain(
      "--event schedule",
    );
  });
});

describe("pollSignals workflow runs, first attempts and bounds", () => {
  it("records a re-run's first attempt, not the result it was re-run to", async () => {
    const t = setup({
      "--workflow check.yml": [run(7, "success", "2026-01-05T12:00:00Z", 2)],
      "actions/runs/7/attempts/1": () => ({
        stdout: JSON.stringify({
          conclusion: "failure",
          updated_at: "2026-01-05T10:00:00Z",
        }),
      }),
    });
    await t.poll();
    expect(
      (await t.stored()).map((e) => [e.kind, e.outcome, e.occurredAt]),
    ).toEqual([["ci.main", "failure", "2026-01-05T10:00:00Z"]]);
  });

  it("does not look up the attempts of a run it already holds", async () => {
    const t = setup({
      "--workflow check.yml": [run(7, "success", "2026-01-05T12:00:00Z", 2)],
      "actions/runs/7/attempts/1": () => ({
        stdout: JSON.stringify({
          conclusion: "failure",
          updated_at: "2026-01-05T10:00:00Z",
        }),
      }),
    });
    await t.poll();
    await t.poll();
    expect(t.calls.filter((c) => c.includes("attempts/1"))).toHaveLength(1);
  });

  it("appends nothing the second time", async () => {
    const t = setup({
      "--workflow check.yml": [run(1, "success", "2026-01-05T10:00:00Z")],
    });
    await t.poll();
    expect(await t.poll()).toMatchObject({ ok: true, recorded: 0 });
  });

  it("fails loudly on a full page of runs instead of recording part of them", async () => {
    const runs = Array.from({ length: 200 }, (_, i) =>
      run(i + 1, "success", "2026-01-05T10:00:00Z"),
    );
    const t = setup({ "--workflow check.yml": runs });
    const result = await t.poll();
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.message).toMatch(
      /200 check\.yml runs.*--since/,
    );
    expect(await t.stored()).toEqual([]);
  });

  it("bounds the run list by --since, which lets a full history be polled", async () => {
    const t = setup({});
    await t.poll("2026-01-05T10:00:00Z");
    expect(t.calls.find((c) => c.includes("check.yml"))).toContain(
      "--created >=2026-01-05",
    );
  });
});

describe("pollSignals failures", () => {
  it("names the failing gh call and records nothing", async () => {
    const t = setup({}, 1);
    const result = await t.poll();
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.message).toMatch(/gh run list failed/);
    expect(await t.stored()).toEqual([]);
  });

  it("reports a rate limit with the time to retry", async () => {
    const t = setup({
      "run list": () => ({
        code: 1,
        stderr: "HTTP 403: API rate limit exceeded",
      }),
      rate_limit: () => ({
        stdout: JSON.stringify({
          resources: { core: { reset: 1_800_000_000 } },
        }),
      }),
    });
    const result = await t.poll();
    expect(result.ok ? "" : result.message).toMatch(
      /rate limit.*Retry after 2027-01-15T08:00:00.000Z/,
    );
  });
});
