// The unit-spec check as a hook: `harness hook unit-specs --package tools/kore`.
// A converted source file must have exactly one unit spec beside it, named
// `<name>.spec.ts`: none fails, and so does a `<name>.test.ts` beside that one.
// "Converted" is what the budget means: no `unconverted.txt` names the file,
// read by the same helpers the budget reads (test-budget.ts). Live and docker
// specs are live tests, not unit specs. Support, fixture and live-helper files
// (`*.live.ts`) are not units, so they need no spec (ADR 0098).
// Docs: infra/plans/14-test-tiers.md#step-1-foundations

import type { CliDeps, CommandHelp } from "../runtime/index.js";
import { hookCommand, type HookResult } from "./io.js";
import { isListed, readLists } from "./test-budget.js";

/** Any `.ts` file that is a spec, not a source: unit, live, docker or test. */
const SPEC_OR_TYPES = /\.(spec|test)\.ts$|\.d\.ts$/;
/** Support and fixture files, by name: `<name>-support.ts`, `<name>-fixtures.ts` or `<name>.fixtures.ts`. */
const SUPPORT_OR_FIXTURE = /(-support|-fixtures|\.fixtures)\.ts$/;
/** A live helper: `<name>.live.ts`, imported only by live and opt-in suites, never by the unit run. */
const LIVE_HELPER = /\.live\.ts$/;

const isSource = (name: string): boolean =>
  name.endsWith(".ts") &&
  !SPEC_OR_TYPES.test(name) &&
  !SUPPORT_OR_FIXTURE.test(name) &&
  !LIVE_HELPER.test(name);

/** Every directory under `dir`, mapped to the names of the files directly in it. */
async function filesByDir(
  deps: CliDeps,
  dir: string,
  into: Map<string, string[]>,
): Promise<void> {
  const files: string[] = [];
  for (const name of await deps.fs.readdir(dir)) {
    const path = `${dir}/${name}`;
    if (await deps.fs.isDirectory(path)) {
      await filesByDir(deps, path, into);
    } else {
      files.push(name);
    }
  }
  into.set(dir, files);
}

async function check(deps: CliDeps, packageDir: string): Promise<HookResult> {
  const root = await deps.root();
  const srcDir = `${root}/${packageDir}/src`;
  const relative = (path: string) =>
    path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path;
  const lists = await readLists(deps, srcDir);
  const dirs = new Map<string, string[]>();
  await filesByDir(deps, srcDir, dirs);
  const problems: string[] = [];
  for (const [dir, names] of dirs) {
    for (const name of names.filter(isSource)) {
      const source = `${dir}/${name}`;
      if (isListed(lists, srcDir, source)) {
        continue;
      }
      const stem = name.slice(0, -".ts".length);
      const spec = `${stem}.spec.ts`;
      const test = `${stem}.test.ts`;
      if (!names.includes(spec)) {
        problems.push(
          `unit-specs: ${relative(source)} has no spec; add ${spec} beside it (ADR 0098)`,
        );
      } else if (names.includes(test)) {
        problems.push(
          `unit-specs: ${relative(source)} has two specs, ${spec} and ${test}; keep only ${spec} (ADR 0098)`,
        );
      }
    }
  }
  return problems.length === 0
    ? { code: 0 }
    : { code: 1, stderr: `${problems.join("\n")}\n` };
}

const unitSpecsHelp: CommandHelp = {
  purpose:
    "Checks that each converted source file under the package's src has exactly one unit spec beside it, named the same with .spec.ts. A file with no spec, or with a .test.ts beside its spec, fails and is named. Support, fixture and live-helper files need no spec.",
  when: "The package's test:specs script runs it after the unit run; run it by hand after adding a source file, to see whether that file needs a spec.",
  whenNot: "To check how long the tests take, use harness hook test-budget.",
  flags: {
    package:
      "The package directory from the repository root, such as tools/harness. Required: without it the hook exits 1.",
    strict:
      "Accepted for uniformity: a fault already exits 1 here, so --strict changes nothing.",
  },
  examples: [
    {
      command: "harness hook unit-specs --package tools/harness",
      shows:
        "nothing and exit 0 when every converted source file has its spec; otherwise each file that lacks one, with exit 1",
    },
    {
      command: "harness hook unit-specs",
      shows: "exit 1 with a usage line, since --package is missing",
    },
  ],
  exits: [
    {
      code: 0,
      meaning: "every converted source file has exactly one spec",
    },
    {
      code: 1,
      meaning:
        "a source file has no spec or two, --package is missing, or a fault; stderr names each",
    },
  ],
  effects: {
    kind: "read-only",
    detail:
      "reads the package's source tree and its unconverted lists; it writes nothing",
  },
  seeAlso: ["hook test-budget"],
};

export const unitSpecsHook = hookCommand(
  "unit-specs",
  "fail a converted source file with no spec beside it, or with two",
  ({ deps, options }) => {
    const packageDir = options["package"];
    if (typeof packageDir !== "string") {
      return Promise.resolve({
        code: 1,
        stderr: "unit-specs: pass --package <dir, such as tools/kore>\n",
      });
    }
    return check(deps, packageDir);
  },
  {
    flags: { package: "string" },
    payload: false,
    faultCode: 1,
    help: unitSpecsHelp,
  },
);
