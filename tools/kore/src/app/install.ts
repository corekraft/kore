import { access } from "node:fs/promises";
import { join } from "node:path";
import type { Repository } from "../config/index.js";
import type { LockedImage } from "../images/index.js";
import type { Runner } from "../runtime/index.js";
import { releaseArgs } from "./release.js";

async function chart(
  repository: Repository,
  name: string,
  kind: "resources" | "workload",
): Promise<string> {
  if (!/^[a-z0-9-]+$/.test(name)) {
    throw new Error(`invalid application name: ${name}`);
  }
  const path = join(repository.root, "apps", name, "charts", kind);
  await access(join(path, "Chart.yaml"));
  return path;
}

export interface Charts {
  resources: string;
  workload: string;
}

export async function resolveCharts(
  repository: Repository,
  name: string,
): Promise<Charts> {
  return {
    resources: await chart(repository, name, "resources"),
    workload: await chart(repository, name, "workload"),
  };
}

/**
 * `kore app up` is the single owner of an application namespace and its mesh
 * enrollment (ADR 0025). Helm's `--create-namespace` cannot label, so the
 * namespace is applied here and no release creates it.
 */
export async function enrollNamespace(
  repository: Repository,
  runner: Runner,
  name: string,
): Promise<void> {
  await runner.run(
    "kubectl",
    [
      "--context",
      repository.environment.kubeContext,
      "apply",
      "--server-side",
      "--field-manager=kore-app",
      "--filename",
      "-",
    ],
    {
      capture: true,
      input: `apiVersion: v1\nkind: Namespace\nmetadata:\n  name: ${name}\n  labels:\n    istio.io/dataplane-mode: ambient\n`,
    },
  );
}

export async function installResources(
  repository: Repository,
  runner: Runner,
  name: string,
  charts: Charts,
): Promise<void> {
  await runner.run(
    "helm",
    releaseArgs(repository, name, `${name}-resources`, charts.resources),
    { capture: false },
  );
}

export async function installWorkload(
  repository: Repository,
  runner: Runner,
  name: string,
  charts: Charts,
  image: LockedImage,
): Promise<void> {
  await runner.run(
    "helm",
    releaseArgs(repository, name, name, charts.workload, image),
    { capture: false },
  );
}
