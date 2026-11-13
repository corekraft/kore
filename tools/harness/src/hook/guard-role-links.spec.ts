import { beforeEach, describe, expect, it, vi } from "vitest";
import { isLinkOrFolder } from "./guard-role-links.js";

const fs = vi.hoisted(() => ({ lstatSync: vi.fn() }));
vi.mock("node:fs", () => fs);

const stat = (link: boolean, folder: boolean) => ({
  isSymbolicLink: () => link,
  isDirectory: () => folder,
});
const failWith = (code: string) => () => {
  throw Object.assign(new Error(code), { code });
};

describe("isLinkOrFolder", () => {
  beforeEach(() => {
    fs.lstatSync.mockReset();
  });

  it("is true for a symlink and for a folder", () => {
    fs.lstatSync.mockReturnValueOnce(stat(true, false));
    expect(isLinkOrFolder("/a")).toBe(true);
    fs.lstatSync.mockReturnValueOnce(stat(false, true));
    expect(isLinkOrFolder("/b")).toBe(true);
  });

  it("is false for a plain file and for a path that does not exist", () => {
    fs.lstatSync.mockReturnValueOnce(stat(false, false));
    expect(isLinkOrFolder("/c")).toBe(false);
    fs.lstatSync.mockImplementationOnce(failWith("ENOENT"));
    expect(isLinkOrFolder("/d")).toBe(false);
  });

  it("rethrows an unexpected error rather than treating the path as safe", () => {
    fs.lstatSync.mockImplementationOnce(failWith("EACCES"));
    expect(() => isLinkOrFolder("/e")).toThrow("EACCES");
  });
});
