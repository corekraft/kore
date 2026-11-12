import type { FileSystem } from "./filesystem.js";

/**
 * An in-memory file system for tests, keyed by absolute path with directories
 * implied. Any path outside `root` throws, so a command that builds a path
 * from the working directory instead of the repository root fails loudly.
 */
export class MemoryFileSystem implements FileSystem {
  /** Runs before each createFile; a test uses it to play a competing writer. */
  beforeCreate: ((path: string) => void) | undefined;

  constructor(
    readonly root: string,
    readonly files: Map<string, string> = new Map(),
  ) {}

  private checked(path: string): string {
    if (!path.startsWith(`${this.root}/`)) {
      throw new Error(`path outside the repository root: ${path}`);
    }
    return path;
  }

  readFile(path: string): Promise<string> {
    const text = this.files.get(this.checked(path));
    return text === undefined
      ? Promise.reject(new Error(`ENOENT: ${path}`))
      : Promise.resolve(text);
  }

  writeFile(path: string, content: string): Promise<void> {
    this.files.set(this.checked(path), content);
    return Promise.resolve();
  }

  remove(path: string): Promise<void> {
    this.files.delete(path);
    return Promise.resolve();
  }

  createFile(path: string, content: string): Promise<void> {
    this.beforeCreate?.(this.checked(path));
    if (this.files.has(path)) {
      return Promise.reject(
        Object.assign(new Error(`EEXIST: ${path}`), { code: "EEXIST" }),
      );
    }
    this.files.set(path, content);
    return Promise.resolve();
  }

  appendFile(path: string, content: string): Promise<void> {
    this.files.set(this.checked(path), (this.files.get(path) ?? "") + content);
    return Promise.resolve();
  }

  exists(path: string): Promise<boolean> {
    const dir = `${this.checked(path)}/`;
    return Promise.resolve(
      this.files.has(path) ||
        [...this.files.keys()].some((key) => key.startsWith(dir)),
    );
  }

  readdir(path: string): Promise<string[]> {
    const dir = `${this.checked(path)}/`;
    const names = [...this.files.keys()]
      .filter((key) => key.startsWith(dir))
      .map((key) => key.slice(dir.length).split("/")[0] ?? "");
    return Promise.resolve([...new Set(names)].sort());
  }
}
