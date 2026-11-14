import { lstatSync, type Stats } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  isLinkOrFolder,
  isRegularFile,
  isSymlink,
} from "./guard-role-links.js";

vi.mock("node:fs");

/** The three kinds of path the unit asks about; a stat that is neither reports so. */
interface Kind {
  link?: boolean;
  folder?: boolean;
  file?: boolean;
}

/** A stat for a path of the given kind. The one cast is this fake's: it carries only the kind tests the unit reads. */
const statOf = ({ link = false, folder = false, file = false }: Kind) =>
  ({
    isSymbolicLink: () => link,
    isDirectory: () => folder,
    isFile: () => file,
  }) as Stats;

/** A failure from lstat, as the file system reports it. */
const errno = (code: string) => () => {
  throw Object.assign(new Error(code), { code });
};

describe("isLinkOrFolder", () => {
  it("is true for a symlink and for a folder", () => {
    vi.mocked(lstatSync).mockReturnValueOnce(statOf({ link: true }));
    expect(isLinkOrFolder("/a")).toBe(true);
    vi.mocked(lstatSync).mockReturnValueOnce(statOf({ folder: true }));
    expect(isLinkOrFolder("/b")).toBe(true);
  });

  it("is false for a plain file and for a path that does not exist", () => {
    vi.mocked(lstatSync).mockReturnValueOnce(statOf({ file: true }));
    expect(isLinkOrFolder("/c")).toBe(false);
    vi.mocked(lstatSync).mockImplementationOnce(errno("ENOENT"));
    expect(isLinkOrFolder("/d")).toBe(false);
  });

  it("rethrows an unexpected error rather than treating the path as safe", () => {
    vi.mocked(lstatSync).mockImplementationOnce(errno("EACCES"));
    expect(() => isLinkOrFolder("/e")).toThrow("EACCES");
  });

  it("reads the path itself, not the file it points to", () => {
    vi.mocked(lstatSync).mockReturnValueOnce(statOf({}));
    isLinkOrFolder("/f");
    expect(lstatSync).toHaveBeenCalledWith("/f");
  });
});

describe("isSymlink", () => {
  it("is true only for a symlink, not for a folder, a file or a missing path", () => {
    vi.mocked(lstatSync).mockReturnValueOnce(statOf({ link: true }));
    expect(isSymlink("/a")).toBe(true);
    vi.mocked(lstatSync).mockReturnValueOnce(statOf({ folder: true }));
    expect(isSymlink("/b")).toBe(false);
    vi.mocked(lstatSync).mockReturnValueOnce(statOf({ file: true }));
    expect(isSymlink("/c")).toBe(false);
    vi.mocked(lstatSync).mockImplementationOnce(errno("ENOENT"));
    expect(isSymlink("/d")).toBe(false);
  });

  it("rethrows an unexpected error rather than treating the path as no link", () => {
    vi.mocked(lstatSync).mockImplementationOnce(errno("EACCES"));
    expect(() => isSymlink("/e")).toThrow("EACCES");
  });
});

describe("isRegularFile", () => {
  it("is true only for an existing regular file", () => {
    vi.mocked(lstatSync).mockReturnValueOnce(statOf({ file: true }));
    expect(isRegularFile("/a")).toBe(true);
    vi.mocked(lstatSync).mockReturnValueOnce(statOf({ folder: true }));
    expect(isRegularFile("/b")).toBe(false);
    vi.mocked(lstatSync).mockImplementationOnce(errno("ENOENT"));
    expect(isRegularFile("/c")).toBe(false);
  });

  it("is false for a symlink, which lstat reports as a link and not as a file", () => {
    vi.mocked(lstatSync).mockReturnValueOnce(statOf({ link: true }));
    expect(isRegularFile("/d")).toBe(false);
  });
});
