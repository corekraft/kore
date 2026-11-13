// `harness hook retro-scan`: the command line around the scan.
// Docs: infra/plans/5-self-maintenance.md#step-2-deterministic-retrospective-scan

import {
  mkdirSync,
  readFileSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { run } from "../cli/index.js";
import { testHarness } from "../cli/cli-support.js";
import { INVENTORY_PATH } from "../guardrail/index.js";
import { nodeFileSystem } from "../runtime/index.js";
import { fixtures } from "./retro-scan-support.js";

const temps: string[] = [];
afterEach(() => {
  for (const dir of temps.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

const temp = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "kore-retro-hook-"));
  temps.push(dir);
  return dir;
};

/** A repository root with skills, a guardrail inventory, and optionally a retrospective marker. */
function repoRoot(
  parts: { skills?: boolean; marker?: string; guard?: boolean } = {},
): string {
  const { skills = true, marker, guard = true } = parts;
  const root = temp();
  mkdirSync(join(root, "infra", "plans"), { recursive: true });
  if (guard) {
    mkdirSync(join(root, ".claude"), { recursive: true });
    const entry = (rule: string, mode: string) => ({
      rule,
      kind: "bash",
      mode,
      owner: "guard.ts",
    });
    writeFileSync(
      join(root, INVENTORY_PATH),
      JSON.stringify({
        guardrails: [
          entry("image-digest", "audit"),
          entry("sample-audit", "audit"),
          entry("unquoted-glob", "audit"),
          entry("enforced-rule", "enforce"),
        ],
      }),
    );
  }
  if (skills) {
    mkdirSync(join(root, "skills", "alpha-skill"), { recursive: true });
    writeFileSync(join(root, "skills", "alpha-skill", "SKILL.md"), "---\n");
    writeFileSync(join(root, "skills", "README.md"), "not a skill\n");
    // A folder without SKILL.md, like skills/bin, is not a skill.
    mkdirSync(join(root, "skills", "bin"), { recursive: true });
  }
  if (marker) {
    writeFileSync(
      join(root, "infra", "plans", "3-plan.md"),
      `Last retrospective: ${marker}\n`,
    );
  }
  return root;
}

async function retro(root: string, args: string[], home = temp()) {
  const h = testHarness({ env: { HOME: home } });
  h.deps.fs = nodeFileSystem;
  h.deps.root = () => Promise.resolve(root);
  h.deps.stdin = () => Promise.reject(new Error("stdin must not be read"));
  const code = await run(["hook", "retro-scan", ...args], h.deps);
  return { code, out: h.out(), err: h.err(), runner: h.runner };
}

describe("hook retro-scan", () => {
  it("prints exactly the report the .mjs printed on the fixtures, with and without --since", async () => {
    const root = repoRoot();
    const expected = (name: string) =>
      readFileSync(`${fixtures}${name}`, "utf8");
    expect((await retro(root, ["--dir", fixtures])).out).toBe(
      expected("expected-all.json"),
    );
    expect(
      (await retro(root, ["--dir", fixtures, "--since", "2026-11-01"])).out,
    ).toBe(expected("expected-since.json"));
  });

  it("scans a directory and prints JSON without user text", async () => {
    const result = await retro(repoRoot(), ["--dir", fixtures]);
    expect(result).toMatchObject({ code: 0, err: "" });
    const report = JSON.parse(result.out) as {
      since: unknown;
      sessions: { count: number };
      skills: { unused: string[] };
      rules: { audit: { rule: string }[] };
    };
    expect(report.sessions.count).toBe(3);
    expect(report.since).toBeNull();
    expect(report.skills.unused).toEqual(["alpha-skill"]);
    expect(report.rules.audit.map((r) => r.rule)).toEqual([
      "image-digest",
      "sample-audit",
      "unquoted-glob",
    ]);
    expect(result.out).not.toMatch(
      /push to the remote|widget tag|shared stash/,
    );
    expect(result.out.endsWith("}\n")).toBe(true);
  });

  it("applies --since to a directory", async () => {
    const result = await retro(repoRoot(), [
      "--dir",
      fixtures,
      "--since",
      "2026-11-01",
    ]);
    expect(result.code).toBe(0);
    expect(JSON.parse(result.out)).toMatchObject({
      since: "2026-11-01",
      sessions: { count: 2 },
    });
  });
});

describe("hook retro-scan usage", () => {
  it("accepts a UTC timestamp for --since and reports it back as given", async () => {
    const result = await retro(repoRoot(), [
      "--dir",
      fixtures,
      "--since",
      "2026-11-01T00:00:00Z",
    ]);
    expect(result.code).toBe(0);
    expect(JSON.parse(result.out)).toMatchObject({
      since: "2026-11-01T00:00:00Z",
      sessions: { count: 2 },
    });
  });

  it("rejects a timestamp that is not a real instant, with usage and exit 2", async () => {
    const result = await retro(repoRoot(), [
      "--dir",
      fixtures,
      "--since",
      "2026-02-30",
    ]);
    expect(result.code).toBe(2);
    expect(result.out).toBe("");
    expect(result.err).toMatch(/Usage: harness hook retro-scan/);
  });

  it("states both --since forms in the usage text", async () => {
    const result = await retro(repoRoot(), ["--since", "yesterday"]);
    expect(result.err).toBe(
      "Usage: harness hook retro-scan [--dir <transcripts>] [--since YYYY-MM-DD|YYYY-MM-DDTHH:MM:SSZ]\n--since keeps sessions active at or after local midnight of that date, or at or after that UTC instant, like the session-start count.\n",
    );
  });

  it("rejects a malformed --since with usage and exit 2", async () => {
    const result = await retro(repoRoot(), ["--since", "yesterday"]);
    expect(result.code).toBe(2);
    expect(result.out).toBe("");
    expect(result.err).toMatch(/Usage: harness hook retro-scan/);
  });

  it("exits 1, not 2, for an unknown flag, so a typo never blocks a session", async () => {
    const result = await retro(repoRoot(), ["--bogus"]);
    expect(result.code).toBe(1);
    expect(result.out).toBe("");
    expect(result.err).toMatch(/Unknown flag "--bogus"/);
  });

  it("names the directory it cannot read and exits 2", async () => {
    const result = await retro(repoRoot(), ["--dir", "/nonexistent-kore-dir"]);
    expect(result.code).toBe(2);
    expect(result.err).toMatch(
      /Cannot read transcripts in \/nonexistent-kore-dir\. Pass --dir/,
    );
  });

  it("exits 2 when the repository has no transcripts", async () => {
    const result = await retro(repoRoot(), []);
    expect(result.code).toBe(2);
    expect(result.err).toMatch(/No transcripts found for this repository/);
  });
});

describe("hook retro-scan defaults", () => {
  it("scans the repository's transcripts since the last retrospective by default", async () => {
    const root = repoRoot({ marker: "2026-11-01" });
    const home = temp();
    const dir = join(
      home,
      ".claude",
      "projects",
      root.replace(/[^a-zA-Z0-9]/g, "-"),
    );
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "new.jsonl"),
      `${JSON.stringify({ type: "user", timestamp: "2026-11-02T00:00:00.000Z" })}\n`,
    );
    writeFileSync(
      join(dir, "old.jsonl"),
      `${JSON.stringify({ type: "user", timestamp: "2026-10-02T00:00:00.000Z" })}\n`,
    );
    const result = await retro(root, [], home);
    expect(result.code).toBe(0);
    expect(result.err).toBe("");
    const report = JSON.parse(result.out) as {
      since: string;
      sessions: { list: { id: string }[] };
    };
    expect(report.since).toBe("2026-11-01");
    expect(report.sessions.list.map((s) => s.id)).toEqual(["new"]);
  });
});

