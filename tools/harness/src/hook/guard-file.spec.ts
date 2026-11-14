// File rules for Read, Write and Edit: secret reads, append-only and idea records, sops, digests, thresholds, flags and guarded files. Rule units and verdict helpers are mocked; constants stay real.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { appendOnlyWarn, isAppendOnly } from "./guard-append-only.js";
import { checkDenyAudit } from "./guard-deny.js";
import {
  checkGuardrailDemotion,
  checkSettingsDenyRemoval,
} from "./guard-guardrails.js";
import { checkRulesetWeakening } from "./guard-ruleset.js";
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

vi.mock("./guard-append-only.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./guard-append-only.js")>()),
  appendOnlyWarn: vi.fn(),
  isAppendOnly: vi.fn(),
}));
vi.mock("./guard-deny.js", () => ({ checkDenyAudit: vi.fn() }));
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
// A features map is JSON-compatible YAML, so a flag is a quoted key inside braces.
const FLAG_ON = '"features": { "judge-merge": true }';

const hit = (rule: string, kind: "block" | "warn" = "block"): Hit => ({
  action: kind,
  rule,
  message: `[guard:${rule}] ${rule}`,
});

/** A context whose files are keyed by path relative to the root; a missing file rejects with ENOENT. */
function ctxWith(files: Record<string, string> = {}): GuardContext {
  return {
    root: ROOT,
    readFile: (path) => {
      const text = files[path.slice(`${ROOT}/`.length)];
      return text === undefined
        ? Promise.reject(Object.assign(new Error("ENOENT"), { code: "ENOENT" }))
        : Promise.resolve(text);
    },
    globMatches: () => Promise.resolve(false),
    modeOf: () => "enforce",
    denyRules: [],
  };
}

/** One file-rule check of a tool call against a context of the given files. */
const scan = (
  tool: string,
  input: Record<string, unknown>,
  path: string,
  files: Record<string, string> = {},
) => evaluateFile(tool, input, path, ctxWith(files));

beforeEach(() => {
  vi.mocked(applyMode).mockImplementation((finding: Finding) => finding);
  // A stand-in for weighing: the first finding that fires is the verdict; a warning names its rule.
  vi.mocked(weigh).mockImplementation((findings) => {
    const first = findings.find((finding): finding is Hit => finding !== null);
    if (first === undefined) {
      return allow;
    }
    return first.action === "warn" ? { ...first, rules: [first.rule] } : first;
  });
  vi.mocked(warn).mockImplementation((rule, message): Hit => ({
    action: "warn",
    rule,
    message: `[guard:${rule}] ${message}`,
  }));
  vi.mocked(block).mockImplementation((rule, message): Hit => ({
    action: "block",
    rule,
    message: `[guard:${rule}] ${message}`,
  }));
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
    expect(await scan("Read", {}, ".kore/keys/writer.pem")).toEqual(
      hit("secret-path"),
    );
    expect(secretBlock).toHaveBeenCalledTimes(1);
  });

  it("allows a read of an ordinary file, after the audit deny list is consulted", async () => {
    expect(await scan("Read", {}, "src/a.ts")).toEqual({ action: "allow" });
    expect(checkDenyAudit).toHaveBeenCalledWith(
      "Read",
      "src/a.ts",
      expect.anything(),
    );
    expect(loadSopsPatterns).not.toHaveBeenCalled();
  });
});

describe("evaluateFile: append-only and idea records", () => {
  it("warns on a write to an append-only record, through its mode", async () => {
    vi.mocked(isAppendOnly).mockReturnValue(true);
    vi.mocked(appendOnlyWarn).mockReturnValue(hit("append-only", "warn"));
    const edit = { old_string: "a", new_string: "b" };
    const verdict = await scan("Edit", edit, ".claude/evals/history.jsonl");
    expect(appendOnlyWarn).toHaveBeenCalledWith(".claude/evals/history.jsonl");
    expect(verdict).toEqual(hit("append-only", "warn"));
  });

  it("warns on an idea record that writes its outcome by hand, and not on one without an outcome", async () => {
    await scan(
      "Write",
      { content: "## Outcome\nconfirmed" },
      "docs/ideas/42.md",
    );
    expect(warn).toHaveBeenCalledWith(
      "idea-outcome",
      expect.stringContaining("docs/ideas/42.md is an idea record"),
    );
    vi.mocked(warn).mockClear();
    await scan("Write", { content: "# Summary\nplain" }, "docs/ideas/42.md");
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
    await scan(
      "Write",
      { content: "  image: ghcr.io/x/web:1.2" },
      "apps/web/d.yaml",
    );
    expect(warn).toHaveBeenCalledWith(
      "image-digest",
      expect.stringContaining("ghcr.io/x/web:1.2 is not pinned by digest"),
    );
    vi.mocked(warn).mockClear();
    await scan(
      "Write",
      { content: "  image: ghcr.io/x/web@sha256:abc" },
      "apps/web/d.yaml",
    );
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
  it("warns when an overlay turns on a flag that was off, with no previous file", async () => {
    await scan("Write", { content: FLAG_ON }, OVERLAY);
    expect(warn).toHaveBeenCalledWith(
      "flag-activation",
      expect.stringContaining("turns on flag judge-merge by hand"),
    );
  });

  it("stays silent when the flag was already on", async () => {
    await scan("Write", { content: FLAG_ON }, OVERLAY, { [OVERLAY]: FLAG_ON });
    expect(warn).not.toHaveBeenCalledWith("flag-activation", expect.anything());
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

  it("gives an unguarded file empty texts to the guarded checks", async () => {
    await scan("Write", { content: "x" }, "src/a.ts");
    expect(checkGuardrailDemotion).toHaveBeenCalledWith("src/a.ts", "", "");
    expect(checkRulesetWeakening).toHaveBeenCalledWith("src/a.ts", "", "");
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

  it("joins an audit warning onto a warning from the file rules, naming both rules", async () => {
    vi.mocked(checkDenyAudit).mockReturnValue([hit("audit-x", "warn")]);
    const verdict = await scan(
      "Write",
      { content: "  image: ghcr.io/x/web:1.2" },
      "apps/web/d.yaml",
    );
    expect(verdict).toMatchObject({
      action: "warn",
      rule: "image-digest",
      rules: ["image-digest", "audit-x"],
      message: expect.stringMatching(
        /ghcr\.io\/x\/web:1\.2 is not pinned.*\n\[guard:audit-x\] audit-x$/s,
      ),
    });
  });
});
