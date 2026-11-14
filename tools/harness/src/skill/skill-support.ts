// Fakes shared by the skill domain's unit specs. A support file is not a unit,
// so it needs no spec of its own (ADR 0098).
import type { CliDeps, FileSystem } from "../runtime/index.js";

/** An error with a Node error code, as the file system rejects with. */
export function errno(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(code), { code });
}

const unused = (name: string) => (): Promise<never> =>
  Promise.reject(new Error(`${name} is not used by this unit`));

/**
 * A typed file system over a map of paths to text. A directory is whatever
 * lies under a path in the map; a missing path rejects with ENOENT, as the
 * real one does.
 */
export function fakeFileSystem(files: Record<string, string> = {}): FileSystem {
  const children = (dir: string): string[] => {
    const names = Object.keys(files)
      .filter((path) => path.startsWith(`${dir}/`))
      .map((path) => path.slice(dir.length + 1).split("/")[0] ?? "");
    return [...new Set(names)];
  };
  return {
    readFile: (path) =>
      path in files
        ? Promise.resolve(files[path] ?? "")
        : Promise.reject(errno("ENOENT")),
    exists: (path) => Promise.resolve(path in files),
    readdir: (dir) =>
      children(dir).length > 0
        ? Promise.resolve(children(dir))
        : Promise.reject(errno("ENOENT")),
    writeFile: unused("writeFile"),
    createFile: unused("createFile"),
    appendFile: unused("appendFile"),
    remove: unused("remove"),
    readlink: unused("readlink"),
    mtimeMs: unused("mtimeMs"),
    isDirectory: unused("isDirectory"),
    readHead: unused("readHead"),
    readFrom: unused("readFrom"),
    hasGlobMatch: unused("hasGlobMatch"),
  };
}

/** Everything a skill command touches, with the output it wrote captured. */
export function fakeDeps(files: Record<string, string> = {}, root = "/repo") {
  const out: string[] = [];
  const err: string[] = [];
  const deps: CliDeps = {
    runner: {
      run: () => Promise.reject(new Error("the skill domain runs no process")),
    },
    clock: { now: () => new Date(0), sleep: () => Promise.resolve() },
    fs: fakeFileSystem(files),
    root: () => Promise.resolve(root),
    ids: { next: () => "id-1" },
    env: {},
    cwd: root,
    stdin: () => Promise.resolve(""),
    stdout: (text) => out.push(text),
    stderr: (text) => err.push(text),
  };
  return {
    deps,
    out: () => out.join(""),
    err: () => err.join(""),
  };
}
