import { registryByName, registryHostname } from "../config/index.js";
import type { Repository } from "../config/index.js";
import { registryNameProblem } from "../images/index.js";
import type { Runner } from "../runtime/index.js";
import type { Check } from "./doctor.js";

// Docs: docs/decisions/0132-local-names-resolve-through-platform-dns-and-one-loopback-entry-point.md

/**
 * Read-only doctor check of the registry's name, only while registry-by-name is
 * on: the name must resolve and answer `/v2/` with the registry's own
 * certificate. It never fails doctor; a name that cannot be reached warns with
 * the cause and the fix, since the port-forward path is still there.
 */
export async function registryNameCheck(
  repository: Repository,
  runner: Runner,
): Promise<Check[]> {
  const { environment } = repository;
  if (!registryByName(environment)) {
    return [];
  }
  const base = { name: "registry:name", required: false } as const;
  try {
    const problem = await registryNameProblem(repository, runner);
    return [
      problem === undefined
        ? {
            ...base,
            status: "pass",
            message: `${registryHostname(environment)} answers /v2/ with the registry's own certificate`,
          }
        : { ...base, status: "warn", message: problem },
    ];
  } catch (error) {
    return [
      {
        ...base,
        status: "warn",
        message: error instanceof Error ? error.message : String(error),
      },
    ];
  }
}
