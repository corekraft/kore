import { describe, expect, it } from "vitest";
import { run } from "../../src/cli/index.js";
import type { CliDeps } from "../../src/runtime/index.js";

// The real command table and the real renderers. A help request needs no root, file,
// process or clock, so each of those throws if a dispatch touches it.
function untouched(what: string): never {
  throw new Error(`a help request touched ${what}`);
}

function helpDeps() {
  const out: string[] = [];
  const err: string[] = [];
  const deps = {
    root: () => untouched("the repository root"),
    runner: { run: () => untouched("the runner") },
    clock: {
      now: () => untouched("the clock"),
      sleep: () => untouched("the clock"),
    },
    fs: {},
    stdout: (text: string) => {
      out.push(text);
    },
    stderr: (text: string) => {
      err.push(text);
    },
  } as unknown as CliDeps;
  return { deps, out: () => out.join(""), err: () => err.join("") };
}

describe("harness help on the real command table", () => {
  it("prints the root guide for --help: the domains, the flows and how to go deeper, exit 0", async () => {
    const h = helpDeps();
    expect(await run(["--help"], h.deps)).toBe(0);
    expect(h.err()).toBe("");
    expect(h.out()).toContain("Domains:");
    expect(h.out()).toContain("harness session spawn");
    expect(h.out()).toContain("Going deeper:");
  });

  it("prints a domain's guide for <domain> --help, listing its commands", async () => {
    const h = helpDeps();
    expect(await run(["harness", "--help"], h.deps)).toBe(0);
    expect(h.out()).toContain("harness harness version");
    expect(h.out()).toContain("harness harness wait");
  });

  it("prints a command's guide for <domain> <command> --help, with its exit codes and effects", async () => {
    const h = helpDeps();
    expect(await run(["harness", "wait", "--help"], h.deps)).toBe(0);
    expect(h.err()).toBe("");
    expect(h.out()).toContain(
      "Usage:\n  harness harness wait [--timeout <value>] [--pr <value>] [--session <value>] [--idea <value>] [--any-idea]",
    );
    expect(h.out()).toContain("3  the bound passed with nothing settled");
    expect(h.out()).toContain("Effects:\n  mutates: ");
  });

  it.each([["new"], ["list"], ["show"], ["sync"]])(
    "wires the idea %s help record into its command, so its --help prints the effects",
    async (name) => {
      const h = helpDeps();
      expect(await run(["idea", name, "--help"], h.deps)).toBe(0);
      expect(h.out()).toContain("Effects:\n  ");
      expect(h.out()).toContain("Exit codes:");
    },
  );

  it("prints the same command as one JSON object under --help --json", async () => {
    const h = helpDeps();
    expect(await run(["harness", "wait", "--help", "--json"], h.deps)).toBe(0);
    expect(JSON.parse(h.out())).toMatchObject({
      level: "command",
      path: "harness wait",
      effects: { kind: "mutates" },
    });
  });

  it("prints the root guide after an unknown domain, with exit 2 and nothing on stdout", async () => {
    const h = helpDeps();
    expect(await run(["nope"], h.deps)).toBe(2);
    expect(h.out()).toBe("");
    expect(h.err()).toContain('Unknown domain "nope".');
    expect(h.err()).toContain("Domains:");
  });

  it("keeps a hook's usage error at exit 1, with the domain's guide", async () => {
    const h = helpDeps();
    expect(await run(["hook", "nope"], h.deps)).toBe(1);
    expect(h.err()).toContain("Commands:");
  });
});
