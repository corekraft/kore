import { matchesGlob } from "node:path";
import type { FileSystem } from "./filesystem.js";

const EXCLUDED = /(^|\/)(node_modules|\.git)(\/|$)/;

/** Whether a path under `cwd` among `keys` matches the glob, as the real walk does: no node_modules or .git. */
export function hasMatchUnder(
  keys: Iterable<string>,
  cwd: string,
  pattern: string,
): boolean {
  const prefix = `${cwd}/`;
  for (const key of keys) {
    const rel = key.startsWith(prefix) ? key.slice(prefix.length) : undefined;
    if (rel !== undefined && !EXCLUDED.test(rel) && matchesGlob(rel, pattern)) {
      return true;
    }
  }
  return false;
}

/** An in-memory FileSystem for tests; `files` is inspectable and seedable. */
export class MemoryFileSystem implements FileSystem {
  readonly files = new Map<string, string>();

  readFile(path: string): Promise<string> {
    const content = this.files.get(path);
    return content === undefined
      ? Promise.reject(
          Object.assign(new Error(`ENOENT: ${path}`), { code: "ENOENT" }),
        )
      : Promise.resolve(content);
  }

  writeFile(path: string, content: string): Promise<void> {
    this.files.set(path, content);
    return Promise.resolve();
  }

  appendFile(path: string, content: string): Promise<void> {
    this.files.set(path, (this.files.get(path) ?? "") + content);
    return Promise.resolve();
  }

  createFile(path: string, content: string): Promise<void> {
    if (this.files.has(path)) {
      return Promise.reject(
        Object.assign(new Error(`EEXIST: ${path}`), { code: "EEXIST" }),
      );
    }
    this.files.set(path, content);
    return Promise.resolve();
  }

  remove(path: string): Promise<void> {
    this.files.delete(path);
    return Promise.resolve();
  }

  exists(path: string): Promise<boolean> {
    return Promise.resolve(this.files.has(path));
  }

  readdir(path: string): Promise<string[]> {
    const prefix = `${path}/`;
    return Promise.resolve(
      [...this.files.keys()]
        .filter((f) => f.startsWith(prefix))
        .map((f) => f.slice(prefix.length).split("/")[0] ?? ""),
    );
  }

  mtimeMs(path: string): Promise<number> {
    return this.files.has(path)
      ? Promise.resolve(0)
      : Promise.reject(
          Object.assign(new Error(`ENOENT: ${path}`), { code: "ENOENT" }),
        );
  }

  isDirectory(path: string): Promise<boolean> {
    const dir = `${path}/`;
    return Promise.resolve(
      [...this.files.keys()].some((f) => f.startsWith(dir)),
    );
  }

  async readHead(path: string, bytes: number): Promise<string> {
    return (await this.readFile(path)).slice(0, bytes);
  }

  async readFrom(path: string, offset: number): Promise<string> {
    const content = this.files.get(path);
    if (content === undefined) {
      throw Object.assign(new Error(`ENOENT: ${path}`), { code: "ENOENT" });
    }
    return Buffer.from(content).subarray(offset).toString("utf8");
  }

  hasGlobMatch(cwd: string, pattern: string): Promise<boolean> {
    return Promise.resolve(hasMatchUnder(this.files.keys(), cwd, pattern));
  }

  readlink(path: string): Promise<string> {
    return Promise.reject(new Error(`ENOENT: ${path}`));
  }
}
