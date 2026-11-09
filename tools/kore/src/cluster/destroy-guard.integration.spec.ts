import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { findRoot } from "../config/config.js";
import { loadRepository } from "../config/index.js";
import { CommandError, ProcessRunner } from "../runtime/index.js";
import { retainedResources } from "./index.js";

// Docs: infra/plans/2-implementation.md#step-10-storage-and-postgresql-platform-api
// Live and opt-in (`npm run test:integration:destroy-guard`): proves on the
// running local profile that `kore cluster destroy` refuses, and changes
// nothing, while retained data exists and no --purge-data is given. It labels
// one throwaway claim in its own namespace as retained, so the refusal does
// not depend on what else the profile holds, and removes it afterwards.
//
// Safety: it never passes --purge-data, and it runs the destroy command only
// after discovery has reported the throwaway claim, because a destroy with
// --yes on a profile with no retained data would delete the cluster.

const namespace = "kore-destroy-guard";
const claim = "retained-probe";
const cli = fileURLToPath(new URL("../cli/cli.js", import.meta.url));

type Repository = Awaited<ReturnType<typeof loadRepository>>;
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

test(
  "cluster destroy without --purge-data refuses while retained data exists and changes nothing",
  {
    concurrency: false,
    timeout: 10 * 60 * 1000,
    skip:
      process.env.KORE_RUN_INTEGRATION !== "1"
        ? "set KORE_RUN_INTEGRATION=1 to opt into a live local profile"
        : false,
  },
  async (t) => {
    const repository = await loadRepository("local", await findRoot());
    const runner = new ProcessRunner();
    const kubectl = kubectlFor(repository, runner);
    t.after(async () => {
      await kubectl([
        "delete",
        "namespace",
        namespace,
        "--ignore-not-found",
        "--wait",
        "--timeout=5m",
      ]).catch(() => undefined);
    });

    await createRetainedClaim(kubectl);
    // Precondition for everything below: discovery sees retained data.
    const retained = await retainedResources(repository, runner, namespace);
    assert.ok(
      retained.includes(`persistentvolumeclaim/${claim}`),
      `discovery must report the throwaway claim before any destroy is attempted: ${JSON.stringify(retained)}`,
    );
    const before = await snapshot(repository, runner, kubectl);
    assert.equal(before.host, "Running");

    // Both attempts omit --purge-data; the second adds --yes, the strongest
    // request that still must be refused.
    for (const flags of [[], ["--yes"]]) {
      await assert.rejects(
        runner.run(
          "node",
          [cli, "cluster", "destroy", "--environment", "local", ...flags],
          { capture: true },
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
  },
);
