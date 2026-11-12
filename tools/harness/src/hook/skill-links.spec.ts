// Skill links: `skills/` is the single source, linked into each harness
// directory by a relative path so the links resolve in any clone.
// Plan: infra/plans/3-agent-harness.md (Step 9).

import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { run, type CliDeps } from "../cli/index.js";
import { testHarness } from "../cli/cli-support.js";
import { nodeFileSystem } from "../runtime/index.js";
import { FakeRunner } from "../runtime/runner-support.js";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const temps: string[] = [];
afterEach(() => {
  for (const dir of temps.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), "kore-links-"));
  temps.push(root);
  for (const dir of [
    "skills/tdd",
    "skills/adr",
    ".claude/skills",
    ".codex/skills",
  ]) {
    mkdirSync(join(root, dir), { recursive: true });
  }
  for (const skill of ["tdd", "adr"]) {
    writeFileSync(join(root, "skills", skill, "SKILL.md"), "---\n---\n");
  }
  return root;
}

async function hook(root: string, stdin = "") {
  let out = "";
  let err = "";
  const deps: CliDeps = {
    runner: new FakeRunner(),
    clock: { now: () => new Date(0) },
    fs: nodeFileSystem,
    env: {},
    cwd: root,
    root: () => Promise.resolve(root),
    ids: { next: () => "id-1" },
    stdin: () => Promise.resolve(stdin),
    stdout: (t) => (out += t),
    stderr: (t) => (err += t),
  };
  const code = await run(["hook", "skill-links"], deps);
  return { code, out, err };
}

const link = (root: string, harness: string, skill: string) =>
  symlinkSync(`../../skills/${skill}`, join(root, harness, "skills", skill));

describe("hook skill-links", () => {
  it("passes silently for every skill in the repository", async () => {
    expect(await hook(repo)).toEqual({ code: 0, out: "", err: "" });
  });

  it("ignores whatever JSON arrives on stdin", async () => {
    const root = fixture();
    for (const harness of [".claude", ".codex"]) {
      link(root, harness, "tdd");
      link(root, harness, "adr");
    }
    expect(await hook(root, '{"tool_name":"Bash"}')).toEqual({
      code: 0,
      out: "",
      err: "",
    });
  });
});

describe("hook skill-links reports", () => {
  it("a skill linked by an absolute path, with the fix", async () => {
    const root = fixture();
    for (const harness of [".claude", ".codex"]) {
      link(root, harness, "tdd");
      link(root, harness, "adr");
    }
    rmSync(join(root, ".codex/skills/adr"));
    symlinkSync(join(root, "skills/adr"), join(root, ".codex/skills/adr"));

    const result = await hook(root);
    expect(result.code).toBe(1);
    expect(result.err).toBe(
      ".codex/skills/adr links to an absolute path; relink it to ../../skills/adr\n",
    );
    expect(result.out).toBe("");
  });

  it("reports a skill missing from a harness, and not a complete harness", async () => {
    const root = fixture();
    link(root, ".claude", "tdd");
    link(root, ".claude", "adr");
    link(root, ".codex", "tdd");

    expect((await hook(root)).err).toBe(
      ".codex/skills/adr is missing; link it to ../../skills/adr\n",
    );
  });

  it("reports a link to the wrong skill", async () => {
    const root = fixture();
    for (const harness of [".claude", ".codex"]) {
      link(root, harness, "tdd");
    }
    link(root, ".claude", "adr");
    symlinkSync("../../skills/tdd", join(root, ".codex/skills/adr"));

    expect((await hook(root)).err).toBe(
      ".codex/skills/adr links to ../../skills/tdd; relink it to ../../skills/adr\n",
    );
  });

  it("reports a copied skill directory as not a link", async () => {
    const root = fixture();
    for (const harness of [".claude", ".codex"]) {
      link(root, harness, "tdd");
    }
    link(root, ".claude", "adr");
    cpSync(join(root, "skills/adr"), join(root, ".codex/skills/adr"), {
      recursive: true,
    });

    expect((await hook(root)).err).toBe(
      ".codex/skills/adr is a directory or file, not a link; replace it with a link to ../../skills/adr\n",
    );
  });

  it("needs no link for a skills/ directory without SKILL.md, such as bin", async () => {
    const root = fixture();
    mkdirSync(join(root, "skills/bin"));
    for (const harness of [".claude", ".codex"]) {
      link(root, harness, "tdd");
      link(root, harness, "adr");
    }

    expect((await hook(root)).code).toBe(0);
  });

  it("fails open, naming the hook, when it cannot read skills/", async () => {
    const root = mkdtempSync(join(tmpdir(), "kore-links-empty-"));
    temps.push(root);

    const result = await hook(root);
    expect(result.code).toBe(0);
    expect(result.err).toMatch(/^\[hook:skill-links\] failed open: /);
  });
});

describe("hook dispatcher", () => {
  it("names the valid hooks when the name is unknown", async () => {
    let err = "";
    const deps = {
      runner: new FakeRunner(),
      clock: { now: () => new Date(0) },
      fs: nodeFileSystem,
      env: {},
      cwd: "/",
      root: () => Promise.resolve("/"),
      ids: { next: () => "id-1" },
      stdin: () => Promise.resolve(""),
      stdout: () => undefined,
      stderr: (t: string) => (err += t),
    } satisfies CliDeps;

    const code = await run(["hook", "nope"], deps);

    expect(code).not.toBe(0);
    expect(err).toContain('Unknown command "nope" for domain "hook"');
    expect(err).toContain("Commands: skill-links.");
  });
});

describe("hook skill-links on a file system that cannot read links", () => {
  it("fails open, saying so", async () => {
    const h = testHarness();
    h.deps.fs = {
      ...h.deps.fs,
      readdir: () => Promise.resolve(["tdd"]),
      exists: () => Promise.resolve(true),
    };
    const code = await run(["hook", "skill-links"], h.deps);
    expect(code).toBe(0);
    expect(h.err()).toBe(
      "[hook:skill-links] failed open: This file system cannot read symbolic links.\n",
    );
  });
});
