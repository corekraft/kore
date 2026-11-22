// Fakes shared by the dispatcher's specs. A support file is not a unit, so it needs no spec of its own (ADR 0098).
import { vi } from "vitest";
import type { CliDeps } from "../runtime/index.js";
import { depsWith } from "./command-support.js";

export const table = (() => {
  const command = (summary: string, extra: Record<string, unknown> = {}) => ({
    summary,
    run: vi.fn((_context: unknown) => Promise.resolve(0)),
    ...extra,
  });
  return {
    harness: {
      version: command("print the harness version", {
        help: { purpose: "print the version" },
      }),
    },
    plan: {
      tick: command("tick a step", {
        operand: "step",
        options: { note: "string", force: "boolean" },
      }),
    },
    hook: { guard: command("guard a tool call") },
    lone: {
      "": command("the domain's only command"),
      join: command("join targets", {
        options: { pr: "list", session: "list", timeout: "string" },
      }),
    },
  };
})();

// The help renderers and view builders, mocked in the dispatcher's specs. A renderer prints its
// view's level, and a builder tags its view with the path or domain it was given, so a spec sees
// which level was rendered and what each view was built from.
export const help = {
  rootView: vi.fn((..._args: unknown[]) => ({ level: "root" })),
  domainView: vi.fn((domain: string, ..._rest: unknown[]) => ({
    level: "domain",
    domain,
  })),
  commandView: vi.fn((path: string, ..._rest: unknown[]) => ({
    level: "command",
    path,
  })),
  renderText: vi.fn((view: { level: string }) => `text ${view.level}\n`),
  renderJson: vi.fn((view: { level: string }) => `json ${view.level}\n`),
};

// The output of the most recent depsOf(): what its stdout and stderr received.
let captured = { out: "", err: "" };

/** A throwing stand-in: a dispatch touches none of these, since a help request reads no root, file, process or clock. */
function untouched(what: string): () => never {
  return () => {
    throw new Error(`a dispatch touched ${what}`);
  };
}

export function depsOf(): CliDeps {
  captured = { out: "", err: "" };
  return depsWith({
    root: untouched("the repository root"),
    runner: { run: untouched("the runner") },
    clock: { now: untouched("the clock"), sleep: untouched("the clock") },
    fs: new Proxy({}, { get: untouched("the file system") }),
    stdout: (text: string) => (captured.out += text),
    stderr: (text: string) => (captured.err += text),
  });
}

export function outputOf() {
  return captured;
}
