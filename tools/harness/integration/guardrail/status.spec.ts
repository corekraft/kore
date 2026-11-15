// The guardrail status command through the real cli and the real inventory: real units
// together, so an integration spec (moved from the unit specs, not deleted).
import { describe, expect, it } from "vitest";
import { run } from "../../src/cli/index.js";
import { INVENTORY_PATH } from "../../src/guardrail/index.js";
import {
  committedInventory,
  committedInventoryText,
  testHarness,
} from "../../src/testing/index.js";

const status = async (files: Record<string, string>, args: string[] = []) => {
  const h = testHarness({ files });
  const code = await run(["guardrail", "status", ...args], h.deps);
  return { code, out: h.out(), err: h.err() };
};
const inventory = { [`/repo/${INVENTORY_PATH}`]: committedInventoryText };

describe("guardrail status", () => {
  it("lists kind, mode and owner for every guardrail as JSON", async () => {
    const result = await status(inventory, ["--json"]);
    expect(result.code).toBe(0);
    expect(JSON.parse(result.out)).toEqual({
      guardrails: committedInventory.guardrails,
      pending: [],
    });
    for (const g of JSON.parse(result.out).guardrails) {
      expect(g).toEqual({
        rule: expect.any(String),
        kind: expect.any(String),
        mode: expect.stringMatching(/^(audit|enforce)$/),
        owner: expect.any(String),
        ...(g.deny === undefined ? {} : { deny: expect.any(Array) }),
        ...(g.note === undefined ? {} : { note: expect.any(String) }),
      });
    }
  });

  it("lists the guardrails with a pending request, from the ledger, and drops one once its mode is applied", async () => {
    const event = JSON.stringify({
      schema: 1,
      id: "e1",
      source: "claude",
      kind: "guardrail.requested",
      occurredAt: "2026-01-02T03:04:05.000Z",
      recordedAt: "2026-01-02T03:04:05.000Z",
      idea: "0223",
      label: "bare-glob:audit>enforce",
    });
    const ledger = { "/repo/ledger.jsonl": `${event}\n` };
    const args = ["--json", "--ledger", "/repo/ledger.jsonl"];
    const waiting = await status({ ...inventory, ...ledger }, args);
    expect(JSON.parse(waiting.out).pending).toEqual([
      { rule: "bare-glob", from: "audit", to: "enforce", idea: "0223" },
    ]);
    const applied = await status(
      {
        [`/repo/${INVENTORY_PATH}`]: committedInventoryText.replace(
          /("rule": "bare-glob", "kind": "bash", "mode": )"audit"/,
          '$1"enforce"',
        ),
        ...ledger,
      },
      args,
    );
    expect(JSON.parse(applied.out).pending).toEqual([]);
  });

  it("prints one tab-separated line per guardrail without --json", async () => {
    const result = await status(inventory);
    expect(result.out.trim().split("\n")).toHaveLength(
      committedInventory.guardrails.length,
    );
    expect(result.out).toMatch(/^secret-path\tbash-and-file\tenforce\t/m);
  });

  it("changes nothing: it only reads", async () => {
    const h = testHarness({ files: inventory });
    await run(["guardrail", "status"], h.deps);
    expect([...h.files.keys()]).toEqual([`/repo/${INVENTORY_PATH}`]);
  });

  it("exits 1 with the fix when the inventory is missing or invalid", async () => {
    const missing = await status({}, ["--json"]);
    expect(missing.code).toBe(1);
    expect(missing.out).toBe("");
    expect(missing.err).toMatch(/guardrails\.yaml is missing.*Restore it/s);
    const bad = await status({ [`/repo/${INVENTORY_PATH}`]: "{" });
    expect(bad).toMatchObject({ code: 1, out: "" });
    expect(bad.err).toMatch(/JSON-compatible.*Fix the inventory/);
  });
});
