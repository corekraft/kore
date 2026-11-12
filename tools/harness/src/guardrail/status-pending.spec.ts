// `harness guardrail status` lists the guardrails waiting for a person's approval.
// Plan: infra/plans/12-self-improving-loop.md (Step 4).
import { describe, expect, it } from "vitest";
import { run } from "../cli/index.js";
import { LEDGER, type Harness } from "../outcome/outcome-support.js";
import { INVENTORY_PATH } from "./index.js";
import { INVENTORY, ready, request } from "./request-support.js";

interface Row {
  rule: string;
  pending?: { to: string; idea: string; requestedAt: string };
}

async function status(h: Harness): Promise<Row[]> {
  const out: string[] = [];
  h.deps.stdout = (text) => out.push(text);
  await run(["guardrail", "status", "--json", "--ledger", LEDGER], h.deps);
  return (JSON.parse(out.join("")) as { guardrails: Row[] }).guardrails;
}

describe("guardrail status waiting for approval", () => {
  it("lists a guardrail with a pending request and leaves the others alone", async () => {
    const { h } = await ready();
    await request(h, "image-digest", "enforce");
    expect((await status(h)).filter((g) => g.pending !== undefined)).toEqual([
      expect.objectContaining({
        rule: "image-digest",
        pending: {
          to: "enforce",
          idea: "0001",
          requestedAt: "2026-03-04T05:06:07.000Z",
        },
      }),
    ]);
  });

  it("lists loosening requests too", async () => {
    const { h } = await ready();
    await request(h, "enforced-rule", "audit");
    const rows = await status(h);
    expect(rows.find((g) => g.rule === "enforced-rule")?.pending).toMatchObject(
      { to: "audit" },
    );
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
    expect((await status(h)).every((g) => g.pending === undefined)).toBe(true);
  });

  it("shows no pending field when nothing was requested, even without a ledger", async () => {
    const { h } = await ready();
    expect((await status(h)).every((g) => !("pending" in g))).toBe(true);
  });
});
