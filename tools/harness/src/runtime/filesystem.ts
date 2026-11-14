import {
  appendFile,
  glob,
  mkdir,
  readFile,
  open,
  readdir,
  rm,
  readlink,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname } from "node:path";

/** Directories a glob walk never enters: dependency trees and version control. */
const GLOB_EXCLUDE = ["**/node_modules", "**/.git"];

export interface FileSystem {
  readFile(path: string): Promise<string>;
  /** Creates missing parent directories. */
  writeFile(path: string, content: string): Promise<void>;
  /** Creates missing parent directories; rejects with code EEXIST when the file already exists. */
  createFile(path: string, content: string): Promise<void>;
  /**
   * Appends with a single write (O_APPEND), so concurrent writers each add whole
   * content. Creates missing parent directories.
   */
  appendFile(path: string, content: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  readdir(path: string): Promise<string[]>;
  /** Deletes a file; succeeds when it is already gone. */
  remove(path: string): Promise<void>;
  /** The link's target as written; rejects with EINVAL for a non-link and ENOENT for a missing path. */
  readlink(path: string): Promise<string>;
  /** The last-modified time in epoch milliseconds; rejects with ENOENT for a missing path. */
  mtimeMs(path: string): Promise<number>;
  /** Whether the path is a directory; false for a file or a missing path. */
  isDirectory(path: string): Promise<boolean>;
  /** The first `bytes` bytes of a file as text, without reading the rest. */
  readHead(path: string, bytes: number): Promise<string>;
  /** The file's text from byte `offset` to its end, without reading what precedes it; empty at or past the end. */
  readFrom(path: string, offset: number): Promise<string>;
  /**
   * Whether any path under `cwd` matches the shell glob. Stops at the first match;
   * never enters node_modules or .git.
   */
  hasGlobMatch(cwd: string, pattern: string): Promise<boolean>;
}

export const nodeFileSystem: FileSystem = {
  readFile: (path) => readFile(path, "utf8"),
  async writeFile(path, content) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content);
  },
  async createFile(path, content) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content, { flag: "wx" });
  },
  async appendFile(path, content) {
    await mkdir(dirname(path), { recursive: true });
    await appendFile(path, content);
  },
  async exists(path) {
    try {
      await stat(path);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return false;
      }
      throw error;
    }
  },
  readdir: (path) => readdir(path),
  remove: (path) => rm(path, { force: true }),
  readlink: (path) => readlink(path),
  async mtimeMs(path) {
    return (await stat(path)).mtimeMs;
  },
  async isDirectory(path) {
    try {
      return (await stat(path)).isDirectory();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return false;
      }
      throw error;
    }
  },
  async readHead(path, bytes) {
    const file = await open(path, "r");
    try {
      const buffer = Buffer.alloc(bytes);
      const { bytesRead } = await file.read(buffer, 0, bytes, 0);
      return buffer.toString("utf8", 0, bytesRead);
    } finally {
      await file.close();
    }
  },
  async readFrom(path, offset) {
    const file = await open(path, "r");
    try {
      const { size } = await file.stat();
      if (offset >= size) {
        return "";
      }
      const buffer = Buffer.alloc(size - offset);
      const { bytesRead } = await file.read(buffer, 0, buffer.length, offset);
      return buffer.toString("utf8", 0, bytesRead);
    } finally {
      await file.close();
    }
  },
  async hasGlobMatch(cwd, pattern) {
    for await (const path of glob(pattern, { cwd, exclude: GLOB_EXCLUDE })) {
      return path.length > 0;
    }
    return false;
  },
};
