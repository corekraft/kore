// File rules for Read, Write and Edit: secret reads, append-only and idea records, sops, digests, thresholds, flags and guarded files. Rule units and verdict helpers are mocked; constants stay real.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { appendOnlyWarn, isAppendOnly } from "./guard-append-only.js";
import { checkDenyAudit } from "./guard-deny.js";
import {
  checkGuardrailDemotion,
  checkSettingsDenyRemoval,
} from "./guard-guardrails.js";
import { checkRulesetWeakening } from "./guard-ruleset.js";
import { domainLeak } from "./guard-leak.js";
import { evaluateFile } from "./guard-file.js";
import { loadSopsPatterns, secretBlock, sopsBlock } from "./guard-secrets.js";
import {
  allow,
  applyMode,
  block,
  warn,
  weigh,
  type Finding,
  type GuardContext,
  type Hit,
} from "./guard-verdict.js";

vi.mock("./guard-append-only.js", () => ({
  appendOnlyWarn: vi.fn(),
  isAppendOnly: vi.fn(),
}));
vi.mock("./guard-deny.js", () => ({ checkDenyAudit: vi.fn() }));
vi.mock("./guard-leak.js", () => ({ domainLeak: vi.fn(() => null) }));
vi.mock("./guard-guardrails.js", () => ({
  checkGuardrailDemotion: vi.fn(),
  checkSettingsDenyRemoval: vi.fn(),
}));
vi.mock("./guard-ruleset.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./guard-ruleset.js")>()),
  checkRulesetWeakening: vi.fn(),
}));
vi.mock("./guard-secrets.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./guard-secrets.js")>()),
  loadSopsPatterns: vi.fn(),
  secretBlock: vi.fn(),
  sopsBlock: vi.fn(),
}));
vi.mock("./guard-verdict.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./guard-verdict.js")>()),
  applyMode: vi.fn(),
  block: vi.fn(),
  warn: vi.fn(),
  weigh: vi.fn(),
}));

const ROOT = "/repo";
const INVENTORY = ".claude/guardrails.yaml";
const SETTINGS = ".claude/settings.json";
const OVERLAY = "infra/environments/local/environment.yaml";
const CONFIG = "tools/kore/vitest.config.ts";
const HISTORY = ".claude/evals/history.jsonl";
// A features map is JSON-compatible YAML, so a flag is a quoted key inside braces.
const FLAG_ON = '"features": { "judge-merge": true }';
const IMAGE = "  image: ghcr.io/x/web:1.2";
const DEPLOY = "apps/web/d.yaml";
const PINNED = "  image: ghcr.io/x/web@sha256:abc";
const IDEA = "docs/ideas/42.md";

/** The constructor a verdict helper stands in for: the rule's prefixed message, as the real one builds it. */
const verdictOf =
  (action: "block" | "warn") =>
  (rule: string, message: string): Hit => ({
    action,
    rule,
    message: `[guard:${rule}] ${message}`,
  });
const hit = (rule: string, kind: "block" | "warn" = "block"): Hit =>
  verdictOf(kind)(rule, rule);

type Input = Record<string, unknown>;
type Files = Record<string, string>;
const ENOENT = Object.assign(new Error("ENOENT"), { code: "ENOENT" });

/** A context whose files are keyed by path relative to the root; a missing file rejects with ENOENT. */
function ctxWith(files: Files = {}): GuardContext {
  const readFile = (path: string) => {
    const text = files[path.slice(`${ROOT}/`.length)];
    return text === undefined ? Promise.reject(ENOENT) : Promise.resolve(text);
  };
  return {
    root: ROOT,
    readFile,
    cwd: ROOT,
    home: "/home/test",
    globMatches: () => Promise.resolve(false),
    modeOf: () => "enforce",
    denyRules: [],
  };
}

/** One file-rule check of a tool call against a context of the given files. */
const scan = (tool: string, input: Input, path: string, files: Files = {}) =>
  evaluateFile(tool, input, path, ctxWith(files));

/** The rule's warning was raised with a message containing the text. */
const warned = (rule: string, text: string) =>
  expect(warn).toHaveBeenCalledWith(rule, expect.stringContaining(text));

