import { run } from "../cli/index.js";
import type { CliDeps } from "../runtime/index.js";
import { MemoryFileSystem } from "../runtime/filesystem-support.js";
import { FakeRunner } from "../runtime/runner-support.js";

export const ROOT = "/repo";

export const INDEX = [
  "# Knowledge Index",
  "",
  "## Decisions",
  "",
  "- [`docs/decisions/0001-a.md`](decisions/0001-a.md) — decides A.",
  "",
  "## Operations and Guides",
  "",
  "- [`docs/guides/x.md`](guides/x.md) — a guide.",
  "",
].join("\n");

/** A fake repository at ROOT; `files` are keyed by repository-relative path. */
export function harness(
  files: Record<string, string> = { "docs/index.md": INDEX },
) {
  const fs = new MemoryFileSystem(
    ROOT,
    new Map(Object.entries(files).map(([k, v]) => [`${ROOT}/${k}`, v])),
  );
  const out: string[] = [];
  const err: string[] = [];
  const runner = new FakeRunner();
  const deps: CliDeps = {
    runner,
    clock: {
      now: () => new Date("2026-03-04T05:06:07.000Z"),
      sleep: () => Promise.resolve(),
    },
    root: () => Promise.resolve(ROOT),
    env: {},
    cwd: "/work/tree",
    ids: { next: () => "id-1" },
    stdin: () => Promise.resolve(""),
    fs,
    stdout: (text) => out.push(text),
    stderr: (text) => err.push(text),
  };
  const paths = () => [...fs.files.keys()].map((k) => k.slice(ROOT.length + 1));
  return {
    deps,
    runner,
    fs,
    out: () => out.join(""),
    err: () => err.join(""),
    get: (path: string) => fs.files.get(`${ROOT}/${path}`),
    set: (path: string, text: string) => fs.files.set(`${ROOT}/${path}`, text),
    paths,
    snapshot: () =>
      Object.fromEntries(paths().map((p) => [p, fs.files.get(`${ROOT}/${p}`)])),
  };
}

export const NEW = [
  "idea",
  "new",
  "--title",
  "Cache the probe results",
  "--hypothesis",
  "Caching probes cuts up time.",
  "--expected-outcome",
  "Up time drops by 20 percent.",
  "--measurement",
  "Compare kore local up duration in the ledger.",
  "--safety-pattern",
  "feature-flagged",
];

export async function seeded() {
  const h = harness();
  await run([...NEW, "--issue", "185"], h.deps);
  return h;
}

/** A hand-written idea file for tests that need one; override or drop frontmatter lines. */
export function ideaText(
  changes: Record<string, string | null> = {},
  title = "Done",
): string {
  const fields: Record<string, string | null> = {
    summary: title,
    hypothesis: "h",
    "expected-outcome": "e",
    measurement: "m",
    "safety-pattern": "dark-launched",
    date: "2026-01-01",
    ...changes,
  };
  const lines = Object.entries(fields)
    .filter(([, v]) => v !== null)
    .map(([k, v]) => `${k}: ${v}`);
  return ["---", ...lines, "---", "", "# Idea 0002: " + title, ""].join("\n");
}
