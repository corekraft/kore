import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { approvedImageList, loadRepository } from "../config/index.js";
import { recoverRelease } from "../platform/index.js";
import { ProcessRunner, liveEnvironment } from "../runtime/index.js";
import type { Repository } from "../config/index.js";

// Docs: docs/decisions/0063-lifecycle-resume-and-release-only-app-up.md
// Live: proves, on a running local profile (after `kore local up`), what the
// offline fakes cannot: that Helm accepts the recovery steps `recoverRelease`
// takes for a failed first install and for a canceled upgrade, and that the
// release is then gone or deployed. It installs a throwaway chart into its own
// namespace, uses only an image already approved in the catalog (the pod never
// schedules, so nothing is pulled), reads no Secret, passes --context from the
// repository, and removes the namespace afterwards.
// Run with: npm run test:live:lifecycle (sets KORE_RUN_LIVE=1).

const namespace = "kore-lifecycle-test";
const release = "lifecycle-probe";

const deployment = (image: string) => `apiVersion: apps/v1
kind: Deployment
metadata:
  name: probe
spec:
  replicas: 1
  selector:
    matchLabels: { app: probe }
  template:
    metadata:
      labels: { app: probe }
    spec:
      {{- if .Values.unschedulable }}
      nodeSelector:
        kore.test/never: "true"
      {{- end }}
      containers:
        - name: probe
          image: ${image}
`;

async function probeChart(image: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "kore-lifecycle-chart-"));
  await mkdir(join(directory, "templates"));
  await writeFile(
    join(directory, "Chart.yaml"),
    "apiVersion: v2\nname: lifecycle-probe\nversion: 0.0.1\n",
  );
  await writeFile(join(directory, "values.yaml"), "unschedulable: false\n");
  await writeFile(
    join(directory, "templates", "deployment.yaml"),
    deployment(image),
  );
  return directory;
}

function scope(repository: Repository): string[] {
  return [
    "--namespace",
    namespace,
    "--kube-context",
    repository.environment.kubeContext,
  ];
}

async function history(
  runner: ProcessRunner,
  repository: Repository,
): Promise<{ revision: number; status: string }[]> {
  try {
    const { stdout } = await runner.run(
      "helm",
      ["history", release, ...scope(repository), "--output", "json"],
      { capture: true },
    );
    return JSON.parse(stdout) as { revision: number; status: string }[];
  } catch {
    return [];
  }
}

interface Probe {
  repository: Repository;
  runner: ProcessRunner;
  target: { name: string; namespace: string; timeout: string };
  install: (...values: string[]) => string[];
}

const latest = async ({ runner, repository }: Probe) =>
  (await history(runner, repository)).at(-1)?.status;

async function failedFirstInstall(probe: Probe): Promise<void> {
  const { runner, repository, target, install } = probe;
  // A first install that cannot become ready fails and never deploys.
  await assert.rejects(
    runner.run(
      "helm",
      install("--set", "unschedulable=true", "--wait", "--timeout", "20s"),
      { capture: true },
    ),
  );
  assert.equal(await latest(probe), "failed");
  assert.equal(await recoverRelease(repository, runner, target), "uninstalled");
  assert.deepEqual(await history(runner, repository), []);
}

async function canceledUpgrade(probe: Probe): Promise<void> {
  const { runner, repository, target, install } = probe;
  // A canceled upgrade leaves pending-upgrade; recovery returns to the last
  // deployed revision without touching the healthy release.
  await runner.run("helm", install(), { capture: true });
  const upgrade = spawn(
    "helm",
    install("--set", "unschedulable=true", "--wait", "--timeout", "5m"),
    { stdio: "ignore" },
  );
  const deadline = Date.now() + 60_000;
  while ((await latest(probe)) !== "pending-upgrade" && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  upgrade.kill("SIGKILL");
  assert.equal(
    await latest(probe),
    "pending-upgrade",
    "the killed upgrade must leave a pending revision",
  );
  assert.equal(await recoverRelease(repository, runner, target), "rolled-back");
  assert.equal(await latest(probe), "deployed");
  // A rerun of the same change now proceeds instead of being refused.
  await runner.run("helm", install(), { capture: true });
}

test(
  "recovery of a failed first install and a canceled upgrade works against Helm",
  {
    concurrency: false,
    skip:
      process.env.KORE_RUN_LIVE !== "1"
        ? "set KORE_RUN_LIVE=1 to opt into a live platform"
        : false,
    timeout: 10 * 60 * 1000,
  },
  async () => {
    const repository = await loadRepository(liveEnvironment());
    const runner = new ProcessRunner();
    const image = approvedImageList(repository)[0]?.image;
    assert.ok(image, "the catalog approves at least one image");
    const chart = await probeChart(image);
    const kubectl = ["--context", repository.environment.kubeContext];
    const probe: Probe = {
      repository,
      runner,
      target: { name: release, namespace, timeout: "2m" },
      install: (...values) => [
        "upgrade",
        "--install",
        release,
        chart,
        ...scope(repository),
        ...values,
      ],
    };
    try {
      await runner.run(
        "kubectl",
        [...kubectl, "create", "namespace", namespace],
        { capture: true },
      );
      await failedFirstInstall(probe);
      await canceledUpgrade(probe);
    } finally {
      await rm(chart, { recursive: true, force: true });
      await runner
        .run(
          "kubectl",
          [
            ...kubectl,
            "delete",
            "namespace",
            namespace,
            "--ignore-not-found",
            "--wait=false",
          ],
          { capture: true },
        )
        .catch(() => undefined);
    }
  },
);
