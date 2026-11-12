import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PLANS = "infra/plans";

/**
 * The repository root: CLAUDE_PROJECT_DIR when set, else two levels above the
 * bundle (skills/bin/harness.mjs). A root is valid when it holds infra/plans;
 * an invalid one is an error naming where it came from, never a silent
 * fallback, so a command never reports on the wrong directory.
 */
export async function resolveRoot(
  env: { CLAUDE_PROJECT_DIR?: string | undefined },
  moduleUrl: string,
  exists: (path: string) => Promise<boolean>,
): Promise<string> {
  const fromEnv = env.CLAUDE_PROJECT_DIR;
  if (fromEnv !== undefined && fromEnv !== "") {
    if (await exists(join(fromEnv, PLANS))) {
      return fromEnv;
    }
    throw new Error(
      `CLAUDE_PROJECT_DIR is "${fromEnv}" but it has no ${PLANS}. Point it at the repository root or unset it.`,
    );
  }
  const bundle = fileURLToPath(moduleUrl);
  const root = resolve(dirname(bundle), "../..");
  if (await exists(join(root, PLANS))) {
    return root;
  }
  throw new Error(
    `Cannot find the repo root: ${bundle} is not at <root>/skills/bin and CLAUDE_PROJECT_DIR is unset. Run the committed skills/bin/harness.mjs or set CLAUDE_PROJECT_DIR to the repository root.`,
  );
}
