// Fakes shared by the flag domain's unit specs. A support file is not a unit,
// so it needs no spec of its own (ADR 0098).
import type { IdeaRepository } from "../idea/index.js";
import type { FileSystem } from "../runtime/index.js";

/** An error with a Node error code, as the file system rejects with. */
export function errno(code: string, message = code): NodeJS.ErrnoException {
  return Object.assign(new Error(message), { code });
}

const unused = (name: string) => (): Promise<never> =>
  Promise.reject(new Error(`${name} is not used by this unit`));

/**
 * A typed file system over a map of absolute paths to text. A directory is
 * whatever lies under a path in the map; a missing path rejects with ENOENT.
 * `overrides` replaces single methods, to reject a path the way the real file
 * system does.
 */
export function fakeFileSystem(
  files: Record<string, string> = {},
  overrides: Partial<FileSystem> = {},
): FileSystem {
  const children = (dir: string): string[] => {
    const names = Object.keys(files)
      .filter((path) => path.startsWith(`${dir}/`))
      .map((path) => path.slice(dir.length + 1).split("/")[0] ?? "");
    return [...new Set(names)];
  };
  const base: FileSystem = {
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
  return { ...base, ...overrides };
}

/** One idea as the repository lists it, with the text its outcome section is read from. */
export interface FakeIdea {
  number: string;
  path: string;
  text: string;
}

/**
 * A repository that lists the given ideas and returns each one's text. The
 * cast stands in for the class's private fields, which these units never read.
 */
export function fakeRepository(ideas: FakeIdea[]): IdeaRepository {
  const repository = {
    list: () =>
      Promise.resolve(ideas.map(({ number, path }) => ({ number, path }))),
    source: (record: { path: string }) =>
      Promise.resolve(ideas.find((i) => i.path === record.path)?.text ?? ""),
  };
  return repository as unknown as IdeaRepository;
}
