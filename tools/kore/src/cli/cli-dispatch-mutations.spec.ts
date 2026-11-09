import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { dispatch } from "./cli-dispatch.fixtures.js";

vi.mock("../app/index.js", async () =>
  (await import("./cli-dispatch.fixtures.js")).appModule(),
);
vi.mock("../cluster/index.js", async () =>
  (await import("./cli-dispatch.fixtures.js")).clusterModule(),
);
vi.mock("../config/index.js", async () =>
  (await import("./cli-dispatch.fixtures.js")).configModule(),
);
vi.mock("../diagnostics/index.js", async () =>
  (await import("./cli-dispatch.fixtures.js")).diagnosticsModule(),
);
vi.mock("../runtime/index.js", async () =>
  (await import("./cli-dispatch.fixtures.js")).runtimeModule(),
);
vi.mock("../images/index.js", async () =>
  (await import("./cli-dispatch.fixtures.js")).imagesModule(),
);
vi.mock("../platform/index.js", async () =>
  (await import("./cli-dispatch.fixtures.js")).platformModule(),
);
vi.mock("../security/index.js", async () =>
  (await import("./cli-dispatch.fixtures.js")).securityModule(),
);
vi.mock("../tunnel/index.js", async () =>
  (await import("./cli-dispatch.fixtures.js")).tunnelModule(),
);
vi.mock("../local/index.js", async () =>
  (await import("./cli-dispatch.fixtures.js")).localModule(),
);

import { main } from "./cli.js";

beforeEach(() => {
  dispatch.length = 0;
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
});

afterEach(() => {
  vi.restoreAllMocks();
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
    "journal:cluster up:kore-local",
    "clusterUp",
    "lock",
    "journal:cluster stop:kore-local",
    "clusterStop",
    "lock",
    "journal:cluster destroy:kore-local",
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
    "journal:data export:kore-local",
    "exportRetainedData:reference",
    "lock",
    "journal:data restore:kore-local",
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
    "journal:platform bootstrap:kore-local",
    "bootstrapControllers",
    "lock",
    "journal:platform up:kore-local",
    "platformUp",
    "lock",
    "journal:platform gate-check:kore-local",
    "closeGateIfDegraded",
    "lock",
    "journal:platform stop:kore-local",
    "platformStop",
    "lock",
    "journal:platform destroy:kore-local",
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
    "journal:app up reference:kore-local",
    "appUp",
    "lock",
    "journal:app down reference:kore-local",
    "appDown",
    "lock",
    "journal:local up:kore-local",
    "localUp",
    "lock",
    "journal:local down:kore-local",
    "localDown:true:false",
    "lock",
    "journal:local down:kore-local",
    "localDown:true:true",
  ]);
});

test("tunnel, secret, and trust CLI mutations dispatch their operations", async () => {
  await main(["tunnel", "start", "--environment", "local", "--json"]);
  await main(["tunnel", "stop", "--environment", "local", "--json"]);
  await main(["secrets", "sync", "--environment", "local", "--json"]);
  await main(["trust", "install", "--environment", "local", "--json"]);

  expect(dispatch).toEqual([
    "lock",
    "journal:tunnel start:kore-local",
    "startLocalTunnel",
    "lock",
    "journal:tunnel stop:kore-local",
    "stopLocalTunnel",
    "lock",
    "journal:secrets sync:kore-local",
    "syncLocalSecrets",
    "lock",
    "journal:trust install:kore-local",
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
    "journal:registry rotate-credentials:kore-local",
    "rotateRegistryCredentials:true",
  ]);
});

test("registry rotate-credentials without --yes still reaches the operation, which refuses", async () => {
  await main(["registry", "rotate-credentials", "--environment", "local"]);

  expect(dispatch).toContain("rotateRegistryCredentials:false");
});

test("platform gate-check fails naming the prerequisite after it closes the gate", async () => {
  const { closeGateIfDegraded } = await import("../platform/index.js");
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

test("app up hands the app domain a hook that restores the tunnel", async () => {
  const { appUpRelease } = await import("../app/index.js");
  await main(["app", "up", "reference", "--environment", "local"]);
  const options = vi.mocked(appUpRelease).mock.calls.at(-1)?.[4] as
    { ensureTunnel: () => Promise<unknown> } | undefined;
  expect(dispatch).not.toContain("ensureLocalTunnel");
  await options?.ensureTunnel();
  expect(dispatch).toContain("ensureLocalTunnel");
});
