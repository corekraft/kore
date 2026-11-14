// Secret material and encrypted paths: the patterns, the keychain read check, and the sops pattern loader. `block` is mocked.

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  SECRET_PATH,
  SECRET_SAFE,
  keychainBlock,
  loadSopsPatterns,
  readsKoreKeychain,
  secretBlock,
  sopsBlock,
} from "./guard-secrets.js";
import { block, type GuardContext, type Hit } from "./guard-verdict.js";

vi.mock("./guard-verdict.js", () => ({ block: vi.fn() }));

/** A guard context whose only member the loader reads is the file reader, fed from a fixed map. */
const ctxFiles = (files: Record<string, string>): GuardContext => ({
  root: "/repo",
  readFile: (path) =>
    files[path] === undefined
      ? Promise.reject(Object.assign(new Error("ENOENT"), { code: "ENOENT" }))
      : Promise.resolve(files[path]),
  cwd: "/repo",
  globMatches: () => Promise.resolve(false),
  modeOf: () => "enforce",
  denyRules: [],
});

beforeEach(() => {
  vi.mocked(block).mockImplementation((rule): Hit => ({
    action: "block",
    rule,
    message: rule,
  }));
});

describe("SECRET_PATH and SECRET_SAFE", () => {
  it("matches key and token material under .kore/, when it starts a word", () => {
    expect(SECRET_PATH.test("cat .kore/keys/writer.pem")).toBe(true);
    expect(SECRET_PATH.test("cat .kore/state/herdr-token")).toBe(true);
    expect(SECRET_PATH.test("cat x.kore/keys/writer.pem")).toBe(false);
    expect(SECRET_PATH.test("cat .kore/state/journal.jsonl")).toBe(false);
  });

  it("treats only the read-only commands as safe to name the material", () => {
    expect([...SECRET_SAFE].sort()).toEqual(["[", "ls", "stat", "test"]);
  });
});

describe("secretBlock and keychainBlock", () => {
  it("blocks secret material under the secret-path rule, pointing to a kore command that streams it", () => {
    expect(secretBlock()).toEqual({
      action: "block",
      rule: "secret-path",
      message: "secret-path",
    });
    expect(block).toHaveBeenCalledWith(
      "secret-path",
      expect.stringContaining(
        "Instead, use a kore command that streams the secret through stdin",
      ),
    );
  });

  it("blocks a read of the kore.* keychain items, naming session spawn as the fix", () => {
    keychainBlock();
    expect(block).toHaveBeenCalledWith(
      "secret-path",
      expect.stringContaining("Instead, use `session spawn`"),
    );
  });
});

describe("readsKoreKeychain", () => {
  it("is true for a keychain dump or export, and for a find of a kore.* item", () => {
    expect(readsKoreKeychain("security", ["dump-keychain"])).toBe(true);
    expect(readsKoreKeychain("security", ["export", "-k", "login"])).toBe(true);
    expect(
      readsKoreKeychain("security", [
        "find-generic-password",
        "-s",
        "kore.judge",
      ]),
    ).toBe(true);
  });

  it("is false for a find of another item, and for any command other than security", () => {
    expect(
      readsKoreKeychain("security", ["find-generic-password", "-s", "other"]),
    ).toBe(false);
    expect(readsKoreKeychain("ls", ["dump-keychain"])).toBe(false);
  });
});

describe("loadSopsPatterns", () => {
  it("reads each path_regex in .sops.yaml as a pattern, unquoting it", async () => {
    const files = {
      "/repo/.sops.yaml":
        "creation_rules:\n  - path_regex: 'infra/.*\\.enc\\.yaml$'\n  - path_regex: secrets/x\n",
    };
    const patterns = await loadSopsPatterns(ctxFiles(files));
    // Each pattern is judged by what it matches: RegExp.source escapes slashes, so it is not compared.
    expect(patterns).toHaveLength(2);
    expect(patterns[0]?.test("infra/a.enc.yaml")).toBe(true);
    expect(patterns[0]?.test("infra/a.yaml")).toBe(false);
    expect(patterns[1]?.test("secrets/x")).toBe(true);
  });

  it("returns no patterns when the config is absent, and skips one that does not parse", async () => {
    expect(await loadSopsPatterns(ctxFiles({}))).toEqual([]);
    const broken = {
      "/repo/.sops.yaml": "  - path_regex: [unclosed\n  - path_regex: ok\n",
    };
    expect(
      (await loadSopsPatterns(ctxFiles(broken))).map((p) => p.source),
    ).toEqual(["ok"]);
  });
});

describe("sopsBlock", () => {
  it("blocks a plaintext write to an encrypted path, naming the path and sops as the fix", () => {
    sopsBlock("infra/secrets.enc.yaml");
    expect(block).toHaveBeenCalledWith(
      "sops-plaintext",
      expect.stringContaining(
        "infra/secrets.enc.yaml is an encrypted secret path",
      ),
    );
    expect(vi.mocked(block).mock.calls[0]?.[1]).toContain("sops <path>");
  });
});
