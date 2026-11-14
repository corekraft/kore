// The kb-check report: the warn and --strict exit codes, the skill audit, and the stale and flag warnings.
// Docs: infra/plans/4-knowledge.md#step-3-knowledge-health-check
// Plan: infra/plans/8-harness-measurement.md#step-2-skill-budget-audit

import { beforeEach, expect, test, vi } from "vitest";
import { CommandError } from "../runtime/index.js";
import { fakeFinding } from "./kb-support.js";
import { findings } from "./findings.js";
import { format, run, type KbDeps } from "./report.js";
import { staleDocuments } from "./stale.js";

vi.mock("./findings.js", () => ({ findings: vi.fn() }));
vi.mock("./stale.js", () => ({ staleDocuments: vi.fn() }));

const broken = fakeFinding(
  "README.md",
  3,
  "link target missing.md does not exist",
  "point the link at an existing file or remove it",
);
const stale = {
  document: "infra/plans/1-a.md",
  verified: "2026-11-07",
  path: "skills/tdd/SKILL.md",
  date: "2026-11-12",
};
const AUDIT =
  "NAME   DESC  BODY  VERDICT\nbig      10    42  over-budget (body)\n";

function deps(overrides: Partial<KbDeps> = {}): KbDeps {
  return { files: () => [], read: () => null, ...overrides };
}

/** run() with its log lines collected, so a test asserts the whole output. */
async function runWith(argv: string[], overrides: Partial<KbDeps> = {}) {
  const log = vi.fn<(line: string) => void>();
  const status = await run(argv, deps(overrides), log);
  return { status, lines: log.mock.calls.map(([line]) => line) };
}

beforeEach(() => {
  vi.mocked(findings).mockReturnValue([]);
  vi.mocked(staleDocuments).mockResolvedValue([]);
});

test("a finding prints as file:line: message; fix", () => {
  expect(format(broken)).toBe(
    "README.md:3: link target missing.md does not exist; point the link at an existing file or remove it",
  );
});

test("a clean tree prints only the clean line and exits 0 in both modes", async () => {
  for (const argv of [[], ["--strict"]]) {
    expect(await runWith(argv)).toEqual({
      status: 0,
      lines: ["kb-check: clean"],
    });
  }
});

test("warn mode prints each finding and a warn summary, and exits 0", async () => {
  vi.mocked(findings).mockReturnValue([broken]);
  expect(await runWith([])).toEqual({
    status: 0,
    lines: [
      format(broken),
      "kb-check: 1 finding (warn mode; --strict fails on them)",
    ],
  });
});

test("--strict exits 1 on findings, and the count is plural for more than one", async () => {
  vi.mocked(findings).mockReturnValue([broken, broken]);
  expect(await runWith(["--strict"])).toEqual({
    status: 1,
    lines: [format(broken), format(broken), "kb-check: 2 findings"],
  });
});

test("repository problems are printed and counted with the findings", async () => {
  vi.mocked(findings).mockReturnValue([broken]);
  const { status, lines } = await runWith([], {
    repositoryProblems: () => Promise.resolve(["repo: broken"]),
  });
  expect(status).toBe(0);
  expect(lines).toEqual([
    format(broken),
    "repo: broken",
    "kb-check: 2 findings (warn mode; --strict fails on them)",
  ]);
});

test("staleness is printed as a warning, never fails --strict, and suppresses the clean line", async () => {
  vi.mocked(staleDocuments).mockResolvedValue([stale]);
  for (const argv of [[], ["--strict"]]) {
    expect(await runWith(argv)).toEqual({
      status: 0,
      lines: [
        "stale: infra/plans/1-a.md was last verified 2026-11-07, but skills/tdd/SKILL.md changed 2026-11-12; re-read it and update last-verified",
        "kb-check: 1 stale document (warn only)",
      ],
    });
  }
});

test("two stale documents are counted in the plural", async () => {
  vi.mocked(staleDocuments).mockResolvedValue([stale, stale]);
  const { lines } = await runWith([]);
  expect(lines.at(-1)).toBe("kb-check: 2 stale documents (warn only)");
});

test("findings come first, then stale, flags, the summary and its staleness note", async () => {
  vi.mocked(findings).mockReturnValue([broken]);
  vi.mocked(staleDocuments).mockResolvedValue([stale]);
  const { lines } = await runWith([], {
    flagAudit: () => Promise.resolve(["flag x is on"]),
  });
  expect(lines).toEqual([
    format(broken),
    expect.stringMatching(/^stale: /),
    "flag: flag x is on",
    "kb-check: 1 finding (warn mode; --strict fails on them)",
    "kb-check: 1 stale document (warn only)",
    "kb-check: 1 flag audit warning (warn only)",
  ]);
});

test("a flag on without proof is a warning that never fails --strict", async () => {
  const flagAudit = () =>
    Promise.resolve(["flag audit could not run (spawn failed)"]);
  expect(await runWith(["--strict"], { flagAudit })).toEqual({
    status: 0,
    lines: [
      "flag: flag audit could not run (spawn failed)",
      "kb-check: 1 flag audit warning (warn only)",
    ],
  });
});

test("two flag warnings are counted in the plural", async () => {
  const flagAudit = () => Promise.resolve(["a", "b"]);
  const { lines } = await runWith([], { flagAudit });
  expect(lines.at(-1)).toBe("kb-check: 2 flag audit warnings (warn only)");
});

test("the skill audit's report is printed after kb-check's own output", async () => {
  const audit = () => Promise.resolve({ text: `${AUDIT}\n`, failing: false });
  expect(await runWith([], { audit })).toEqual({
    status: 0,
    lines: [
      "kb-check: clean",
      "skill audit:",
      "  NAME   DESC  BODY  VERDICT",
      "  big      10    42  over-budget (body)",
    ],
  });
});

test("a skill over budget only warns in warn mode, and fails --strict", async () => {
  const audit = () => Promise.resolve({ text: AUDIT, failing: true });
  const warn = await runWith([], { audit });
  expect(warn.status).toBe(0);
  expect(warn.lines.at(-1)).toBe(
    "kb-check: skill audit failed (warn mode; --strict fails on it)",
  );
  const strict = await runWith(["--strict"], { audit });
  expect(strict.status).toBe(1);
  expect(strict.lines.at(-1)).toBe("kb-check: skill audit failed");
});

test("a failing skill audit keeps the findings' own exit code", async () => {
  vi.mocked(findings).mockReturnValue([broken]);
  const audit = () => Promise.resolve({ text: AUDIT, failing: false });
  expect((await runWith([], { audit })).status).toBe(0);
  expect((await runWith(["--strict"], { audit })).status).toBe(1);
});

test("an audit that cannot run is noted, fails --strict (fail closed), and only warns otherwise", async () => {
  const audit = () => Promise.reject(new CommandError("spawn failed"));
  expect(await runWith([], { audit })).toEqual({
    status: 0,
    lines: [
      "kb-check: clean",
      "skill audit: not run (spawn failed); run `node skills/bin/harness.mjs skill audit` to see the cause",
      "kb-check: skill audit failed (warn mode; --strict fails on it)",
    ],
  });
  expect((await runWith(["--strict"], { audit })).status).toBe(1);
});

test("an audit error that is not a command failure is rethrown, not reported", async () => {
  const audit = () => Promise.reject(new TypeError("bug"));
  await expect(runWith([], { audit })).rejects.toThrow("bug");
});
