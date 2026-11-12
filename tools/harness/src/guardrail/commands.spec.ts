import { describe, expect, it } from "vitest";
import { run } from "../cli/index.js";
import { testHarness } from "../cli/cli-support.js";
import { INVENTORY_PATH } from "./index.js";
import {
  committedInventory,
  committedInventoryText,
} from "./inventory-support.js";

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
    });
    for (const g of JSON.parse(result.out).guardrails) {
      expect(g).toEqual({
        rule: expect.any(String),
        kind: expect.any(String),
        mode: expect.stringMatching(/^(audit|enforce)$/),
        owner: expect.any(String),
      });
    }
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