describe("hook retro-scan warnings and faults", () => {
  it("says so on stderr when there is no marker or no skills directory, and still reports", async () => {
    const root = repoRoot({ skills: false });
    const home = temp();
    const dir = join(
      home,
      ".claude",
      "projects",
      root.replace(/[^a-zA-Z0-9]/g, "-"),
    );
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "s.jsonl"), "{}\n");
    const result = await retro(root, [], home);
    expect(result.code).toBe(0);
    expect(result.err).toBe(
      "No skills/ directory found; skills.unused will be empty.\n" +
        "No `Last retrospective:` date found; scanning all sessions. Pass --since to narrow.\n",
    );
    expect(JSON.parse(result.out)).toMatchObject({
      since: null,
      skills: { unused: [] },
    });
  });

  it("names the fix when the guardrail inventory is missing, and fails open without --strict", async () => {
    const result = await retro(repoRoot({ guard: false }), ["--dir", fixtures]);
    expect(result.code).toBe(0);
    expect(result.out).toBe("");
    expect(result.err).toMatch(
      /failed open: \.claude\/guardrails\.yaml is missing.*Restore it from git/,
    );
    expect(result.err).not.toMatch(/unexpected/);
  });

  it("exits 1 instead of failing open under --strict", async () => {
    const result = await retro(repoRoot({ guard: false }), [
      "--dir",
      fixtures,
      "--strict",
    ]);
    expect(result.code).toBe(1);
    expect(result.err).toMatch(
      /\[hook:retro-scan\] failed: \.claude\/guardrails\.yaml is missing/,
    );
  });
});
