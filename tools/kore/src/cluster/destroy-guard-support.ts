import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import type { Repository } from "../config/index.js";
import { CommandError, type ProcessRunner } from "../runtime/index.js";
import { retainedResources } from "./index.js";

// Docs: infra/plans/2-implementation.md#step-10-storage-and-postgresql-platform-api
// Shared by the live destroy-guard specs. It labels one throwaway claim in its
// own namespace as retained, so the refusal does not depend on what else the
// profile holds, runs `kore cluster destroy` and asserts it is refused with
// the cluster unchanged, then removes the claim.
//
// Safety: it never passes --purge-data, and it runs the destroy command only
// after discovery has reported the throwaway claim. A `--yes` destroy on a
// profile with no retained data would delete the cluster, so only a throwaway
// profile may be given `--yes` (see clean-machine.integration.spec.ts).

const namespace = "kore-destroy-guard";
const claim = "retained-probe";
const cli = fileURLToPath(new URL("../cli/cli.js", import.meta.url));

export interface GuardTarget {
  repository: Repository;
  runner: ProcessRunner;
  /** Flag sets to try, each without --purge-data. */
  flagSets: string[][];
  /** Where and how to run the CLI (the clean-machine stage sets KORE_ROOT). */
  spawn?: { cwd: string; env: NodeJS.ProcessEnv };
}

type Kubectl = (args: string[], input?: string) => Promise<string>;

function kubectlFor(repository: Repository, runner: ProcessRunner): Kubectl {
  return async (args, input) =>
    (
      await runner.run(
        "kubectl",
        ["--context", repository.environment.kubeContext, ...args],
        { capture: true, ...(input === undefined ? {} : { input }) },
      )
    ).stdout.trim();
}

async function createRetainedClaim(kubectl: Kubectl): Promise<void> {
  await kubectl(
    ["apply", "-f", "-"],
    [
      `apiVersion: v1\nkind: Namespace\nmetadata:\n  name: ${namespace}`,
      `apiVersion: v1\nkind: PersistentVolumeClaim\nmetadata:\n  name: ${claim}\n  namespace: ${namespace}\n  labels:\n    platform.kore.dev/retention: Retain\nspec:\n  accessModes: [ReadWriteOnce]\n  resources:\n    requests:\n      storage: 1Mi`,
    ].join("\n---\n"),
  );
}

async function hostState(
  repository: Repository,
  runner: ProcessRunner,
): Promise<string> {
  const profile = repository.environment.cluster.profile;
  try {
    const result = await runner.run(
      "minikube",
      ["status", "--profile", profile, "--format={{.Host}}"],
      { capture: true },
    );
    return result.stdout.trim();
  } catch (error) {
    return error instanceof CommandError ? error.result.stdout.trim() : "";
  }
}

async function snapshot(
  repository: Repository,
  runner: ProcessRunner,
  kubectl: Kubectl,
) {
  return {
    namespaces: await kubectl(["get", "namespaces", "--output=name"]),
    claim: await kubectl([
      "--namespace",
      namespace,
      "get",
      "pvc",
      claim,
      "--output=jsonpath={.metadata.uid}",
    ]),
    nodes: await kubectl(["get", "nodes", "--output=name"]),
    retained: await retainedResources(repository, runner),
    host: await hostState(repository, runner),
  };
}

function assertRefusal(error: unknown): boolean {
  assert.ok(error instanceof CommandError);
  const output = `${error.result.stderr}\n${error.result.stdout}`;
  assert.match(output, /destroy blocked by retained data/);
  assert.match(
    output,
    new RegExp(`persistentvolumeclaim/${claim}`),
    "the refusal names the retained claim",
  );
  assert.match(output, /--purge-data/);
  return true;
}

export async function proveDestroyRefused(target: GuardTarget): Promise<void> {
  const { repository, runner, flagSets, spawn } = target;
  assert.ok(
    flagSets.every((flags) => !flags.includes("--purge-data")),
    "the guard proof never purges data",
  );
  const kubectl = kubectlFor(repository, runner);
  try {
    await createRetainedClaim(kubectl);
    // Precondition for everything below: discovery sees retained data.
    const retained = await retainedResources(repository, runner, namespace);
    assert.ok(
      retained.includes(`persistentvolumeclaim/${claim}`),
      `discovery must report the throwaway claim before any destroy is attempted: ${JSON.stringify(retained)}`,
    );
    const before = await snapshot(repository, runner, kubectl);
    assert.equal(before.host, "Running");

    for (const flags of flagSets) {
      await assert.rejects(
        runner.run(
          "node",
          [
            cli,
            "cluster",
            "destroy",
            "--environment",
            repository.environment.name,
            ...flags,
          ],
          { capture: true, ...spawn },
        ),
        assertRefusal,
        `destroy ${flags.join(" ")} must be refused`,
      );
      assert.deepEqual(
        await snapshot(repository, runner, kubectl),
        before,
        "a refused destroy changes nothing",
      );
    }
  } finally {
    await kubectl([
      "delete",
      "namespace",
      namespace,
      "--ignore-not-found",
      "--wait",
      "--timeout=5m",
    ]).catch(() => undefined);
  }
}
