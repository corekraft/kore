import { beforeEach, expect, test, vi } from "vitest";
import { dispatch } from "../src/cli/cli-dispatch.fixtures.js";

vi.mock("../src/app/index.js", async () =>
  (await import("../src/cli/cli-dispatch.fixtures.js")).appModule(),
);
vi.mock("../src/cluster/index.js", async () =>
  (await import("../src/cli/cli-dispatch.fixtures.js")).clusterModule(),
);
vi.mock("../src/config/index.js", async () =>
  (await import("../src/cli/cli-dispatch.fixtures.js")).configModule(),
);
vi.mock("../src/diagnostics/index.js", async () =>
  (await import("../src/cli/cli-dispatch.fixtures.js")).diagnosticsModule(),
);
vi.mock("../src/runtime/index.js", async () =>
  (await import("../src/cli/cli-dispatch.fixtures.js")).runtimeModule(),
);
vi.mock("../src/images/index.js", async () =>
  (await import("../src/cli/cli-dispatch.fixtures.js")).imagesModule(),
);
vi.mock("../src/platform/index.js", async () =>
  (await import("../src/cli/cli-dispatch.fixtures.js")).platformModule(),
);
vi.mock("../src/security/index.js", async () =>
  (await import("../src/cli/cli-dispatch.fixtures.js")).securityModule(),
);
vi.mock("../src/local/index.js", async () =>
  (await import("../src/cli/cli-dispatch.fixtures.js")).localModule(),
);

import { main } from "../src/cli/cli.js";

beforeEach(() => {
  dispatch.length = 0;
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
});

test("cluster CLI commands dispatch guarded mutations and destroy options", async () => {
  await main(["cluster", "up", "--environment", "local"]);
  await main(["cluster", "stop", "--environment", "local"]);
  await main([
    "cluster",
    "destroy",
    "--environment",
    "local",
    "--yes",
    "--purge-data",
  ]);

  expect(dispatch).toEqual([
    "lock",
    "journal:cluster up:k3d-kore-local",
    "clusterUp",
    "lock",
    "journal:cluster stop:k3d-kore-local",
    "clusterStop",
    "lock",
    "journal:cluster destroy:k3d-kore-local",
    "clusterDestroy:true:true",
  ]);
});

test("data CLI commands dispatch guarded export and restore", async () => {
  await main(["data", "export", "--environment", "local"]);
  await main([
    "data",
    "restore",
    "--environment",
    "local",
    "--from",
    "pg.sql.age",
    "--identity",
    "/k",
    "--overwrite-data",
    "--yes",
  ]);

  expect(dispatch).toEqual([
    "lock",
    "journal:data export:k3d-kore-local",
    "exportRetainedData:reference",
    "lock",
    "journal:data restore:k3d-kore-local",
    "restoreRetainedData:pg.sql.age:/k:true:true",
  ]);
});

test("platform CLI commands dispatch render and all lifecycle actions", async () => {
  await main([
    "platform",
    "render",
    "--environment",
    "local",
    "--output",
    "/tmp/render",
  ]);
  await main(["platform", "bootstrap", "--environment", "local"]);
  await main(["platform", "up", "--environment", "local"]);
  await main(["platform", "gate-check", "--environment", "local"]);
  await main(["platform", "stop", "--environment", "local"]);
  await main([
    "platform",
    "destroy",
    "--environment",
    "local",
    "--yes",
    "--purge-data",
  ]);

  expect(dispatch).toEqual([
    "platformRender",
    "lock",
    "journal:platform bootstrap:k3d-kore-local",
    "bootstrapControllers",
    "lock",
    "journal:platform up:k3d-kore-local",
    "platformUp",
    "lock",
    "journal:platform gate-check:k3d-kore-local",
    "closeGateIfDegraded",
    "lock",
    "journal:platform stop:k3d-kore-local",
    "platformStop",
    "lock",
    "journal:platform destroy:k3d-kore-local",
    "platformDestroy",
  ]);
});

