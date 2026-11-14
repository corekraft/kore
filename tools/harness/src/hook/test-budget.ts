// The test budget as a hook: `harness hook test-budget --package tools/kore --report <report>`, the report the BudgetReporter writes.
// A unit test over 100 ms, a unit spec file over 1 s, or a package unit run
// over 20 s fails, naming what was slow. Only converted code is budgeted: each
// domain's `unconverted.txt` lists the source files not yet converted, one per
// line relative to the domain directory, and a file is converted unless a list
// names it. The 20 s limit applies once every list is empty (ADR 0098).
// Docs: infra/plans/14-test-tiers.md#step-1-foundations

import type { CliDeps } from "../runtime/index.js";
import { hookCommand, type HookResult } from "./io.js";
import type { BudgetReport } from "./test-budget-reporter.js";

const TEST_MS = 100;
const SPEC_MS = 1000;
const PACKAGE_MS = 20_000;
const SLOWEST = 10;
const LIST = "unconverted.txt";

type SpecResult = BudgetReport["files"][number];

/** The part of a spec's path that picks its list and its source file. */
interface Placement {
  /** The directory whose list names the source, relative to the package. */
  listDir: string;
  /** The source file relative to that directory. */
  entry: string;
}

const whole = (ms: number) => String(Math.round(ms));

/** The source file a spec tests, beside it: `x/y.spec.ts` tests `x/y.ts`. */
function sourceOf(spec: string): string | undefined {
  return spec.endsWith(".spec.ts")
    ? `${spec.slice(0, -".spec.ts".length)}.ts`
    : undefined;
}

/** Where a source file under srcDir is named: its domain's list and its path within the domain. */
function placement(source: string, srcDir: string): Placement | undefined {
  const inside = source.startsWith(`${srcDir}/`)
    ? source.slice(srcDir.length + 1)
    : undefined;
  if (inside === undefined) {
    return undefined;
  }
  const parts = inside.split("/");
  const name = parts.pop() ?? "";
  const [domain, ...rest] = parts;
  return domain === undefined
    ? { listDir: srcDir, entry: name }
    : { listDir: `${srcDir}/${domain}`, entry: [...rest, name].join("/") };
}

/**
 * Whether a list names the source file (an absolute path under srcDir). The
 * budget and the unit-spec check both read the lists through this.
 */
export function isListed(
  lists: Map<string, string[]>,
  srcDir: string,
  source: string,
): boolean {
  const where = placement(source, srcDir);
  return (
    where !== undefined &&
    (lists.get(`${where.listDir}/${LIST}`) ?? []).includes(where.entry)
  );
}

const entriesOf = (text: string): string[] =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"));

/** Every list under the package's src, by absolute list path, with its entries. */
export async function readLists(
  deps: CliDeps,
  srcDir: string,
): Promise<Map<string, string[]>> {
  const dirs = [srcDir];
  for (const name of await deps.fs.readdir(srcDir)) {
    if (await deps.fs.isDirectory(`${srcDir}/${name}`)) {
      dirs.push(`${srcDir}/${name}`);
    }
  }
  const lists = new Map<string, string[]>();
  for (const dir of dirs) {
    if (await deps.fs.exists(`${dir}/${LIST}`)) {
      lists.set(
        `${dir}/${LIST}`,
        entriesOf(await deps.fs.readFile(`${dir}/${LIST}`)),
      );
    }
  }
  return lists;
}

async function staleEntries(
  deps: CliDeps,
  lists: Map<string, string[]>,
  relative: (path: string) => string,
): Promise<string[]> {
  const problems: string[] = [];
  for (const [list, entries] of lists) {
    const dir = list.slice(0, -`/${LIST}`.length);
    for (const entry of entries) {
      if (!(await deps.fs.exists(`${dir}/${entry}`))) {
        problems.push(
          `test-budget: ${relative(list)} names ${entry}, which does not exist; remove the line`,
        );
      }
    }
  }
  return problems;
}

/** Whether the spec's source file exists and no list names it. */
async function isConverted(
  deps: CliDeps,
  lists: Map<string, string[]>,
  spec: string,
  srcDir: string,
): Promise<boolean> {
  const source = sourceOf(spec);
  if (
    source === undefined ||
    placement(source, srcDir) === undefined ||
    !(await deps.fs.exists(source))
  ) {
    return false;
  }
  return !isListed(lists, srcDir, source);
}

