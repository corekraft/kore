import { expect, test } from "vitest";
import { loadRepository } from "../../src/config/index.js";
import {
  FakeRegistryCluster,
  hashLine,
  oldCredentials,
} from "./registry-rotation-support.js";
import { rotateRegistryCredentials } from "../../src/images/index.js";

const fast = { yes: true, sleep: async () => undefined, attempts: 5 };

test("rotation refuses without --yes and runs nothing", async () => {
  const repository = await loadRepository("local");
  const cluster = new FakeRegistryCluster(["reference"]);

  await expect(
    rotateRegistryCredentials(repository, cluster, { ...fast, yes: false }),
  ).rejects.toThrow(/--yes/);
  expect(cluster.calls).toEqual([]);
});

test("rotation replaces both passwords and every enrolled pull Secret, and the old ones stop working", async () => {
  const repository = await loadRepository("local");
  const cluster = new FakeRegistryCluster(["reference", "other"]);

  const result = await rotateRegistryCredentials(repository, cluster, fast);

  expect(result.namespaces).toEqual(["reference", "other"]);
  expect(cluster.currentPush.password).not.toBe(oldCredentials.push.password);
  expect(cluster.currentRead.password).not.toBe(oldCredentials.read.password);
  expect(cluster.currentPush.username).toBe("kore-push");
  for (const credential of cluster.pull.values()) {
    expect(credential).toEqual(cluster.currentRead);
  }
  expect(cluster.servedLines).toEqual([
    hashLine("kore-push", cluster.currentPush.password),
    hashLine(cluster.currentRead.username, cluster.currentRead.password),
  ]);
  expect(cluster.servedLines.join("\n")).not.toContain(
    hashLine("kore-read", oldCredentials.read.password),
  );
});

test("admission never loses signature access while rotating, even with a lagging proxy", async () => {
  const repository = await loadRepository("local");
  const cluster = new FakeRegistryCluster(["reference", "other"]);
  cluster.lag = 3;

  await rotateRegistryCredentials(repository, cluster, fast);

  expect(cluster.violations).toEqual([]);
});

test("pull Secrets change only after the proxy serves the new read credential", async () => {
  const repository = await loadRepository("local");
  const cluster = new FakeRegistryCluster(["reference"]);
  cluster.stuck = true;

  await expect(
    rotateRegistryCredentials(repository, cluster, { ...fast, attempts: 3 }),
  ).rejects.toThrow(/did not serve the new credentials/);
  expect(cluster.pull.get("reference")).toEqual(oldCredentials.read);
  expect(cluster.violations).toEqual([]);
});

test("an interrupted rotation resumes without stranding a namespace", async () => {
  const repository = await loadRepository("local");
  const cluster = new FakeRegistryCluster(["a", "b", "c"]);
  cluster.failPullApply = 2;

  await expect(
    rotateRegistryCredentials(repository, cluster, fast),
  ).rejects.toThrow(/apply failed/);
  cluster.failPullApply = undefined;
  await rotateRegistryCredentials(repository, cluster, fast);

  expect(cluster.violations).toEqual([]);
  for (const credential of cluster.pull.values()) {
    expect(credential).toEqual(cluster.currentRead);
  }
  expect(cluster.servedLines).toHaveLength(2);
});

test("passwords never reach argv and are redacted from errors", async () => {
  const repository = await loadRepository("local");
  const cluster = new FakeRegistryCluster(["a", "b"]);
  cluster.failPullApply = 1;

  const failure = await rotateRegistryCredentials(
    repository,
    cluster,
    fast,
  ).catch((error: Error) => error);

  const secrets = [
    cluster.currentPush.password,
    cluster.currentRead.password,
    oldCredentials.read.password,
  ];
  expect(failure).toBeInstanceOf(Error);
  const text = `${(failure as Error).message}${(failure as Error).stack ?? ""}`;
  for (const secret of secrets) {
    expect(text).not.toContain(secret);
  }
  const argv = JSON.stringify(cluster.calls.map((call) => call.args));
  for (const secret of secrets) {
    expect(argv).not.toContain(secret);
  }
});

test("the registry Secrets are applied through stdin, targeting the configured context", async () => {
  const repository = await loadRepository("local");
  const cluster = new FakeRegistryCluster(["a"]);

  await rotateRegistryCredentials(repository, cluster, fast);

  for (const call of cluster.calls) {
    expect(call.args.slice(0, 2)).toEqual([
      "--context",
      repository.environment.kubeContext,
    ]);
  }
  const applies = cluster.calls.filter((call) => call.args.includes("apply"));
  expect(applies.length).toBeGreaterThan(0);
  for (const apply of applies) {
    expect(apply.args).toContain("--filename=-");
  }
});

test("rotation refuses an environment whose registry credentials the provider owns", async () => {
  const repository = await loadRepository("managed-example");
  const cluster = new FakeRegistryCluster([]);

  await expect(
    rotateRegistryCredentials(repository, cluster, fast),
  ).rejects.toThrow(/provider/);
  expect(cluster.calls).toEqual([]);
});
