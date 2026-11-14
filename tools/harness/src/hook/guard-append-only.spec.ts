// Append-only records: which paths a command rewrites, and the warning it raises. `warn` is mocked.

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  appendOnlyWarn,
  checkAppendOnly,
  isAppendOnly,
  writtenPath,
} from "./guard-append-only.js";
import { warn, type Hit } from "./guard-verdict.js";

vi.mock("./guard-verdict.js");

const LEDGER = ".kore/state/ledger.jsonl";
const HISTORY = ".claude/evals/history.jsonl";
const ROOT = "/repo";

beforeEach(() => {
  vi.mocked(warn).mockImplementation((rule: string, message: string): Hit => ({
    action: "warn",
    rule,
    message,
  }));
});

describe("isAppendOnly", () => {
  it("matches each append-only record, with or without a directory before it", () => {
    expect(isAppendOnly(HISTORY)).toBe(true);
    expect(isAppendOnly(`/repo/${LEDGER}`)).toBe(true);
    expect(isAppendOnly(".kore/state/journal/local.jsonl")).toBe(true);
    expect(isAppendOnly(`.kore/state/test-pass/${"a".repeat(40)}/x`)).toBe(
      true,
    );
  });

  it("does not match a record with a suffix, or an ordinary file", () => {
    expect(isAppendOnly(`${HISTORY}.bak`)).toBe(false);
    expect(isAppendOnly("docs/ledger.jsonl")).toBe(false);
  });
});

describe("appendOnlyWarn", () => {
  it("warns under the append-only rule, naming the path and the fix", () => {
    const finding = appendOnlyWarn(LEDGER);
    expect(finding).toMatchObject({ action: "warn", rule: "append-only" });
    expect(warn).toHaveBeenCalledWith(
      "append-only",
      expect.stringContaining(`${LEDGER} is an append-only record`),
    );
    expect(vi.mocked(warn).mock.calls[0]?.[1]).toContain(
      "Instead, append through",
    );
  });
});

describe("writtenPath", () => {
  it("finds the target of a truncating redirect, and no target for an append", () => {
    const matches = (path: string) => path === LEDGER;
    expect(
      writtenPath("echo", ["x"], ["echo", "x", `>${LEDGER}`], matches),
    ).toBe(LEDGER);
    expect(
      writtenPath("echo", ["x"], ["echo", "x", `>>${LEDGER}`], matches),
    ).toBeUndefined();
  });

  it("finds the operand that a rewriting command changes", () => {
    const matches = (path: string) => path === LEDGER;
    expect(writtenPath("sed", ["-i", "s/a/b/", LEDGER], [], matches)).toBe(
      LEDGER,
    );
    expect(writtenPath("mv", ["a", LEDGER], [], matches)).toBe(LEDGER);
    expect(writtenPath("cp", ["a", LEDGER], [], matches)).toBe(LEDGER);
    expect(writtenPath("tee", ["-a", LEDGER], [], matches)).toBeUndefined();
    expect(writtenPath("cat", [LEDGER], [], matches)).toBeUndefined();
  });
});

describe("checkAppendOnly", () => {
  it("warns when rm or mv removes a protected directory, with or without the repository prefix", () => {
    expect(
      checkAppendOnly("rm", ["-rf", ".kore/state/journal"], [], ROOT),
    ).toMatchObject({
      rule: "append-only",
    });
    expect(
      checkAppendOnly("mv", [`${ROOT}/.kore/state`, "x"], [], ROOT),
    ).toMatchObject({
      rule: "append-only",
    });
  });

  it("warns when a rewriting command targets a record, and names the record", () => {
    checkAppendOnly("sed", ["-i", "s/a/b/", LEDGER], [], ROOT);
    expect(warn).toHaveBeenCalledWith(
      "append-only",
      expect.stringContaining(LEDGER),
    );
  });

  it("stays silent for an unrelated command, and never warns for a directory outside the protected set", () => {
    expect(checkAppendOnly("rm", ["-rf", "src/build"], [], ROOT)).toBeNull();
    expect(checkAppendOnly("cat", [LEDGER], [], ROOT)).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });
});
