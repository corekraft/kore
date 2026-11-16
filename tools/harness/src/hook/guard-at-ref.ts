// Loads the guard as it was at a git ref, for the guard replay. Nothing is written to disk: the
// ref's guard sources are read through git, and Node's module loader is given them from memory
// by a resolve and a load hook that last only for the import. The entry is the guard's evaluate
// (hook/guard-evaluate.ts); its relative imports are followed, and packages and node builtins
// are left to Node.

import { registerHooks } from "node:module";
import { posix } from "node:path";
import { CommandError, type Runner } from "../runtime/index.js";
import type { Evaluate } from "./guard-replay.js";

/** The guard's entry, relative to the repository root. */
export const GUARD_ENTRY = "tools/harness/src/hook/guard-evaluate.ts";

const SCHEME = "kore-guard://";
const RELATIVE_IMPORT =
  /\bfrom\s+["'](\.[^"']*)["']|\bimport\s*\(?\s*["'](\.[^"']*)["']/g;

/** A guard at a ref cannot be read or loaded: the message says what to do. */
export class GuardAtRefError extends CommandError {}

/** The resolve result the guard's hooks return: the URL to load. */
export interface ResolvedUrl {
  url: string;
  shortCircuit?: boolean | undefined;
}

/** A load result: the file's text as TypeScript, or whatever Node's own loader returns. */
export interface LoadedSource {
  format: string | null | undefined;
  source?: string | ArrayBuffer | NodeJS.TypedArray | undefined;
  shortCircuit?: boolean | undefined;
}

/** The hooks that serve one ref's guard sources to Node's loader. */
export interface GuardHooks {
  resolve: (
    specifier: string,
    context: { parentURL?: string | undefined },
    next: (
      specifier: string,
      context?: { parentURL?: string | undefined },
    ) => ResolvedUrl,
  ) => ResolvedUrl;
  load: (
    url: string,
    context: object,
    next: (url: string) => LoadedSource,
  ) => LoadedSource;
}

/** Registers hooks with Node and returns the handle that removes them. */
export type ModuleHookRegistrar = (hooks: GuardHooks) => {
  deregister(): void;
};

/** The ports the loader takes: how hooks are registered and how the module is imported. */
export interface LoaderPorts {
  register?: ModuleHookRegistrar;
  importer?: (url: string) => Promise<unknown>;
}

const urlOf = (sha: string, path: string) => `${SCHEME}${sha}/${path}`;

async function showAt(
  runner: Runner,
  root: string,
  sha: string,
  path: string,
): Promise<string | undefined> {
  const result = await runner.run("git", ["show", `${sha}:${path}`], {
    cwd: root,
  });
  return result.code === 0 ? result.stdout : undefined;
}

/** The repository paths a relative import from a file can name: the module file, then its index. */
function candidatesOf(from: string, specifier: string): string[] {
  const stem = posix.join(posix.dirname(from), specifier.replace(/\.js$/, ""));
  return [`${stem}.ts`, `${stem}/index.ts`];
}

/** Every relative import a source names, as written. */
function relativeImports(source: string): string[] {
  return [...source.matchAll(RELATIVE_IMPORT)].map(
    (match) => match[1] ?? match[2] ?? "",
  );
}

/**
 * The guard's source files at a ref, by repository path: the entry and every file it reaches
 * through relative imports. Throws, naming the ref and the file, when the ref lacks one.
 */
export async function sourcesAt(
  runner: Runner,
  root: string,
  sha: string,
): Promise<Map<string, string>> {
  const entry = await showAt(runner, root, sha, GUARD_ENTRY);
  if (entry === undefined) {
    throw new GuardAtRefError(
      `${GUARD_ENTRY} is not in ${sha}; name a git ref that has the guard, such as main`,
    );
  }
  const files = new Map<string, string>([[GUARD_ENTRY, entry]]);
  const queue = [GUARD_ENTRY];
  for (let from = queue.shift(); from !== undefined; from = queue.shift()) {
    for (const specifier of relativeImports(files.get(from) ?? "")) {
      const found = await firstAt(runner, root, sha, from, specifier);
      if (found === undefined) {
        throw new GuardAtRefError(
          `${from} imports ${specifier}, which ${sha} does not have`,
        );
      }
      if (!files.has(found.path)) {
        files.set(found.path, found.source);
        queue.push(found.path);
      }
    }
  }
  return files;
}

async function firstAt(
  runner: Runner,
  root: string,
  sha: string,
  from: string,
  specifier: string,
): Promise<{ path: string; source: string } | undefined> {
  for (const path of candidatesOf(from, specifier)) {
    const source = await showAt(runner, root, sha, path);
    if (source !== undefined) {
      return { path, source };
    }
  }
  return undefined;
}

/**
 * The hooks that serve the sources of one ref. A guard file's relative import resolves to the
 * ref's file, a URL in the ref's own scheme; the entry's own URL resolves to itself.
 */
export function hooksFor(
  sha: string,
  files: ReadonlyMap<string, string>,
): GuardHooks {
  const prefix = urlOf(sha, "");
  return {
    resolve(specifier, context, next) {
      if (specifier.startsWith(prefix)) {
        return { url: specifier, shortCircuit: true };
      }
      const parent = context.parentURL;
      if (
        parent === undefined ||
        !parent.startsWith(prefix) ||
        !specifier.startsWith(".")
      ) {
        return next(specifier, context);
      }
      const from = parent.slice(prefix.length);
      const target = candidatesOf(from, specifier).find((path) =>
        files.has(path),
      );
      if (target === undefined) {
        throw new GuardAtRefError(
          `${from} imports ${specifier}, which ${sha} does not have`,
        );
      }
      return { url: urlOf(sha, target), shortCircuit: true };
    },
    load(url, _context, next) {
      if (!url.startsWith(prefix)) {
        return next(url);
      }
      const source = files.get(url.slice(prefix.length));
      if (source === undefined) {
        throw new GuardAtRefError(`${url} is not in ${sha}`);
      }
      return { format: "module-typescript", source, shortCircuit: true };
    },
  };
}

const nodeRegistrar: ModuleHookRegistrar = (hooks) =>
  registerHooks({
    resolve: (specifier, context, nextResolve) =>
      hooks.resolve(specifier, context, nextResolve),
    load: (url, context, nextLoad) => hooks.load(url, context, nextLoad),
  });

/**
 * The guard's evaluate as it was at `sha`. The hooks last only for the import; they are removed
 * even when it fails, so the process's other imports never see this ref's files.
 */
export async function guardAtRef(
  runner: Runner,
  root: string,
  sha: string,
  ports: LoaderPorts = {},
): Promise<Evaluate> {
  const register = ports.register ?? nodeRegistrar;
  const importer = ports.importer ?? ((url: string) => import(url));
  const files = await sourcesAt(runner, root, sha);
  const handle = register(hooksFor(sha, files));
  try {
    const guard = (await importer(urlOf(sha, GUARD_ENTRY))) as {
      evaluate: Evaluate;
    };
    return guard.evaluate;
  } catch (error) {
    if (!(error instanceof Error)) {
      throw error;
    }
    throw new GuardAtRefError(
      `the guard at ${sha} did not load (${error.message}); Node's strip-only TypeScript mode refuses some syntax the guard's sources use, such as a constructor parameter property`,
    );
  } finally {
    handle.deregister();
  }
}
