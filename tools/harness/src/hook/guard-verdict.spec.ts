// Guard verdicts: block and warn hits, the mode step, and the weighing of findings. No dependencies to mock.

import { describe, expect, it } from "vitest";
import type { Mode } from "../guardrail/index.js";
import {
  allow,
  applyMode,
  block,
  warn,
  weigh,
  type Finding,
  type GuardContext,
} from "./guard-verdict.js";

/** A guard context whose only behaviour is each rule's mode; every other member is inert. */
const ctxWithModes = (modes: Record<string, Mode>): GuardContext => ({
  root: "/repo",
  readFile: () => Promise.reject(new Error("no file in this unit")),
  cwd: "/repo",
  home: "/home/test",
  globMatches: () => Promise.resolve(false),
  modeOf: (rule) => modes[rule] ?? "enforce",
  denyRules: [],
});

describe("block and warn", () => {
  it("prefix the message with the rule name, as a block and as a warning", () => {
    expect(block("secret-path", "read it by hand")).toEqual({
      action: "block",
      rule: "secret-path",
      message: "[guard:secret-path] read it by hand",
    });
    expect(warn("append-only", "edit by hand")).toEqual({
      action: "warn",
      rule: "append-only",
      message: "[guard:append-only] edit by hand",
    });
  });

  it("allows with an allow verdict that names no rule", () => {
    expect(allow).toEqual({ action: "allow" });
  });
});

describe("applyMode", () => {
  it("leaves no finding as no finding", () => {
    expect(applyMode(null, ctxWithModes({}))).toBeNull();
  });

  it("turns an audit rule's block into a warning, and keeps its rule and message", () => {
    const finding = block("append-only", "stop");
    expect(
      applyMode(finding, ctxWithModes({ "append-only": "audit" })),
    ).toEqual({
      action: "warn",
      rule: "append-only",
      message: "[guard:append-only] stop",
    });
  });

  it("keeps an enforced rule's warning as a block", () => {
    const finding = warn("sops-plaintext", "stop");
    expect(applyMode(finding, ctxWithModes({}))).toEqual({
      action: "block",
      rule: "sops-plaintext",
      message: "[guard:sops-plaintext] stop",
    });
  });
});

describe("weigh", () => {
  const first = block("secret-path", "one");
  const second = block("sops-plaintext", "two");
  const warning = (rule: string, message: string) => warn(rule, message);

  it("allows when no finding fires", () => {
    expect(weigh([])).toEqual(allow);
    expect(weigh([null, null])).toEqual(allow);
  });

  it("returns the first block, even past a warning, and joins nothing", () => {
    const findings: Finding[] = [warning("append-only", "w"), first, second];
    expect(weigh(findings)).toEqual(first);
  });

  it("joins every warning into one verdict, one line per rule, naming each rule", () => {
    const verdict = weigh([
      warning("append-only", "a"),
      null,
      warning("image-digest", "b"),
    ]);
    expect(verdict).toEqual({
      action: "warn",
      rule: "append-only",
      message: "[guard:append-only] a\n[guard:image-digest] b",
      rules: ["append-only", "image-digest"],
    });
  });

  it("keeps one warning per rule, the first one it sees", () => {
    const verdict = weigh([
      warning("append-only", "first"),
      warning("append-only", "second"),
    ]);
    expect(verdict.action).toBe("warn");
    expect(verdict).toMatchObject({
      message: "[guard:append-only] first",
      rules: ["append-only"],
    });
  });
});