beforeEach(() => {
  vi.mocked(applyMode).mockImplementation((finding: Finding) => finding);
  // A stand-in for weighing: the first finding that fires is the verdict; a warning names its rule.
  vi.mocked(weigh).mockImplementation((findings) => {
    const first = findings.find((f): f is Hit => f !== null);
    if (first === undefined) {
      return allow;
    }
    return first.action === "warn" ? { ...first, rules: [first.rule] } : first;
  });
  vi.mocked(warn).mockImplementation(verdictOf("warn"));
  vi.mocked(block).mockImplementation(verdictOf("block"));
  vi.mocked(secretBlock).mockReturnValue(hit("secret-path"));
  vi.mocked(sopsBlock).mockImplementation((path) => hit(`sops:${path}`));
  vi.mocked(loadSopsPatterns).mockResolvedValue([]);
  vi.mocked(isAppendOnly).mockReturnValue(false);
  vi.mocked(checkDenyAudit).mockReturnValue([]);
  vi.mocked(checkGuardrailDemotion).mockReturnValue(null);
  vi.mocked(checkSettingsDenyRemoval).mockReturnValue(null);
  vi.mocked(checkRulesetWeakening).mockReturnValue(null);
});

describe("evaluateFile: reads and the secret path", () => {
  it("blocks a read of key material through the rule's mode", async () => {
    const verdict = await scan("Read", {}, ".kore/keys/writer.pem");
    expect(verdict).toEqual(hit("secret-path"));
  });

  it("allows a read of an ordinary file, after the audit deny list is consulted", async () => {
    expect(await scan("Read", {}, "src/a.ts")).toEqual({ action: "allow" });
  });
});

describe("evaluateFile: append-only and idea records", () => {
  it("warns on an append-only record through its mode, and allows it once its mode turns the warning off", async () => {
    const edit = { old_string: "a", new_string: "b" };
    vi.mocked(isAppendOnly).mockReturnValue(true);
    vi.mocked(appendOnlyWarn).mockReturnValue(hit("append-only", "warn"));
    expect(await scan("Edit", edit, HISTORY)).toEqual(
      hit("append-only", "warn"),
    );
    expect(appendOnlyWarn).toHaveBeenCalledWith(HISTORY);
    vi.mocked(applyMode).mockReturnValueOnce(null);
    expect(await scan("Edit", edit, HISTORY)).toEqual({ action: "allow" });
  });

  it("warns on an idea record that writes its outcome by hand, and not on one without an outcome", async () => {
    await scan("Write", { content: "## Outcome\nconfirmed" }, IDEA);
    warned("idea-outcome", "docs/ideas/42.md is an idea record");
    vi.mocked(warn).mockClear();
    await scan("Write", { content: "# Summary\nplain" }, IDEA);
    expect(warn).not.toHaveBeenCalledWith("idea-outcome", expect.anything());
  });
});

describe("evaluateFile: sops, digests and thresholds", () => {
  it("blocks a plaintext write to an encrypted path, and allows an encrypted one", async () => {
    vi.mocked(loadSopsPatterns).mockResolvedValue([/\.enc\.yaml$/]);
    await scan("Write", { content: "key: plain" }, "infra/s.enc.yaml");
    expect(sopsBlock).toHaveBeenCalledWith("infra/s.enc.yaml");
    vi.mocked(sopsBlock).mockClear();
    await scan("Write", { content: "sops:\n  kms: x" }, "infra/s.enc.yaml");
    expect(sopsBlock).not.toHaveBeenCalled();
  });

  it("warns on an image that is not pinned by digest, and not on one pinned by digest", async () => {
    await scan("Write", { content: IMAGE }, DEPLOY);
    warned("image-digest", "ghcr.io/x/web:1.2 is not pinned by digest");
    vi.mocked(warn).mockClear();
    await scan("Write", { content: PINNED }, DEPLOY);
    expect(warn).not.toHaveBeenCalled();
  });

  it("blocks an edit that lowers a coverage threshold, and allows one that raises it", async () => {
    const edit = (to: string) => ({
      old_string: "statements: 95",
      new_string: to,
    });
    await scan("Edit", edit("statements: 90"), CONFIG);
    expect(block).toHaveBeenCalledWith(
      "coverage-threshold",
      expect.stringContaining("Coverage thresholds only go up"),
    );
    vi.mocked(block).mockClear();
    await scan("Edit", edit("statements: 96"), CONFIG);
    expect(block).not.toHaveBeenCalled();
  });
});