async function loadReport(
  deps: CliDeps,
  path: string,
  packageDir: string,
): Promise<BudgetReport | string> {
  let text: string;
  try {
    text = await deps.fs.readFile(path);
  } catch (error) {
    if ((error as { code?: unknown }).code !== "ENOENT") {
      throw error;
    }
    return `test-budget: no unit report at ${path}; run \`npm run test:unit\` in ${packageDir}, which writes it before this check reads it`;
  }
  return JSON.parse(text) as BudgetReport;
}

function slowestLines(
  results: SpecResult[],
  relative: (path: string) => string,
): string {
  const all = results.flatMap((spec) =>
    spec.tests.map((test) => ({
      ms: test.ms,
      label: `${relative(spec.name)} > ${test.name}`,
    })),
  );
  const top = all.sort((a, b) => b.ms - a.ms).slice(0, SLOWEST);
  return top.length === 0
    ? ""
    : `slowest tests:\n${top.map((t) => `${whole(t.ms).padStart(5)} ms  ${t.label}`).join("\n")}\n`;
}

function specProblems(spec: SpecResult, file: string): string[] {
  const problems: string[] = [];
  for (const test of spec.tests) {
    if (test.ms > TEST_MS) {
      problems.push(
        `test-budget: ${file} > ${test.name} took ${whole(test.ms)} ms, ${whole(test.ms - TEST_MS)} ms over the ${TEST_MS} ms test budget; mock what it imports and drop real timers and processes, so it tests one unit alone (ADR 0098)`,
      );
    }
  }
  if (spec.ms > SPEC_MS) {
    problems.push(
      `test-budget: ${file} took ${whole(spec.ms)} ms, ${whole(spec.ms - SPEC_MS)} ms over the ${SPEC_MS} ms spec file budget, import and collection included; mock what the file imports, or split the spec (ADR 0098)`,
    );
  }
  return problems;
}

function packageProblems(
  report: BudgetReport,
  lists: Map<string, string[]>,
  packageDir: string,
): string[] {
  const everyListEmpty = [...lists.values()].every((e) => e.length === 0);
  if (!everyListEmpty || report.files.length === 0) {
    return [];
  }
  const total = report.runMs;
  return total > PACKAGE_MS
    ? [
        `test-budget: the ${packageDir} unit run took ${whole(total)} ms, ${whole(total - PACKAGE_MS)} ms over the ${PACKAGE_MS} ms package budget, startup and global setup included; the slowest specs are printed above, so speed those up or split them (ADR 0098)`,
      ]
    : [];
}

async function check(
  deps: CliDeps,
  packageDir: string,
  reportPath: string,
): Promise<HookResult> {
  const root = await deps.root();
  const srcDir = `${root}/${packageDir}/src`;
  const relative = (path: string) =>
    path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path;
  const report = await loadReport(deps, reportPath, packageDir);
  if (typeof report === "string") {
    return { code: 1, stderr: `${report}\n` };
  }
  const results = report.files;
  const first = results[0];
  if (
    first !== undefined &&
    !results.some((spec) => spec.name.startsWith(`${srcDir}/`))
  ) {
    const seen = first.name.includes("/src/")
      ? first.name.slice(0, first.name.indexOf("/src/") + "/src".length)
      : first.name;
    return {
      code: 1,
      stderr: `test-budget: the report holds specs under ${seen}, but the repository root ${root} puts ${packageDir} at ${srcDir}; run the unit tests and this check from the same checkout\n`,
    };
  }
  const lists = await readLists(deps, srcDir);
  const problems = await staleEntries(deps, lists, relative);
  for (const spec of results) {
    if (await isConverted(deps, lists, spec.name, srcDir)) {
      problems.push(...specProblems(spec, relative(spec.name)));
    }
  }
  problems.push(...packageProblems(report, lists, packageDir));
  return {
    code: problems.length === 0 ? 0 : 1,
    stdout: slowestLines(results, relative),
    ...(problems.length === 0 ? {} : { stderr: `${problems.join("\n")}\n` }),
  };
}

export const testBudgetHook = hookCommand(
  "test-budget",
  "fail a unit run whose converted tests, spec files or package run break the speed budget; reads the report the unit run writes",
  ({ deps, options }) => {
    const packageDir = options["package"];
    const report = options["report"];
    if (typeof packageDir !== "string" || typeof report !== "string") {
      return Promise.resolve({
        code: 1,
        stderr:
          "test-budget: pass --package <dir, such as tools/kore> and --report <json file the unit run writes>\n",
      });
    }
    const absolute = report.startsWith("/") ? report : `${deps.cwd}/${report}`;
    return check(deps, packageDir, absolute);
  },
  {
    flags: { package: "string", report: "string" },
    payload: false,
    faultCode: 1,
  },
);
