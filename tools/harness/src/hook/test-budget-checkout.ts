// Which checkout the test-budget hook judges: the commit's own checkout, named by
// git for the working directory, and its unit report. The main root's report at
// the same place is read only when the commit's checkout has none (ADR 0098).
// Docs: infra/plans/14-test-tiers.md#step-1-foundations

import { mainRoot, type CliDeps } from "../runtime/index.js";
import type { BudgetReport } from "./test-budget-reporter.js";

/** The commit's checkout: git's top level for the working directory, not the bundle's root. */
export async function checkoutOf(deps: CliDeps): Promise<string> {
  const git = await deps.runner.run("git", ["rev-parse", "--show-toplevel"], {
    cwd: deps.cwd,
  });
  const top = git.stdout.trim();
  return git.code === 0 && top !== "" ? top : deps.root();
}

async function readIfPresent(
  deps: CliDeps,
  path: string,
): Promise<string | undefined> {
  try {
    return await deps.fs.readFile(path);
  } catch (error) {
    if ((error as { code?: unknown }).code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

/** The report and its checkout: the commit's own, else the main root's at the same path. */
export async function loadReport(
  deps: CliDeps,
  path: string,
  checkout: string,
  packageDir: string,
): Promise<{ root: string; report: BudgetReport } | string> {
  const own = await readIfPresent(deps, path);
  if (own !== undefined) {
    return { root: checkout, report: JSON.parse(own) as BudgetReport };
  }
  const inside = path.startsWith(`${checkout}/`)
    ? path.slice(checkout.length + 1)
    : undefined;
  if (inside !== undefined) {
    const main = await mainRoot(deps);
    if (main !== undefined && main !== checkout) {
      const text = await readIfPresent(deps, `${main}/${inside}`);
      if (text !== undefined) {
        return { root: main, report: JSON.parse(text) as BudgetReport };
      }
    }
  }
  return `test-budget: no unit report at ${path}; run \`npm run test:unit\` in ${packageDir}, which writes it before this check reads it`;
}
