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

test("read-only CLI commands dispatch doctor, validation, and status", async () => {
  expect(await main(["validate", "--json"])).toBe(0);
  expect(await main(["doctor", "--json"])).toBe(0);
  expect(await main(["cluster", "status", "--json"])).toBe(0);
  expect(await main(["platform", "status", "--json"])).toBe(0);
  expect(await main(["app", "status", "reference", "--json"])).toBe(0);
  expect(await main(["tunnel", "status", "--json"])).toBe(0);
  expect(dispatch).toEqual([
    "validatePortability",
    "doctor",
    "clusterStatus",
    "platformStatus",
    "appStatus",
    "tunnelStatus",
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
  await main(["tunnel", "status"]);
  await main(["platform", "status"]);
  await main(["validate"]);
  expect(log.mock.calls.map((call) => call[0])).toEqual([
    "status: running",
    "environment: local",
    "components: 1",
    'order: ["gateway"]',
    'applications: ["reference"]',
    "status: valid",
  ]);
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
