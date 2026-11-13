// `harness guardrail status` and `harness status` list the guardrail changes
// waiting for a person's approval, resolved against the inventory's git history.
// Plan: infra/plans/12-self-improving-loop.md (Step 4).
import { describe, expect, it } from "vitest";
import { run } from "../cli/index.js";
import { LEDGER, type Harness } from "../outcome/outcome-support.js";
import { inventoryOf } from "./history-support.js";
import { INVENTORY_PATH } from "./index.js";
import {
  INVENTORY,
  ledgerEvents,
  ready,
  request,
  withGit,
} from "./request-support.js";

interface Row {
  rule: string;
  pending?: { id: string; to: string; idea: string; requestedAt: string };
}

async function output(h: Harness, argv: string[]): Promise<string> {
  const out: string[] = [];
  h.deps.stdout = (text) => out.push(text);
  await run(argv, h.deps);
  return out.join("");
}

async function status(h: Harness): Promise<Row[]> {
  const text = await output(h, [
    "guardrail",
    "status",
    "--json",
    "--ledger",
    LEDGER,
  ]);
  return (JSON.parse(text) as { guardrails: Row[] }).guardrails;
}

const waiting = async (h: Harness) =>
  (await status(h)).filter((g) => g.pending !== undefined);

/** A commit after the request time (2026-03-04T05:06:07Z) holding a rule's mode. */
const later = (sha: string, mode: string) => ({
  sha,
  date: "2026-03-05T00:00:00Z",
  text: inventoryOf({ "image-digest": mode }),
});

describe("guardrail status waiting for approval", () => {
  it("lists a guardrail with a pending request and leaves the others alone", async () => {
    const { h } = await ready();
    await request(h, "image-digest", "enforce");
    expect(await waiting(h)).toEqual([
      expect.objectContaining({
        rule: "image-digest",
        pending: {
          id: "req-1",
          to: "enforce",
          idea: "0001",
          requestedAt: "2026-03-04T05:06:07.000Z",
        },
      }),
    ]);
  });

  it("lists loosening requests too", async () => {
    const { h } = await ready();
    await request(h, "kubectl-context", "audit");
    expect((await waiting(h)).map((g) => [g.rule, g.pending?.to])).toEqual([
      ["kubectl-context", "audit"],
    ]);
  });

  it("stops listing a request once the inventory holds the requested mode", async () => {
    const { h } = await ready();
    await request(h, "image-digest", "enforce");
    h.set(
      INVENTORY_PATH,
      INVENTORY.replace(
        '"rule":"image-digest","kind":"bash","mode":"audit"',
        '"rule":"image-digest","kind":"bash","mode":"enforce"',
      ),
    );
    expect(await waiting(h)).toEqual([]);
  });

  it("shows no pending field when nothing was requested, even without a ledger", async () => {
    const { h } = await ready();
    expect((await status(h)).every((g) => !("pending" in g))).toBe(true);
  });

  it("says why requests are not shown when no ledger can be found", async () => {
    const { h } = await ready();
    h.deps.root = () => Promise.resolve("/repo");
    const errors: string[] = [];
    h.deps.stderr = (t) => errors.push(t);
    await output(h, ["guardrail", "status", "--json"]);
    expect(errors.join("")).toBe("");
    const { runner } = h;
    runner.run = () =>
      Promise.resolve({ stdout: "", stderr: "fatal", code: 128 });
    await output(h, ["guardrail", "status", "--json"]);
    expect(errors.join("")).toMatch(/No shared ledger.*KORE_ROOT.*--ledger/s);
  });
});

describe("a request resolved by the inventory's history", () => {
  it("is not pending once a commit after it held the target, even though the rule was reverted", async () => {
    const { h } = await ready();
    await request(h, "image-digest", "enforce");
    withGit(h, [later("c2", "enforce")]);
    expect(await waiting(h)).toEqual([]);
  });

  it("stays pending when the only commit with the target came before the request", async () => {
    const { h } = await ready();
    await request(h, "image-digest", "enforce");
    withGit(h, [
      {
        sha: "c0",
        date: "2026-03-01T00:00:00Z",
        text: inventoryOf({ "image-digest": "enforce" }),
      },
    ]);
    expect((await waiting(h)).map((g) => g.rule)).toEqual(["image-digest"]);
  });

  it("makes a request after a revert a new request, with fresh evidence in a new comment", async () => {
    const { h, issue } = await ready();
    await request(h, "image-digest", "enforce");
    withGit(h, [later("c2", "enforce")]);
    // The second request comes after the commit that approved the first.
    h.deps.clock = {
      now: () => new Date("2026-03-06T00:00:00.000Z"),
      sleep: () => Promise.resolve(),
    };
    expect(await request(h, "image-digest", "enforce")).toBe(0);
    expect(issue.comments).toHaveLength(2);
    expect(issue.comments[0]).toContain("<!-- guardrail-request: req-1 -->");
    expect(issue.comments[1]).toContain("<!-- guardrail-request: req-2 -->");
    expect(ledgerEvents(h).map((e) => e["id"])).toEqual(["req-1", "req-2"]);
    expect((await waiting(h)).map((g) => g.pending?.id)).toEqual(["req-2"]);
  });

  it("makes a second request for another mode its own request", async () => {
    const { h, issue } = await ready();
    await request(h, "kubectl-context", "audit");
    expect(await request(h, "kubectl-context", "remove")).toBe(0);
    expect(issue.comments).toHaveLength(2);
    expect((await waiting(h)).map((g) => g.pending?.to)).toEqual(["remove"]);
  });
});

describe("harness status waiting for approval", () => {
  it("lists the waiting requests where the concierge already looks", async () => {
    const { h } = await ready();
    await request(h, "image-digest", "enforce");
    const parsed = JSON.parse(await output(h, ["status", "--json"])) as {
      guardrails: { waiting: unknown[] };
    };
    expect(parsed.guardrails).toEqual({
      waiting: [
        {
          rule: "image-digest",
          to: "enforce",
          idea: "0001",
          requestedAt: "2026-03-04T05:06:07.000Z",
        },
      ],
    });
  });

  it("lists none, and says so in words, when nothing waits", async () => {
    const { h } = await ready();
    const parsed = JSON.parse(await output(h, ["status", "--json"])) as {
      guardrails: unknown;
    };
    expect(parsed.guardrails).toEqual({ waiting: [] });
  });

  it("reports an unreadable inventory instead of failing the whole status", async () => {
    const { h } = await ready();
    h.set(INVENTORY_PATH, "{");
    const parsed = JSON.parse(await output(h, ["status", "--json"])) as {
      guardrails: { waiting: unknown[]; error: string };
    };
    expect(parsed.guardrails.waiting).toEqual([]);
    expect(parsed.guardrails.error).toMatch(/JSON-compatible/);
  });

  it("prints a waiting line in the text form", async () => {
    const { h } = await ready();
    await request(h, "image-digest", "enforce");
    expect(await output(h, ["status"])).toMatch(
      /Waiting for approval: image-digest to enforce \(idea 0001/,
    );
  });
});
