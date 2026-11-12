import { describe, expect, it } from "vitest";
import { FakeRunner } from "../runtime/runner-support.js";
import { run, type CliDeps } from "./cli.js";

function harness() {
  const out: string[] = [];
  const err: string[] = [];
  const deps: CliDeps = {
    runner: new FakeRunner(),
    clock: { now: () => new Date("2026-01-02T03:04:05.000Z") },
    fs: {
      readFile: () => Promise.resolve(""),
      writeFile: () => Promise.resolve(),
      exists: () => Promise.resolve(false),
      readdir: () => Promise.resolve([]),
    },
    stdout: (text) => out.push(text),
    stderr: (text) => err.push(text),
  };
  return { deps, out: () => out.join(""), err: () => err.join("") };
}

describe("harness dispatch", () => {
  it.each([[["--help"]], [["-h"]], [[]]])(
    "lists domains and commands for %j and exits 0",
    async (argv) => {
      const h = harness();
      expect(await run(argv, h.deps)).toBe(0);
      expect(h.out()).toContain("Usage: harness <domain> <command> [--json]");
      expect(h.out()).toContain("harness version");
      expect(h.err()).toBe("");
    },
  );

  it("rejects an unknown domain, names it, and shows usage", async () => {
    const h = harness();
    expect(await run(["nope", "x"], h.deps)).toBe(2);
    expect(h.err()).toContain('Unknown domain "nope"');
    expect(h.err()).toContain("Usage: harness");
    expect(h.out()).toBe("");
  });

  it("rejects an unknown command, names it, and lists the domain's commands", async () => {
    const h = harness();
    expect(await run(["harness", "nope"], h.deps)).toBe(2);
    expect(h.err()).toContain('Unknown command "nope" for domain "harness"');
    expect(h.err()).toContain("version");
  });

  it("rejects a domain without a command", async () => {
    const h = harness();
    expect(await run(["harness"], h.deps)).toBe(2);
    expect(h.err()).toContain('Missing command for domain "harness"');
  });

  it("rejects an unknown flag and runs nothing", async () => {
    const h = harness();
    expect(await run(["harness", "version", "--bogus"], h.deps)).toBe(2);
    expect(h.err()).toContain('Unknown flag "--bogus"');
    expect(h.err()).toContain("Usage: harness");
    expect(h.out()).toBe("");
  });

  it("shows a domain's commands for `<domain> --help`", async () => {
    const h = harness();
    expect(await run(["harness", "--help"], h.deps)).toBe(0);
    expect(h.out()).toContain("version");
  });

  it("prints human text by default and JSON with --json", async () => {
    const text = harness();
    expect(await run(["harness", "version"], text.deps)).toBe(0);
    expect(text.out()).toMatch(/^harness \d+\.\d+\.\d+\n$/);

    const json = harness();
    expect(await run(["harness", "version", "--json"], json.deps)).toBe(0);
    expect(JSON.parse(json.out())).toEqual({
      version: expect.stringMatching(/^\d+\.\d+\.\d+$/) as unknown,
    });
  });

  it("accepts --json before the command", async () => {
    const h = harness();
    expect(await run(["--json", "harness", "version"], h.deps)).toBe(0);
    expect(JSON.parse(h.out())).toHaveProperty("version");
  });
});

describe("harness dispatch hardening", () => {
  it.each([
    [["constructor", "version"], 'Unknown domain "constructor"'],
    [["harness", "constructor"], 'Unknown command "constructor"'],
    [["__proto__", "x"], 'Unknown domain "__proto__"'],
  ])(
    "treats inherited object keys %j as unknown, not a crash",
    async (argv, message) => {
      const h = harness();
      expect(await run(argv, h.deps)).toBe(2);
      expect(h.err()).toContain(message);
    },
  );

  it("rejects extra words after the command and runs nothing", async () => {
    const h = harness();
    expect(await run(["harness", "version", "extra"], h.deps)).toBe(2);
    expect(h.err()).toContain('Unexpected argument "extra"');
    expect(h.err()).toContain("Usage: harness");
    expect(h.out()).toBe("");
  });

  it("under --json, usage errors also print an error object on stderr", async () => {
    const h = harness();
    expect(await run(["nope", "--json"], h.deps)).toBe(2);
    const line = h.err().split("\n")[0] ?? "";
    expect(JSON.parse(line)).toEqual({
      error: 'Unknown domain "nope". Domains: harness.',
    });
    expect(h.err()).toContain("Usage: harness");
  });

  it("without --json, usage errors print no JSON", async () => {
    const h = harness();
    await run(["nope"], h.deps);
    expect(h.err().startsWith("{")).toBe(false);
  });
});
