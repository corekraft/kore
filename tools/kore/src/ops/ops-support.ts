// Fakes shared by the ops domain's unit specs. A support file is not a unit, so
// it needs no spec of its own (ADR 0098).
import { readdir, readFile } from "node:fs/promises";
import { vi } from "vitest";
import type { Repository } from "../config/index.js";
import type { Runner } from "../runtime/index.js";

export type Run = Runner["run"];

export function errno(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(code), { code });
}

/** A typed runner whose reply depends on the command and its arguments. */
export function fakeRunner(
  stdout: (command: string, args: readonly string[]) => string = () => "",
) {
  const run = vi.fn<Run>(async (command, args) => ({
    stdout: stdout(command, args),
    stderr: "",
    code: 0,
  }));
  return { runner: { run } as Runner, run };
}

/**
 * A repository stand-in with the fields the ops domain reads. Overrides replace
 * the matching fields; the cast stands in for the rest of the overlay.
 */
export function fakeRepository(
  fields: Record<string, unknown> = {},
  root = "/repo",
): Repository {
  return { root, ...fields } as unknown as Repository;
}

/**
 * Serves `readFile` from a map of absolute paths. A path that is not in the map
 * rejects with ENOENT, as the real file system does.
 */
export function serveFiles(files: Record<string, string>): void {
  vi.mocked(readFile).mockImplementation(async (path) => {
    const key = typeof path === "string" ? path : "";
    if (!(key in files)) {
      throw errno("ENOENT");
    }
    return files[key]!;
  });
}

/**
 * Serves `readdir` from a map of absolute directories to the names directly in
 * them. A path that is not a directory in the map rejects with ENOENT. With
 * `withFileTypes`, each name comes back as an entry object, as the real call does.
 */
export function serveDirectories(directories: Record<string, string[]>): void {
  vi.mocked(readdir).mockImplementation((async (
    path: string,
    options?: { withFileTypes?: boolean },
  ) => {
    if (!(path in directories)) {
      throw errno("ENOENT");
    }
    const names = directories[path]!;
    return options?.withFileTypes ? names.map((name) => ({ name })) : names;
  }) as typeof readdir);
}
