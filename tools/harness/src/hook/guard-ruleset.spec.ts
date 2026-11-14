// Declared rulesets: a weakened ruleset file warns, and a sync that changes the live ruleset warns. `weakenings` and `warn` are mocked.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { weakenings } from "../ruleset/index.js";
import {
  RULESET_FILE,
  checkRulesetSyncBash,
  checkRulesetWeakening,
} from "./guard-ruleset.js";
import { warn, type Hit } from "./guard-verdict.js";

vi.mock("../ruleset/index.js", () => ({ weakenings: vi.fn() }));
vi.mock("./guard-verdict.js", () => ({ warn: vi.fn() }));

const RULESET = ".github/rulesets/main.json";
const NO_CHANGE = { removed: [], weaker: [] };

beforeEach(() => {
  vi.mocked(warn).mockImplementation((rule: string, message: string): Hit => ({
    action: "warn",
    rule,
    message,
  }));
  vi.mocked(weakenings).mockReturnValue(NO_CHANGE);
});

describe("RULESET_FILE", () => {
  it("matches a ruleset file directly under .github/rulesets, and nothing deeper", () => {
    expect(RULESET_FILE.test(RULESET)).toBe(true);
    expect(RULESET_FILE.test(".github/rulesets/nested/main.json")).toBe(false);
    expect(RULESET_FILE.test("main.json")).toBe(false);
  });
});

describe("checkRulesetWeakening", () => {
  it("ignores a file that is not a ruleset, and a ruleset whose disk text is not JSON", () => {
    expect(checkRulesetWeakening("src/a.json", "{}", "{}")).toBeNull();
    expect(checkRulesetWeakening(RULESET, "not json", "{}")).toBeNull();
    expect(weakenings).not.toHaveBeenCalled();
  });

  it("stays silent when the change weakens nothing", () => {
    expect(checkRulesetWeakening(RULESET, "{}", "{}")).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  it("warns, naming each removed rule and each weaker parameter", () => {
    vi.mocked(weakenings).mockReturnValue({
      removed: ["pull_request"],
      weaker: ["required_approvals: 2 to 1"],
    });
    const finding = checkRulesetWeakening(
      RULESET,
      '{"rules": []}',
      '{"rules": []}',
    );
    expect(finding).toMatchObject({
      action: "warn",
      rule: "guardrail-demotion",
    });
    expect(warn).toHaveBeenCalledWith(
      "guardrail-demotion",
      expect.stringContaining(
        `${RULESET} weakens the declared ruleset by hand: rule pull_request is removed; required_approvals: 2 to 1.`,
      ),
    );
  });

  it("warns that the changed file cannot be checked when it is no longer a JSON object", () => {
    checkRulesetWeakening(RULESET, '{"rules": []}', "[1, 2]");
    expect(warn).toHaveBeenCalledWith(
      "guardrail-demotion",
      expect.stringContaining(
        "is no longer a JSON object, so its rules cannot be checked",
      ),
    );
    expect(weakenings).not.toHaveBeenCalled();
  });
});

describe("checkRulesetSyncBash", () => {
  it("warns when ruleset sync runs with --confirm, which changes the live ruleset", () => {
    expect(
      checkRulesetSyncBash("harness", [
        "ruleset",
        "sync",
        "--target",
        "main",
        "--confirm",
      ]),
    ).toMatchObject({
      rule: "guardrail-demotion",
    });
    expect(warn).toHaveBeenCalledWith(
      "guardrail-demotion",
      expect.stringContaining(
        "ruleset sync --confirm changes the live GitHub ruleset",
      ),
    );
  });

  it("stays silent for a dry run, or for another ruleset subcommand", () => {
    expect(
      checkRulesetSyncBash("harness", ["ruleset", "sync", "--dry-run"]),
    ).toBeNull();
    expect(
      checkRulesetSyncBash("harness", ["ruleset", "list", "--confirm"]),
    ).toBeNull();
    expect(checkRulesetSyncBash("ls", ["-la"])).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });
});
