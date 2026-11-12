import { describe, expect, it } from "vitest";
import { run } from "../cli/index.js";
import { testHarness } from "../cli/cli-support.js";
import { INVENTORY_PATH } from "./index.js";
import { denyList } from "./deny.js";
import {
  committedInventory,
  committedInventoryText,
} from "../testing/guardrail-support.js";

const SETTINGS = "/repo/.claude/settings.json";
const settings = (deny: string[]) =>
  JSON.stringify({ permissions: { allow: ["Bash(ls)"], deny } }, null, 2);

const deny = async (
  deny_: string[] | undefined,
  args: string[] = [],
  inventory: string | null = committedInventoryText,
) => {
  const h = testHarness({
    files: {
      ...(inventory === null ? {} : { [`/repo/${INVENTORY_PATH}`]: inventory }),
      ...(deny_ === undefined ? {} : { [SETTINGS]: settings(deny_) }),
    },
  });
  const code = await run(["guardrail", "deny", ...args], h.deps);
  return { code, out: h.out(), err: h.err(), files: h.files };
};
const generated = denyList(committedInventory);

describe("guardrail deny", () => {
  it("prints the generated deny list, one rule per line, and as JSON", async () => {
    const text = await deny(generated);
    expect(text.code).toBe(0);
    expect(text.out.trim().split("\n")).toEqual(generated);
    const json = await deny(generated, ["--json"]);
    expect(JSON.parse(json.out)).toEqual({ deny: generated });
  });

  it("never changes settings unless asked", async () => {
    const result = await deny(["Bash(hand:*)"]);
    expect(result.files.get(SETTINGS)).toBe(settings(["Bash(hand:*)"]));
  });
});

describe("guardrail deny --check", () => {
  it("passes when settings hold exactly the generated list", async () => {
    const result = await deny(generated, ["--check"]);
    expect(result.code).toBe(0);
    expect(result.err).toBe("");
  });

  it("fails on a hand edit, names it, and says how to fix it", async () => {
    const result = await deny([...generated, "Bash(hand:*)"], ["--check"]);
    expect(result.code).toBe(1);
    expect(result.err).toMatch(/Bash\(hand:\*\)/);
    expect(result.err).toMatch(/guardrails\.yaml/);
    expect(result.err).toMatch(/guardrail deny --write/);
  });

  it("fails as JSON with the problems listed", async () => {
    const result = await deny([], ["--check", "--json"]);
    expect(result.code).toBe(1);
    expect(JSON.parse(result.out).problems.length).toBeGreaterThan(0);
  });

  it("names a missing settings file", async () => {
    const result = await deny(undefined, ["--check"]);
    expect(result.code).toBe(1);
    expect(result.err).toMatch(/settings\.json/);
  });

  it("names a missing inventory", async () => {
    const result = await deny(generated, ["--check"], null);
    expect(result.code).toBe(1);
    expect(result.err).toMatch(/guardrails\.yaml is missing/);
  });
});

describe("guardrail deny --write", () => {
  it("regenerates the list in settings and keeps every other key", async () => {
    const result = await deny(["Bash(hand:*)"], ["--write"]);
    expect(result.code).toBe(0);
    expect(JSON.parse(result.files.get(SETTINGS) ?? "")).toEqual({
      permissions: { allow: ["Bash(ls)"], deny: generated },
    });
  });

  it("refuses --check and --write together", async () => {
    const result = await deny(generated, ["--check", "--write"]);
    expect(result.code).toBe(1);
    expect(result.err).toMatch(/--check.*--write/);
  });

  it("names malformed settings instead of crashing", async () => {
    const h = testHarness({
      files: {
        [`/repo/${INVENTORY_PATH}`]: committedInventoryText,
        [SETTINGS]: "{ not json",
      },
    });
    const code = await run(["guardrail", "deny", "--write"], h.deps);
    expect(code).toBe(1);
    expect(h.err()).toMatch(/settings\.json is not JSON/);
    expect(h.files.get(SETTINGS)).toBe("{ not json");
  });
});
