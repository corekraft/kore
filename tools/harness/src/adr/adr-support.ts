import type { CliDeps } from "../runtime/index.js";
import type { FileSystem } from "../runtime/index.js";
import { FakeRunner } from "../runtime/runner-support.js";

export const PLAN = "infra/plans/10-tools-first-skills.md";
export const ANCHOR = "step-1-adr-tool";

export const INDEX = [
  "# Index",
  "",
  "## Plans",
  "",
  `- [\`${PLAN}\`](../${PLAN}) — plan.`,
  "",
  "## Decisions",
  "",
  "- [`docs/decisions/0001-first.md`](decisions/0001-first.md) — first.",
  "- [`docs/decisions/0003-third.md`](decisions/0003-third.md) — third.",
  "",
  "## Operations",
  "",
].join("\n");

export function adrFile(n: string, slug: string): string {
  return [
    "---",
    "status: accepted",
    "summary: Existing.",
    "date: 2026-01-01",
    "last-verified: 2026-01-01",
    "---",
    "",
    `# ADR ${n}: ${slug}`,
    "",
  ].join("\n");
}

export const ROOT = "/repo";

/** In-memory files keyed by repo-relative path; every access must be under ROOT. */
export class MemoryFs implements FileSystem {
  readonly writes: string[] = [];
  constructor(readonly files: Map<string, string>) {}
  private rel(path: string): string {
    if (!path.startsWith(`${ROOT}/`)) {
      throw new Error(`path outside the repository root: ${path}`);
    }
    return path.slice(ROOT.length + 1);
  }
  readFile(path: string): Promise<string> {
    const text = this.files.get(this.rel(path));
    return text === undefined
      ? Promise.reject(new Error(`ENOENT ${path}`))
      : Promise.resolve(text);
  }
  writeFile(path: string, content: string): Promise<void> {
    this.writes.push(this.rel(path));
    this.files.set(this.rel(path), content);
    return Promise.resolve();
  }
  exists(path: string): Promise<boolean> {
    return Promise.resolve(this.files.has(this.rel(path)));
  }
  readdir(path: string): Promise<string[]> {
    const prefix = `${this.rel(path)}/`;
    return Promise.resolve(
      [...this.files.keys()]
        .filter((f) => f.startsWith(prefix))
        .map((f) => f.slice(prefix.length)),
    );
  }
}

export function fixture(extra: Record<string, string> = {}) {
  const fs = new MemoryFs(
    new Map([
      ["docs/index.md", INDEX],
      ["docs/decisions/0001-first.md", adrFile("0001", "first")],
      ["docs/decisions/0003-third.md", adrFile("0003", "third")],
      [
        PLAN,
        "---\nstatus: active\nsummary: Plan.\nlast-verified: 2026-01-01\n---\n\n# Plan\n\n## Step 1: ADR Tool\n",
      ],
      ...Object.entries(extra),
    ]),
  );
  const out: string[] = [];
  const err: string[] = [];
  const deps: CliDeps = {
    runner: new FakeRunner(),
    clock: { now: () => new Date(2026, 10, 11, 23, 59, 59) },
    root: () => Promise.resolve(ROOT),
    fs,
    stdout: (t) => out.push(t),
    stderr: (t) => err.push(t),
  };
  return { fs, deps, out: () => out.join(""), err: () => err.join("") };
}

export const NEW = [
  "adr",
  "new",
  "--title",
  "Harness tools Are Great!",
  "--summary",
  "Tools are great.",
  "--status",
  "proposed",
  "--source",
  `${PLAN}#${ANCHOR}`,
];
