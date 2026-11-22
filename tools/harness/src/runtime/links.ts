import { realpath } from "node:fs/promises";

/** Resolves a path to its real location. Behind an interface so a spec never reads the real file system. */
export interface Links {
  /** The path with every link followed; rejects with ENOENT for a missing path. */
  realpath(path: string): Promise<string>;
}

export const nodeLinks: Links = {
  realpath: (path) => realpath(path),
};
