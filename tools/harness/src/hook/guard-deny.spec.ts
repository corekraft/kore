// Audit deny rules: a warning per audit rule whose pattern covers the call. `denyMatches` and `warn` are mocked.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { denyMatches, type DenyRule } from "../guardrail/index.js";
import { checkDenyAudit } from "./guard-deny.js";
import { warn, type GuardContext, type Hit } from "./guard-verdict.js";

vi.mock("../guardrail/index.js", () => ({ denyMatches: vi.fn() }));
vi.mock("./guard-verdict.js");

const rule = (
  name: string,
  mode: DenyRule["mode"],
  patterns: string[],
): DenyRule => ({
  rule: name,
  mode,
  patterns,
});

/** A guard context whose only member the unit reads is the deny list; the rest is inert. */
const ctxWith = (denyRules: DenyRule[]): GuardContext => ({
  root: "/repo",
  readFile: () => Promise.reject(new Error("no file in this unit")),
  cwd: "/repo",
  home: "/home/test",
  globMatches: () => Promise.resolve(false),
  modeOf: () => "audit",
  denyRules,
});

beforeEach(() => {
  vi.mocked(warn).mockImplementation((name: string, message: string): Hit => ({
    action: "warn",
    rule: name,
    message,
  }));
  vi.mocked(denyMatches).mockReturnValue(false);
});

describe("checkDenyAudit", () => {
  it("warns once for an audit rule whose pattern covers the call, naming the subject and the pattern", () => {
    vi.mocked(denyMatches).mockImplementation(
      (pattern) => pattern === "Bash(rm -rf:*)",
    );
    const findings = checkDenyAudit(
      "Bash",
      "rm -rf /tmp/x",
      ctxWith([rule("no-rm", "audit", ["Bash(rm -rf:*)"])]),
    );
    expect(findings).toEqual([
      {
        action: "warn",
        rule: "no-rm",
        message: expect.stringContaining(
          "rm -rf /tmp/x matches the deny pattern Bash(rm -rf:*)",
        ),
      },
    ]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(vi.mocked(warn).mock.calls[0]?.[1]).toContain(
      "allowed with a warning",
    );
  });

  it("names only the first pattern that covers the call", () => {
    vi.mocked(denyMatches).mockReturnValue(true);
    checkDenyAudit(
      "Bash",
      "x",
      ctxWith([rule("r", "audit", ["Bash(a:*)", "Bash(b:*)"])]),
    );
    expect(vi.mocked(warn).mock.calls[0]?.[1]).toContain(
      "deny pattern Bash(a:*)",
    );
    expect(denyMatches).toHaveBeenCalledTimes(1);
  });

  it("ignores an enforce rule, which the settings deny list blocks instead", () => {
    vi.mocked(denyMatches).mockReturnValue(true);
    expect(
      checkDenyAudit("Bash", "x", ctxWith([rule("r", "enforce", ["Bash(x)"])])),
    ).toEqual([]);
    expect(denyMatches).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it("returns no finding when no audit pattern covers the call", () => {
    expect(
      checkDenyAudit(
        "Bash",
        "ls",
        ctxWith([rule("r", "audit", ["Bash(rm:*)"])]),
      ),
    ).toEqual([]);
    expect(denyMatches).toHaveBeenCalledWith("Bash(rm:*)", "Bash", "ls");
    expect(warn).not.toHaveBeenCalled();
  });
});
