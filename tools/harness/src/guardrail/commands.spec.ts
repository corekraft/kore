// The guardrail commands unit: `status` and `deny`, run with fake deps. The deny
// and read units are same-domain collaborators, so they are automocks; GuardrailError
// and the inventory path are real. Real files and the real cli are integration
// tests (integration/guardrail).
// Docs: infra/plans/14-test-tiers.md#step-1-foundations

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Command } from "../runtime/index.js";
import { guardrailCommands } from "./commands.js";
import { denyDrift, denyList, settingsDeny, settingsWithDeny } from "./deny.js";
import { GuardrailError, INVENTORY_PATH, type Inventory } from "./inventory.js";
import { readInventory } from "./read.js";
import { fakeDeps } from "./guardrail-support.js";

vi.mock("./deny.js");
vi.mock("./read.js");

const SETTINGS = "/repo/.claude/settings.json";
const INVENTORY: Inventory = {
  guardrails: [
    {
      rule: "no-verify",
      kind: "bash",
      mode: "enforce",
      owner: "tools/harness/src/hook/guard-commands.ts",
    },
  ],
};
const ENOENT = Object.assign(new Error("ENOENT"), { code: "ENOENT" });

function command(name: string): Command {
  const found = guardrailCommands[name];
  if (found === undefined) {
    throw new Error(`no ${name} command`);
  }
  return found;
}

/** A command with fresh fake deps, and a `run` that invokes it with the given flags. */
function invoke(
  name: string,
  options: Record<string, string | boolean> = {},
  json = false,
) {
  const fake = fakeDeps();
  const run = () => command(name).run({ json, options, deps: fake.deps });
  return { ...fake, run };
}

beforeEach(() => {
  vi.mocked(readInventory).mockImplementation(async (read) => {
    await read(`/repo/${INVENTORY_PATH}`);
    return INVENTORY;
  });
});

describe("guardrail status", () => {
  it("reads the inventory under the repository root through the file system", async () => {
    const { run, readFile } = invoke("status");
    await run();
    expect(vi.mocked(readInventory).mock.calls).toEqual([
      [expect.any(Function), "/repo"],
    ]);
    expect(readFile.mock.calls).toEqual([[`/repo/${INVENTORY_PATH}`]]);
  });

  it("prints one tab-separated line per guardrail, and exits 0", async () => {
    const { run, stdout, stderr } = invoke("status");
    expect(await run()).toBe(0);
    expect(stdout.mock.calls).toEqual([
      ["no-verify\tbash\tenforce\ttools/harness/src/hook/guard-commands.ts\n"],
    ]);
    expect(stderr.mock.calls).toEqual([]);
  });

  it("prints the inventory as JSON with --json", async () => {
    const { run, stdout } = invoke("status", {}, true);
    await run();
    expect(stdout.mock.calls).toEqual([
      [`${JSON.stringify({ guardrails: INVENTORY.guardrails })}\n`],
    ]);
  });

  it("exits 1 and prints the message to stderr when the inventory is invalid", async () => {
    vi.mocked(readInventory).mockRejectedValue(new GuardrailError("bad"));
    const { run, stdout, stderr } = invoke("status");
    expect(await run()).toBe(1);
    expect(stdout.mock.calls).toEqual([]);
    expect(stderr.mock.calls).toEqual([["bad\n"]]);
  });

  it("puts the error in JSON on stderr with --json, followed by the message, and leaves stdout empty", async () => {
    vi.mocked(readInventory).mockRejectedValue(new GuardrailError("bad"));
    const { run, stdout, stderr } = invoke("status", {}, true);
    expect(await run()).toBe(1);
    expect(stdout.mock.calls).toEqual([]);
    expect(stderr.mock.calls).toEqual([['{"error":"bad"}\nbad\n']]);
  });

  it("rethrows an error that is not a guardrail error", async () => {
    const error = new Error("disk");
    vi.mocked(readInventory).mockRejectedValue(error);
    await expect(invoke("status").run()).rejects.toBe(error);
  });
});

describe("guardrail deny: reading the list", () => {
  it("prints the generated list, one rule per line, and exits 0", async () => {
    vi.mocked(denyList).mockReturnValue(["Bash(a:*)", "Bash(b:*)"]);
    const { run, stdout } = invoke("deny");
    expect(await run()).toBe(0);
    expect(vi.mocked(denyList).mock.calls).toEqual([[INVENTORY]]);
    expect(stdout.mock.calls).toEqual([["Bash(a:*)\nBash(b:*)\n"]]);
  });

  it("prints the generated list as JSON with --json", async () => {
    vi.mocked(denyList).mockReturnValue(["Bash(a:*)"]);
    const { run, stdout } = invoke("deny", {}, true);
    await run();
    expect(stdout.mock.calls).toEqual([['{"deny":["Bash(a:*)"]}\n']]);
  });

  it("never reads or writes settings unless asked", async () => {
    vi.mocked(denyList).mockReturnValue([]);
    const { run, readFile, writeFile } = invoke("deny");
    await run();
    expect(readFile.mock.calls).toEqual([[`/repo/${INVENTORY_PATH}`]]);
    expect(writeFile.mock.calls).toEqual([]);
  });
});