test("application and local CLI commands dispatch deploy and teardown actions", async () => {
  await main(["app", "up", "reference", "--environment", "local"]);
  await main(["app", "down", "reference", "--environment", "local"]);
  await main(["local", "up", "--environment", "local"]);
  await main(["local", "down", "--environment", "local", "--prune"]);
  await main([
    "local",
    "down",
    "--environment",
    "local",
    "--prune",
    "--purge-data",
  ]);

  expect(dispatch).toEqual([
    "lock",
    "journal:app up reference:k3d-kore-local",
    "appUp",
    "lock",
    "journal:app down reference:k3d-kore-local",
    "appDown",
    "lock",
    "journal:local up:k3d-kore-local",
    "localUp",
    "lock",
    "journal:local down:k3d-kore-local",
    "localDown:true:false",
    "lock",
    "journal:local down:k3d-kore-local",
    "localDown:true:true",
  ]);
});

test("secret and trust CLI mutations dispatch their operations", async () => {
  await main(["secrets", "sync", "--environment", "local", "--json"]);
  await main(["trust", "install", "--environment", "local", "--json"]);

  expect(dispatch).toEqual([
    "lock",
    "journal:secrets sync:k3d-kore-local",
    "syncLocalSecrets",
    "lock",
    "journal:trust install:k3d-kore-local",
    "installLocalTrust",
  ]);
});

test("app down --json always reports the retained list, even when empty", async () => {
  const write = vi.spyOn(process.stdout, "write");

  await main(["app", "down", "reference", "--environment", "local", "--json"]);

  const printed = write.mock.calls.map(([chunk]) => String(chunk)).join("");
  expect(JSON.parse(printed)).toEqual({ name: "reference", retained: [] });
});

test("registry rotate-credentials is a locked, journaled mutation that carries the consent flag", async () => {
  await main([
    "registry",
    "rotate-credentials",
    "--environment",
    "local",
    "--yes",
    "--json",
  ]);

  expect(dispatch).toEqual([
    "lock",
    "journal:registry rotate-credentials:k3d-kore-local",
    "rotateRegistryCredentials:true",
  ]);
});

test("registry rotate-credentials without --yes still reaches the operation, which refuses", async () => {
  await main(["registry", "rotate-credentials", "--environment", "local"]);

  expect(dispatch).toContain("rotateRegistryCredentials:false");
});

test("signer swap-key is a locked, journaled mutation that carries the consent flag", async () => {
  await main([
    "signer",
    "swap-key",
    "--environment",
    "local",
    "--yes",
    "--json",
  ]);

  expect(dispatch).toEqual([
    "lock",
    "journal:signer swap-key:k3d-kore-local",
    "swapLocalSigningKey:true",
  ]);
});

test("signer swap-key without --yes still reaches the operation, which refuses", async () => {
  await main(["signer", "swap-key", "--environment", "local"]);

  expect(dispatch).toContain("swapLocalSigningKey:false");
});

test("platform gate-check fails naming the prerequisite after it closes the gate", async () => {
  const { closeGateIfDegraded } = await import("../src/platform/index.js");
  vi.mocked(closeGateIfDegraded).mockResolvedValueOnce({
    closed: true,
    failures: [
      {
        requirement: "telemetry",
        name: "otel-collector",
        status: "degraded",
        detail: "no available replica",
      },
    ],
    evidence: {
      failures: [
        {
          requirement: "telemetry",
          name: "otel-collector",
          detail: "no available replica",
        },
      ],
    },
  } as never);

  await expect(
    main(["platform", "gate-check", "--environment", "local"]),
  ).rejects.toThrow(
    /gate is closed.*telemetry: otel-collector \(no available replica\)/,
  );
});

test("platform gate-check requires an explicit environment", async () => {
  await expect(main(["platform", "gate-check"])).rejects.toThrow(
    /environment/i,
  );
});

test("app up hands the app domain no tunnel hook", async () => {
  const { appUpRelease } = await import("../src/app/index.js");
  await main(["app", "up", "reference", "--environment", "local"]);
  expect(vi.mocked(appUpRelease).mock.calls.at(-1)?.[4]).toBeUndefined();
});
