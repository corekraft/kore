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

test("read-only CLI commands dispatch doctor, validation, and status", async () => {
  expect(await main(["validate", "--json"])).toBe(0);
  expect(await main(["doctor", "--json"])).toBe(0);
  expect(await main(["cluster", "status", "--json"])).toBe(0);
  expect(await main(["platform", "status", "--json"])).toBe(0);
  expect(await main(["app", "status", "reference", "--json"])).toBe(0);
  expect(dispatch).toEqual([
    "validatePortability",
    "doctor",
    "clusterStatus",
    "platformStatusReport",
    "appStatus",
  ]);
});

test("journal CLI command reads the journal without locking or mutating", async () => {
  const write = vi.spyOn(process.stdout, "write");
  expect(await main(["journal", "--environment", "local", "--json"])).toBe(0);
  expect(dispatch).toEqual(["readJournal"]);
  const output = JSON.parse(String(write.mock.calls[0]![0])) as {
    operations: { op: string; outcome: string }[];
    interrupted: number;
  };
  expect(output.interrupted).toBe(1);
  expect(output.operations.map((op) => op.outcome)).toEqual([
    "interrupted",
    "ok",
  ]);
});

test("journal CLI command limits output to the most recent operations", async () => {
  const write = vi.spyOn(process.stdout, "write");
  await main(["journal", "--limit", "1", "--json"]);
  const output = JSON.parse(String(write.mock.calls[0]![0])) as {
    operations: { op: string }[];
  };
  expect(output.operations.map((op) => op.op)).toEqual(["b"]);
  await expect(main(["journal", "--limit", "zero"])).rejects.toThrow(
    /--limit must be a positive integer/,
  );
});

test("read-only commands never open a journal entry", async () => {
  await main(["cluster", "status"]);
  await main(["platform", "render"]);
  await main(["doctor"]);
  expect(dispatch.some((item) => item.startsWith("journal:"))).toBe(false);
});

test("journal prints tab-separated lines and an interrupted notice without --json", async () => {
  const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
  expect(await main(["journal"])).toBe(0);
  expect(log.mock.calls.map((call) => call[0])).toEqual([
    "2026-11-07T10:00:00.000Z\tINTERRUPTED\tlocal up\t",
    "2026-11-07T10:01:00.000Z\tok\tcluster stop\t",
    "1 interrupted operation(s): rerun the command, it is idempotent.",
  ]);
});

test("plain output prints key-value pairs for objects and lines for lists", async () => {
  const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
  await main(["platform", "status"]);
  await main(["validate"]);
  expect(log.mock.calls.map((call) => call[0])).toEqual([
    "environment: local",
    "components: 1",
    'order: ["gateway"]',
    'applications: ["reference"]',
    "status: valid",
  ]);
});

test("platform status keeps the inventory in --json and drops it from plain rows", async () => {
  const { platformStatusReport } = await import("../src/platform/index.js");
  const rows = [
    {
      name: "image-inventory",
      namespace: "cluster",
      status: "ready",
      detail: "audit: 1 seed",
      inventory: { mode: "audit", images: [], unenrolledNamespaces: [] },
    },
  ];
  vi.mocked(platformStatusReport).mockResolvedValue(rows as never);
  const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
  const write = vi
    .spyOn(process.stdout, "write")
    .mockImplementation(() => true);

  await main(["platform", "status"]);
  await main(["platform", "status", "--json"]);

  expect(log.mock.calls.map((call) => call[0])).toEqual([
    "image-inventory\tcluster\tready\taudit: 1 seed",
  ]);
  expect(String(write.mock.calls[0]![0])).toContain('"inventory"');
});

test("help prints usage and exits 0 for no command, help, and --help", async () => {
  const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
  for (const argv of [[], ["help"], ["--help"]]) {
    expect(await main(argv)).toBe(0);
  }
  expect(log).toHaveBeenCalledTimes(3);
  expect(String(log.mock.calls[0]![0])).toContain("Usage:");
  expect(dispatch).toEqual([]);
});

test("unknown command error carries the usage text", async () => {
  await expect(main(["bogus"])).rejects.toThrow(/Usage:[\s\S]*kore journal/);
});

test("platform status exits non-zero while the gate or any prerequisite is not ready, so success cannot be reported early", async () => {
  const { platformStatusReport } = await import("../src/platform/index.js");
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  const row = (name: string, status: string) => ({
    name,
    namespace: "cluster",
    status,
    detail: "x",
  });

  vi.mocked(platformStatusReport).mockResolvedValue([
    row("gatekeeper", "ready"),
    row("application-admission-gate", "degraded"),
  ] as never);
  expect(await main(["platform", "status"])).toBe(1);

  vi.mocked(platformStatusReport).mockResolvedValue([
    row("gatekeeper", "degraded"),
    row("application-admission-gate", "ready"),
  ] as never);
  expect(await main(["platform", "status", "--json"])).toBe(1);

  // The CRD ownership row is an audit and never fails status.
  vi.mocked(platformStatusReport).mockResolvedValue([
    row("gatekeeper", "ready"),
    row("application-admission-gate", "ready"),
    row("crd-ownership", "degraded"),
  ] as never);
  expect(await main(["platform", "status"])).toBe(0);

  // A stale backup is an audit too: it never makes the platform unready.
  vi.mocked(platformStatusReport).mockResolvedValue([
    row("gatekeeper", "ready"),
    row("application-admission-gate", "ready"),
    row("backups", "degraded"),
  ] as never);
  expect(await main(["platform", "status"])).toBe(0);
});

test("platform status does not fail for a gated-off row, but still fails for a degraded one", async () => {
  const { platformStatusReport } = await import("../src/platform/index.js");
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  const row = (name: string, status: string) => ({
    name,
    namespace: "cluster",
    status,
    detail: "x",
  });
  vi.mocked(platformStatusReport).mockResolvedValue([
    row("gatekeeper", "ready"),
    row("agentgateway", "gated-off"),
  ] as never);
  expect(await main(["platform", "status"])).toBe(0);

  vi.mocked(platformStatusReport).mockResolvedValue([
    row("agentgateway", "gated-off"),
    row("gatekeeper", "degraded"),
  ] as never);
  expect(await main(["platform", "status"])).toBe(1);
});
