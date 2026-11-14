import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { hostLocksDirectory } from "./host-root.js";

vi.mock("node:os");
vi.mock("node:path");

beforeEach(() => {
  vi.mocked(isAbsolute).mockReturnValue(true);
  vi.mocked(join).mockReturnValue("/host/.kore/locks");
});

describe("hostLocksDirectory: which root", () => {
  it("uses KORE_HOST_ROOT first, and never asks for the home directory", () => {
    const dir = hostLocksDirectory({
      KORE_HOST_ROOT: "/srv/kore",
      HOME: "/home/u",
    });
    expect(dir).toBe("/host/.kore/locks");
    expect(vi.mocked(isAbsolute).mock.calls).toEqual([["/srv/kore"]]);
    expect(vi.mocked(join).mock.calls).toEqual([
      ["/srv/kore", ".kore", "locks"],
    ]);
    expect(vi.mocked(homedir)).not.toHaveBeenCalled();
  });

  it("uses HOME when KORE_HOST_ROOT is unset or empty", () => {
    hostLocksDirectory({ KORE_HOST_ROOT: "", HOME: "/home/u" });
    expect(vi.mocked(isAbsolute).mock.calls).toEqual([["/home/u"]]);
    expect(vi.mocked(join).mock.calls).toEqual([["/home/u", ".kore", "locks"]]);
  });

  it("falls back to the home directory when neither variable is set", () => {
    vi.mocked(homedir).mockReturnValue("/home/fallback");
    hostLocksDirectory({});
    expect(vi.mocked(isAbsolute).mock.calls).toEqual([["/home/fallback"]]);
    expect(vi.mocked(join).mock.calls).toEqual([
      ["/home/fallback", ".kore", "locks"],
    ]);
  });
});

describe("hostLocksDirectory: a relative root", () => {
  it("is refused, naming KORE_HOST_ROOT and how to fix it", () => {
    vi.mocked(isAbsolute).mockReturnValue(false);
    expect(() => hostLocksDirectory({ KORE_HOST_ROOT: "relative" })).toThrow(
      'KORE_HOST_ROOT must be an absolute path, got "relative"; set KORE_HOST_ROOT to an absolute directory or unset it',
    );
    expect(vi.mocked(join)).not.toHaveBeenCalled();
  });

  it("is refused, naming HOME when that is the root in use", () => {
    vi.mocked(isAbsolute).mockReturnValue(false);
    expect(() => hostLocksDirectory({ HOME: "home" })).toThrow(
      'HOME must be an absolute path, got "home"',
    );
  });

  it("is refused for the home directory itself, naming it as the source", () => {
    vi.mocked(isAbsolute).mockReturnValue(false);
    vi.mocked(homedir).mockReturnValue("~");
    expect(() => hostLocksDirectory({})).toThrow(
      'the home directory must be an absolute path, got "~"',
    );
  });
});
