// The unit-spec check as a hook: `harness hook unit-specs --package tools/kore`.
// A converted source file must have exactly one unit spec beside it, named
// `<name>.spec.ts`: none fails, and so does a `<name>.test.ts` beside that one.
// "Converted" is what the budget means: no `unconverted.txt` names the file,
// read by the same helpers the budget reads (test-budget.ts). Live and docker
// specs are live tests, not unit specs. Support and fixture files are not
// units, so they need no spec (ADR 0098).
// Docs: infra/plans/14-test-tiers.md#step-1-foundations

import type { CliDeps } from "../runtime/index.js";
import { hookCommand, type HookResult } from "./io.js";
import { isListed, readLists } from "./test-budget.js";

/** Any `.ts` file that is a spec, not a source: unit, live, docker or test. */
const SPEC_OR_TYPES = /\.(spec|test)\.ts$|\.d\.ts$/;
/** Support and fixture files, by name: `<name>-support.ts`, `<name>-fixtures.ts` or `<name>.fixtures.ts`. */
const SUPPORT_OR_FIXTURE = /(-support|-fixtures|\.fixtures)\.ts$/;

const isSource = (name: string): boolean =>
  name.endsWith(".ts") &&
  !SPEC_OR_TYPES.test(name) &&
  !SUPPORT_OR_FIXTURE.test(name);

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

export const unitSpecsHook = hookCommand(
  "unit-specs",
  "fail a converted source file that has no spec beside it, or more than one; reads the unconverted lists the budget reads",
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
  },
);