describe("evaluateFile: feature flags", () => {
  it("warns when an overlay turns on a flag that was off, by a write or by an edit with no features key", async () => {
    await scan("Write", { content: FLAG_ON }, OVERLAY);
    warned("flag-activation", "turns on flag judge-merge by hand");
    const edit = {
      old_string: "judge-merge: false",
      new_string: "judge-merge: true",
    };
    await scan("Edit", edit, OVERLAY);
    warned("flag-activation", "judge-merge");
  });

  it("offers an owner waiver beside a live run as the proof to record", async () => {
    await scan("Write", { content: FLAG_ON }, OVERLAY);
    warned(
      "flag-activation",
      "or `--source owner-waiver --evidence <comment url>` when the owner waived the live run",
    );
  });

  it("stays silent when the flag was already on, or the overlay has no features map", async () => {
    await scan("Write", { content: FLAG_ON }, OVERLAY, { [OVERLAY]: FLAG_ON });
    await scan("Write", { content: "name: local" }, OVERLAY);
    expect(warn).not.toHaveBeenCalledWith("flag-activation", expect.anything());
  });

  it("rethrows a read error that is not a missing file, when the flag check reads the overlay", async () => {
    const failing = {
      ...ctxWith(),
      readFile: () => Promise.reject(new Error("EACCES")),
    };
    await expect(
      evaluateFile("Write", { content: FLAG_ON }, OVERLAY, failing),
    ).rejects.toThrow("EACCES");
  });
});

describe("evaluateFile: guarded files", () => {
  it("passes the inventory's disk text and the written content to the demotion check", async () => {
    await scan("Write", { content: "new: true" }, INVENTORY, {
      [INVENTORY]: "old: true",
    });
    expect(checkGuardrailDemotion).toHaveBeenCalledWith(
      INVENTORY,
      "old: true",
      "new: true",
    );
  });

  it("replaces an edit's old text on disk before the settings check reads the result", async () => {
    const disk = '{"deny": ["a", "b"]}';
    const input = { old_string: '"b"', new_string: "" };
    await scan("Edit", input, SETTINGS, { [SETTINGS]: disk });
    expect(checkSettingsDenyRemoval).toHaveBeenCalledWith(
      SETTINGS,
      disk,
      '{"deny": ["a", ]}',
      expect.anything(),
    );
  });

  it("compares an edit's snippets when its old text is not on disk, and replaces every occurrence with replace_all", async () => {
    await scan("Edit", { old_string: "zz", new_string: "y" }, SETTINGS, {
      [SETTINGS]: "{}",
    });
    expect(checkSettingsDenyRemoval).toHaveBeenLastCalledWith(
      SETTINGS,
      "zz",
      "y",
      expect.anything(),
    );
    const all = { old_string: "a", new_string: "b", replace_all: true };
    await scan("Edit", all, SETTINGS, { [SETTINGS]: "aa" });
    expect(checkSettingsDenyRemoval).toHaveBeenLastCalledWith(
      SETTINGS,
      "aa",
      "bb",
      expect.anything(),
    );
  });

  it("gives an unguarded file empty texts to the guarded checks", async () => {
    await scan("Write", { content: "x" }, "src/a.ts");
    expect(checkGuardrailDemotion).toHaveBeenCalledWith("src/a.ts", "", "");
    expect(checkRulesetWeakening).toHaveBeenCalledWith("src/a.ts", "", "");
  });
});

describe("evaluateFile: the platform domain leak rule", () => {
  const leak = (tool: string, input: Input) =>
    evaluateFile(tool, input, "docs/notes.md", {
      ...ctxWith(),
      platformDomain: "platform.example.com",
    });

  it("checks a Write's content for the platform domain the context names", async () => {
    await leak("Write", { content: "host x" });
    expect(domainLeak).toHaveBeenCalledWith("host x", "platform.example.com");
  });

  it("checks an Edit's new text, not the text it replaces", async () => {
    await leak("Edit", { old_string: "x", new_string: "y" });
    expect(domainLeak).toHaveBeenCalledWith("y", "platform.example.com");
  });
});

describe("evaluateFile: combining with the audit deny list", () => {
  it("returns a block from the file rules alone, dropping the audit warnings", async () => {
    vi.mocked(checkDenyAudit).mockReturnValue([hit("audit-x", "warn")]);
    const edit = { old_string: "statements: 95", new_string: "statements: 90" };
    expect(await scan("Edit", edit, CONFIG)).toMatchObject({
      action: "block",
      rule: "coverage-threshold",
    });
  });

  it("returns an audit warning alone when the file rules allow the call", async () => {
    vi.mocked(checkDenyAudit).mockReturnValue([hit("audit-x", "warn")]);
    expect(await scan("Read", {}, "src/a.ts")).toMatchObject({
      action: "warn",
      rule: "audit-x",
    });
  });

  it("joins an audit warning onto a warning from the file rules, naming both rules", async () => {
    vi.mocked(checkDenyAudit).mockReturnValue([hit("audit-x", "warn")]);
    const verdict = await scan("Write", { content: IMAGE }, DEPLOY);
    expect(verdict).toMatchObject({
      action: "warn",
      rule: "image-digest",
      rules: ["image-digest", "audit-x"],
      message: expect.stringContaining("[guard:audit-x] audit-x"),
    });
  });
});
