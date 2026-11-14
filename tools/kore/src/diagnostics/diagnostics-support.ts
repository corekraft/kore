// Fakes shared by the diagnostics domain's unit specs. A support file is not a
// unit, so it needs no spec of its own (ADR 0098).
import { readdir, readFile } from "node:fs/promises";
import type { Dirent } from "node:fs";
import { vi } from "vitest";
import type { Repository } from "../config/index.js";
import type { Runner } from "../runtime/index.js";

export type Run = Runner["run"];

export function errno(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(code), { code });
}

/** A typed runner whose stdout depends on the command; `reply` may throw to fail it. */
export function fakeRunner(
  reply: (command: string, args: readonly string[]) => string = () => "",
) {
  const run = vi.fn<Run>(async (command, args) => ({
    stdout: reply(command, args),
    stderr: "",
    code: 0,
  }));
  return { runner: { run } as Runner, run };
}

/**
 * A repository with the fields the diagnostics domain reads. Overrides replace
 * the environment's fields, and `tools` is the pinned version map. The one cast
 * stands in for the rest of the overlay, which these units never read.
 */
export function fakeRepository(
  environment: Record<string, unknown> = {},
  tools: Record<string, string> = {},
  root = "/repo",
): Repository {
  return {
    root,
    versions: { tools },
    environment: {
      name: "local",
      provider: "k3d",
      kubeContext: "k3d-kore-local",
      ...environment,
    },
  } as unknown as Repository;
}

/**
 * Serves `readFile` and `readdir` from a map of absolute paths to contents, as
 * a directory tree. A path under no file is missing: ENOENT, as on disk. The
 * domain only ever passes string paths, so each is read as one.
 */
export function fakeFileTree(files: Record<string, string>): void {
  vi.mocked(readFile).mockImplementation(async (path) => {
    const text = files[path as string];
    if (text === undefined) {
      throw errno("ENOENT");
    }
    return text;
  });
  vi.mocked(readdir).mockImplementation(
    async (path) =>
      entriesIn(files, path as string) as unknown as Awaited<
        ReturnType<typeof readdir>
      >,
  );
}

/** The direct children of `directory`, each a file or a directory, as Dirent. */
function entriesIn(files: Record<string, string>, directory: string): Dirent[] {
  const children = new Map<string, boolean>();
  for (const path of Object.keys(files)) {
    if (!path.startsWith(`${directory}/`)) {
      continue;
    }
    const [name, ...rest] = path.slice(directory.length + 1).split("/");
    children.set(
      name ?? "",
      rest.length > 0 || children.get(name ?? "") === true,
    );
  }
  if (children.size === 0) {
    throw errno("ENOENT");
  }
  return [...children].map(
    ([name, isDirectory]) =>
      ({ name, isDirectory: () => isDirectory }) as Dirent,
  );
}
