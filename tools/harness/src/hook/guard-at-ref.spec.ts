// Loading the guard as it was at a git ref: the source graph read through git, the module hooks
// that serve it from memory, and the hooks removed once the guard is loaded.

import { describe, expect, it, vi } from "vitest";
import type { Runner } from "../runtime/index.js";
import {
  GUARD_ENTRY,
  GuardAtRefError,
  guardAtRef,
  hooksFor,
  sourcesAt,
  type ModuleHookRegistrar,
} from "./guard-at-ref.js";

const SHA = "a1b2c3d";
const ROOT = "/repo";
const HOOK = "tools/harness/src/hook";

/** A git runner that answers `git show <sha>:<path>` from a table of files at the ref. */
function gitAt(files: Record<string, string>): Runner {
  return {
    run: vi.fn(async (_command: string, args: readonly string[]) => {
      const path = (args[1] ?? "").slice(SHA.length + 1);
      return path in files
        ? { stdout: files[path] ?? "", stderr: "", code: 0 }
        : {
            stdout: "",
            stderr: `fatal: path '${path}' does not exist`,
            code: 128,
          };
    }),
  } as unknown as Runner;
}

const GRAPH: Record<string, string> = {
  [GUARD_ENTRY]: `import { bash } from "./guard-bash.js";\nimport { type Verdict } from "./guard-verdict.js";\nimport { join } from "node:path";\nexport const evaluate = () => bash(join("a", "b"));`,
  [`${HOOK}/guard-bash.ts`]: `import { allow } from "./guard-verdict.js";\nimport { index } from "../guardrail/index.js";\nexport const bash = () => allow;`,
  [`${HOOK}/guard-verdict.ts`]: `export const allow = { action: "allow" };`,
  ["tools/harness/src/guardrail/index.ts"]: `export const index = 1;`,
};

describe("sourcesAt reads the guard's import graph at a ref", () => {
  it("reads the entry and every relative import it reaches, and no package", async () => {
    const sources = await sourcesAt(gitAt(GRAPH), ROOT, SHA);

    expect([...sources.keys()].sort()).toEqual(
      [
        GUARD_ENTRY,
        `${HOOK}/guard-bash.ts`,
        `${HOOK}/guard-verdict.ts`,
        "tools/harness/src/guardrail/index.ts",
      ].sort(),
    );
  });

  it("names the ref when the entry is not in it", async () => {
    await expect(sourcesAt(gitAt({}), ROOT, SHA)).rejects.toThrow(
      new GuardAtRefError(
        `${GUARD_ENTRY} is not in ${SHA}; name a git ref that has the guard, such as main`,
      ),
    );
  });

  it("names the importing file when a relative import is missing at the ref", async () => {
    const broken = {
      ...GRAPH,
      [`${HOOK}/guard-bash.ts`]: `import { gone } from "./guard-gone.js";`,
    };
    await expect(sourcesAt(gitAt(broken), ROOT, SHA)).rejects.toThrow(
      `${HOOK}/guard-bash.ts imports ./guard-gone.js, which ${SHA} does not have`,
    );
  });
});

/** A registrar that keeps the hooks it is given, so a test can call them. */
function capturing() {
  const hooks: { current?: ReturnType<typeof hooksFor> } = {};
  const deregister = vi.fn();
  const register: ModuleHookRegistrar = (given) => {
    hooks.current = given;
    return { deregister };
  };
  return { hooks, deregister, register };
}

describe("the guard's module hooks serve the ref's files", () => {
  it("resolves a relative import from a guard file to that file at the ref", async () => {
    const { resolve } = await loadHooks();
    const next = vi.fn();

    const resolved = resolve(
      "../guardrail/index.js",
      { parentURL: urlAt(`${HOOK}/guard-bash.ts`) },
      next,
    );

    expect(resolved).toEqual({
      url: urlAt("tools/harness/src/guardrail/index.ts"),
      shortCircuit: true,
    });
    expect(next).not.toHaveBeenCalled();
  });

  it("hands a package or a node builtin to the default resolver", async () => {
    const { resolve } = await loadHooks();
    const next = vi.fn(() => ({ url: "node:path" }));

    resolve("node:path", { parentURL: urlAt(GUARD_ENTRY) }, next);

    expect(next).toHaveBeenCalledWith("node:path", {
      parentURL: urlAt(GUARD_ENTRY),
    });
  });

  it("loads a resolved file as TypeScript with its text at the ref", async () => {
    const { load } = await loadHooks();

    const loaded = load(urlAt(`${HOOK}/guard-verdict.ts`), {}, vi.fn());

    expect(loaded).toEqual({
      format: "module-typescript",
      source: GRAPH[`${HOOK}/guard-verdict.ts`],
      shortCircuit: true,
    });
  });

  async function loadHooks() {
    const { hooks, register } = capturing();
    const importer = vi.fn(async () => ({ evaluate: () => undefined }));
    await guardAtRef(gitAt(GRAPH), ROOT, SHA, { register, importer });
    const current = hooks.current;
    if (current === undefined) {
      throw new Error("no hooks were registered");
    }
    return current;
  }
});

const urlAt = (path: string) => `kore-guard://${SHA}/${path}`;

describe("guardAtRef loads the guard and removes its hooks", () => {
  it("returns the evaluate of the entry it imported, and deregisters the hooks", async () => {
    const { register, deregister } = capturing();
    const evaluate = vi.fn();
    const importer = vi.fn(async () => ({ evaluate }));

    const loaded = await guardAtRef(gitAt(GRAPH), ROOT, SHA, {
      register,
      importer,
    });

    expect(importer).toHaveBeenCalledWith(urlAt(GUARD_ENTRY));
    expect(loaded).toBe(evaluate);
    expect(deregister).toHaveBeenCalledTimes(1);
  });

  it("removes the hooks even when the import fails", async () => {
    const { register, deregister } = capturing();
    const importer = vi.fn(async () => {
      throw new Error("syntax error in guard-bash.ts");
    });

    await expect(
      guardAtRef(gitAt(GRAPH), ROOT, SHA, { register, importer }),
    ).rejects.toBeInstanceOf(GuardAtRefError);
    expect(deregister).toHaveBeenCalledTimes(1);
  });

  it("names the ref and the cause when the guard at the ref does not load", async () => {
    const { register } = capturing();
    const importer = vi.fn(async () => {
      throw new Error("TypeScript parameter property is not supported");
    });

    await expect(
      guardAtRef(gitAt(GRAPH), ROOT, SHA, { register, importer }),
    ).rejects.toThrow(
      `the guard at ${SHA} did not load (TypeScript parameter property is not supported)`,
    );
  });
});
