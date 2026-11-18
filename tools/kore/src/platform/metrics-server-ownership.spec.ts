import { expect, test } from "vitest";
import { assertMetricsServerUnowned } from "./metrics-server-ownership.js";
import { fakeRepository, fakeRunner } from "./platform-support.js";

const repository = fakeRepository();
const READ = [
  "--context",
  "k3d-kore-local",
  "get",
  "clusterrole",
  "system:metrics-server",
  "--ignore-not-found",
  "--output",
  'jsonpath={.metadata.name}{"|"}{.metadata.annotations.meta\\.helm\\.sh/release-name}',
];

test("a missing ClusterRole passes: the release will create it", async () => {
  const { runner, run } = fakeRunner(() => "");
  await expect(
    assertMetricsServerUnowned(repository, runner),
  ).resolves.toBeUndefined();
  expect(run).toHaveBeenCalledExactlyOnceWith("kubectl", READ, {
    capture: true,
  });
});

test("a ClusterRole the metrics-server release owns passes, so reruns are idempotent", async () => {
  const { runner } = fakeRunner(() => "system:metrics-server|metrics-server");
  await expect(
    assertMetricsServerUnowned(repository, runner),
  ).resolves.toBeUndefined();
});

test("a ClusterRole owned by the k3s add-on fails fast naming the cause and the one command, and mutates nothing", async () => {
  const { runner, run } = fakeRunner(() => "system:metrics-server|");
  await expect(assertMetricsServerUnowned(repository, runner)).rejects.toThrow(
    "ClusterRole system:metrics-server in k3d-kore-local is owned by the k3s bundled metrics-server add-on, so the metrics-server release cannot adopt it (one owner per resource); recreate the cluster with `kore local down --prune` then `kore local up` (retained data is kept)",
  );
  expect(run).toHaveBeenCalledTimes(1);
});
