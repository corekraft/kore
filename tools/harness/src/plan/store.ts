import { join } from "node:path";
import type { CliDeps } from "../runtime/index.js";

export const PLANS_DIR = "infra/plans";

/** Every plan file under infra/plans, by file name; none when the directory is absent. */
export async function readPlans(
  deps: CliDeps,
): Promise<Record<string, string>> {
  const root = await deps.root();
  let names: string[];
  try {
    names = (await deps.fs.readdir(join(root, PLANS_DIR))).filter((n) =>
      n.endsWith(".md"),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {};
    }
    throw error;
  }
  const plans: Record<string, string> = {};
  for (const name of names) {
    plans[name] = await deps.fs.readFile(join(root, PLANS_DIR, name));
  }
  return plans;
}
