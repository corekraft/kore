// Fixtures shared by the judge command unit specs: typed data for the values a
// spec mocks. A support file is not a unit, so it needs no spec of its own (ADR 0098).
import { vi } from "vitest";
import { DEFAULT_COST, type parseHarnessConfig } from "../flow/index.js";
import type { PrView, Report } from "../judge/index.js";
import { contextWith } from "./command-support.js";

/** What a parsed harness config holds: the parser's result without its error branch. */
type HarnessConfig = Exclude<
  ReturnType<typeof parseHarnessConfig>,
  { error: string }
>;

export const ROOT = "/repo";
export const REPO = "corekraft/kore";
export const CLOCK = { now: () => new Date("2026-01-02T03:04:05Z") };
export const OK = { code: 0, stdout: "", stderr: "" };

/** A context for a judge command, with its output and its runner captured. */
export function contextOf(
  operand: string | undefined,
  options: Record<string, string | boolean> = {},
  json = false,
) {
  const stdout = vi.fn();
  const stderr = vi.fn();
  const run = vi.fn().mockResolvedValue(OK);
  const context = contextWith(
    {
      root: vi.fn().mockResolvedValue(ROOT),
      runner: { run },
      clock: CLOCK,
      stdout,
      stderr,
    },
    options,
    json,
    operand,
  );
  return { context, run, stdout, stderr };
}

/** A passing precheck verdict on PR #42 at head abc1234, with the given fields replaced. */
export function reportOf(overrides: Partial<Report> = {}): Report {
  return {
    pr: 42,
    ok: true,
    head: "abc1234",
    reviewers: [],
    pattern: undefined,
    idea: undefined,
    declaration: { ok: true },
    ...overrides,
  };
}

/** The PR as the judge reads it from GitHub, with the given fields replaced. */
export function prView(overrides: Partial<PrView> = {}): PrView {
  return {
    baseSha: "base1234",
    body: "",
    comments: [],
    headCommittedAt: undefined,
    headSha: "abcdef1234",
    rollup: [],
    ...overrides,
  };
}

/** A parsed harness config with the default cost settings, with the given fields replaced. */
export function harnessConfig(
  overrides: Partial<HarnessConfig> = {},
): HarnessConfig {
  return { cost: DEFAULT_COST, ...overrides };
}
