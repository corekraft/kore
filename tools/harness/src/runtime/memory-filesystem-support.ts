import type { FileSystem } from "./filesystem.js";

/** An in-memory FileSystem for tests; `files` is inspectable and seedable. */
export class MemoryFileSystem implements FileSystem {
  readonly files = new Map<string, string>();
  /** Symbolic links: path to the target as written. */
  readonly links = new Map<string, string>();

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

  readlink(path: string): Promise<string> {
    const target = this.links.get(path);
    if (target !== undefined) {
      return Promise.resolve(target);
    }
    const code = this.files.has(path) ? "EINVAL" : "ENOENT";
    return Promise.reject(
      Object.assign(new Error(`${code}: ${path}`), { code }),
    );
  }
}
