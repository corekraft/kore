import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Repository } from "../config/index.js";
import { CommandError, type Runner } from "../runtime/index.js";

function isResourceTypeMissing(error: unknown): boolean {
  return /the server doesn't have a resource type/i.test(errorText(error));
}

function errorText(error: unknown): string {
  if (error instanceof CommandError) {
    return error.result.stderr;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export async function retainedResources(
  repository: Repository,
  runner: Runner,
  namespace?: string,
): Promise<string[]> {
  const context = repository.environment.kubeContext;
  const scope = namespace ? `--namespace=${namespace}` : "--all-namespaces";
  const queries = [
    [
      "--context",
      context,
      "get",
      "postgresqlinstances.platform.kore.dev",
      scope,
      "-l",
      "platform.kore.dev/retention=Retain",
      "-o",
      "name",
    ],
    [
      "--context",
      context,
      "get",
      "pvc",
      scope,
      "-l",
      "platform.kore.dev/retention=Retain",
      "-o",
      "name",
    ],
  ];
  const retained: string[] = [];
  for (const args of queries) {
    try {
      const result = await runner.run("kubectl", args, { capture: true });
      retained.push(
        ...result.stdout
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean),
      );
    } catch (error) {
      // An API that is not installed cannot contain retained data; any other
      // failure (unreachable cluster, wrong context) must refuse the destroy.
      if (!isResourceTypeMissing(error)) {
        throw error;
      }
    }
  }
  return [...new Set(retained)].sort();
}

export async function purgeRetainedResources(
  repository: Repository,
  runner: Runner,
): Promise<void> {
  const context = repository.environment.kubeContext;
  const selector = "platform.kore.dev/retention=Retain";
  for (const resource of ["postgresqlinstances.platform.kore.dev", "pvc"]) {
    try {
      await runner.run(
        "kubectl",
        [
          "--context",
          context,
          "delete",
          resource,
          "--all-namespaces",
          "--selector",
          selector,
          "--ignore-not-found",
          "--wait",
        ],
        { capture: true },
      );
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      if (
        !/doesn't have a resource type|the server doesn't have a resource type|no matches for kind/i.test(
          detail,
        )
      ) {
        throw error;
      }
    }
  }
}

export async function hasVerifiedExport(
  repository: Repository,
): Promise<boolean> {
  const directory = join(
    repository.root,
    ".kore",
    "exports",
    repository.environment.name,
  );
  try {
    const checksums = (await readdir(directory)).filter((entry) =>
      entry.endsWith(".sha256"),
    );
    for (const checksumFile of checksums) {
      const line = (
        await readFile(join(directory, checksumFile), "utf8")
      ).trim();
      const match = line.match(/^([a-f0-9]{64})(?:\s+\*?(.+))?$/i);
      if (!match) {
        continue;
      }
      const expected = match[1];
      if (!expected) {
        continue;
      }
      const exportName =
        match[2]?.trim() || checksumFile.slice(0, -".sha256".length);
      const contents = await readFile(join(directory, exportName));
      const actual = createHash("sha256").update(contents).digest("hex");
      if (actual.toLowerCase() === expected.toLowerCase()) {
        return true;
      }
    }
  } catch {
    return false;
  }
  return false;
}