describe("guardrail deny --check", () => {
  it("passes silently when the settings match, exiting 0", async () => {
    vi.mocked(denyDrift).mockReturnValue([]);
    const { run, readFile, stdout, stderr } = invoke("deny", { check: true });
    readFile.mockResolvedValue("SETTINGS");
    expect(await run()).toBe(0);
    expect(vi.mocked(denyDrift).mock.calls).toEqual([[INVENTORY, "SETTINGS"]]);
    expect(stdout.mock.calls).toEqual([]);
    expect(stderr.mock.calls).toEqual([]);
  });

  it("fails with the problems and the fix on stderr, exiting 1", async () => {
    vi.mocked(denyDrift).mockReturnValue(["Bash(h:*) is missing"]);
    const { run, readFile, stderr } = invoke("deny", { check: true });
    readFile.mockResolvedValue("SETTINGS");
    expect(await run()).toBe(1);
    expect(stderr.mock.calls).toEqual([
      [
        `.claude/settings.json: Bash(h:*) is missing. The inventory owns the deny list. ` +
          `Instead of editing settings, change ${INVENTORY_PATH}, then run \`guardrail deny --write\`.\n`,
      ],
    ]);
  });

  it("puts the problems in JSON on stdout with --json", async () => {
    vi.mocked(denyDrift).mockReturnValue(["p"]);
    const { run, readFile, stdout } = invoke("deny", { check: true }, true);
    readFile.mockResolvedValue("SETTINGS");
    await run();
    expect(stdout.mock.calls).toEqual([['{"problems":["p"]}\n']]);
  });

  it("names a missing settings file and exits 1", async () => {
    const { run, readFile, stderr } = invoke("deny", { check: true });
    readFile.mockImplementation((path) =>
      path === SETTINGS ? Promise.reject(ENOENT) : Promise.resolve("{}"),
    );
    expect(await run()).toBe(1);
    expect(stderr.mock.calls).toEqual([
      [".claude/settings.json is missing. Restore it from git, then rerun.\n"],
    ]);
  });

  it("refuses --check and --write together before reading anything", async () => {
    const { run, root, stderr } = invoke("deny", { check: true, write: true });
    expect(await run()).toBe(1);
    expect(stderr.mock.calls).toEqual([
      [
        "--check and --write cannot be used together. Instead, run one, then the other.\n",
      ],
    ]);
    expect(root).not.toHaveBeenCalled();
  });
});

describe("guardrail deny --write", () => {
  it("writes the generated list when settings would only gain patterns", async () => {
    vi.mocked(denyList).mockReturnValue(["Bash(a:*)"]);
    vi.mocked(settingsDeny).mockReturnValue([]);
    vi.mocked(settingsWithDeny).mockReturnValue("NEXT");
    const { run, readFile, writeFile, stderr } = invoke("deny", {
      write: true,
    });
    readFile.mockResolvedValue("SETTINGS");
    expect(await run()).toBe(0);
    expect(vi.mocked(settingsWithDeny).mock.calls).toEqual([
      ["SETTINGS", ["Bash(a:*)"]],
    ]);
    expect(writeFile.mock.calls).toEqual([[SETTINGS, "NEXT"]]);
    expect(stderr.mock.calls).toEqual([]);
  });

  it("refuses to remove a pattern without --allow-removal, naming it and writing nothing", async () => {
    vi.mocked(denyList).mockReturnValue(["Bash(a:*)"]);
    vi.mocked(settingsDeny).mockReturnValue(["Bash(hand:*)"]);
    const { run, writeFile, stderr } = invoke("deny", { write: true });
    expect(await run()).toBe(1);
    expect(stderr.mock.calls).toEqual([
      [
        ".claude/settings.json: these patterns would leave the deny list: Bash(hand:*).\n",
      ],
      [
        "Removing a deny rule weakens the guard. Instead, restore the rule in the inventory, " +
          "or rerun with --allow-removal once the user has approved it.\n",
      ],
    ]);
    expect(writeFile.mock.calls).toEqual([]);
  });

  it("removes the pattern with --allow-removal, still naming it, and writes", async () => {
    vi.mocked(denyList).mockReturnValue(["Bash(a:*)"]);
    vi.mocked(settingsDeny).mockReturnValue(["Bash(hand:*)"]);
    vi.mocked(settingsWithDeny).mockReturnValue("NEXT");
    const { run, writeFile, stderr } = invoke("deny", {
      write: true,
      "allow-removal": true,
    });
    expect(await run()).toBe(0);
    expect(stderr.mock.calls).toEqual([
      [
        ".claude/settings.json: these patterns would leave the deny list: Bash(hand:*).\n",
      ],
    ]);
    expect(writeFile.mock.calls).toEqual([[SETTINGS, "NEXT"]]);
  });

  it("rethrows an error that is not a guardrail or missing-file error", async () => {
    const error = new Error("disk");
    const { run, readFile } = invoke("deny", { write: true });
    readFile.mockImplementation((path) =>
      path === SETTINGS ? Promise.reject(error) : Promise.resolve("{}"),
    );
    vi.mocked(denyList).mockReturnValue([]);
    await expect(run()).rejects.toBe(error);
  });
});
