import {
  appendFile,
  mkdir,
  readFile,
  readdir,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname } from "node:path";

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
};
