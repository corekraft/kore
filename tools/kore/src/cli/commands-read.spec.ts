import { readFile } from "node:fs/promises";
import { beforeEach, expect, test, vi } from "vitest";
import {
  checkAppRecords,
  checkOrganizationRecords,
  featureEnabled,
  orderedComponents,
  platformClaimErrors,
} from "../config/index.js";
import type { Repository } from "../config/index.js";
import { managedLockErrors } from "../images/index.js";
import {
  doctor,
  doctorFailed,
  validatePortability,
} from "../diagnostics/index.js";
import { readJournal, summarizeOperations } from "../runtime/index.js";
import {
  doctorCommand,
  journalCommand,
  validateCommand,
} from "./commands-read.js";
import { stringFlag } from "./flags.js";
import { print } from "./output.js";
import { fakeContext, fakeRepository, sharedRunner } from "./cli-support.js";

vi.mock("node:fs/promises");
vi.mock("../config/index.js");
vi.mock("../images/index.js");
vi.mock("../diagnostics/index.js");
vi.mock("../runtime/index.js");
vi.mock("./flags.js");
vi.mock("./output.js");

const repository = fakeRepository({ name: "local" });
const runner = sharedRunner;

/** Two journal operations, the first interrupted. */
const operations = [
  {
    op: "a",
    command: "local up",
    ts: "2026-11-07T10:00:00.000Z",
    outcome: "interrupted",
  },
  {
    op: "b",
    command: "cluster stop",
    ts: "2026-11-07T10:01:00.000Z",
    outcome: "ok",
    error: "",
  },
];

beforeEach(() => {
  vi.mocked(orderedComponents).mockReturnValue([
    { name: "gateway" },
    { name: "registry" },
  ] as never);
  vi.mocked(validatePortability).mockResolvedValue({
    applications: ["reference"],
  } as never);
  vi.mocked(stringFlag).mockReturnValue(undefined);
  vi.mocked(summarizeOperations).mockReturnValue(operations as never);
  vi.mocked(readJournal).mockResolvedValue([] as never);
  vi.mocked(managedLockErrors).mockReturnValue([]);
  vi.mocked(checkAppRecords).mockResolvedValue({ errors: [], warnings: [] });
  vi.mocked(checkOrganizationRecords).mockResolvedValue({
    errors: [],
    organizations: [],
  });
});

test("validate passes --record-base to the app record check, and an app record error fails it", async () => {
  vi.mocked(stringFlag).mockImplementation((_parsed, name) =>
    name === "record-base" ? "origin/release" : undefined,
  );
  await validateCommand(fakeContext({ command: "validate", repository }));
  expect(checkAppRecords).toHaveBeenCalledWith(
    expect.objectContaining({
      environment: "local",
      recordBase: "origin/release",
      yqVersion: "4.54.2",
    }),
  );
  vi.mocked(checkAppRecords).mockResolvedValueOnce({
    errors: [
      "infra/environments/local/services/leads.json: spec.replicas is not a field of this record",
    ],
    warnings: [],
  });
  await expect(
    validateCommand(fakeContext({ command: "validate", repository })),
  ).rejects.toThrow(/spec\.replicas is not a field of this record/);
});

test("validate reports the environment's components in order and its applications, without reading any lock", async () => {
  const context = fakeContext({
    command: "validate",
    repository,
    runner,
    json: true,
  });
  expect(await validateCommand(context)).toBe(0);
  expect(orderedComponents).toHaveBeenCalledWith(repository.catalog);
  expect(print).toHaveBeenCalledWith(
    {
      environment: "local",
      components: 2,
      order: ["gateway", "registry"],
      applications: ["reference"],
      status: "valid",
    },
    true,
  );
  expect(readFile).not.toHaveBeenCalled();
});

test("validate carries warnings in the report and on stderr, and still exits 0", async () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
  const warned: Repository = {
    ...repository,
    warnings: ["policy x: namespace y is not listed"],
  };
  const context = fakeContext({
    command: "validate",
    repository: warned,
    json: true,
  });
  expect(await validateCommand(context)).toBe(0);
  expect(error.mock.calls).toEqual([
    ["warning: policy x: namespace y is not listed"],
  ]);
  expect(print).toHaveBeenCalledWith(
    {
      environment: "local",
      components: 2,
      order: ["gateway", "registry"],
      applications: ["reference"],
      status: "valid",
      warnings: ["policy x: namespace y is not listed"],
    },
    true,
  );
});

test("validate writes nothing to stderr and adds no warnings field when there are none", async () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
  await validateCommand(fakeContext({ command: "validate", repository }));
  expect(error).not.toHaveBeenCalled();
  expect(vi.mocked(print).mock.calls[0]?.[0]).not.toHaveProperty("warnings");
});

test("validate checks a --platform-image-lock against the environment before it reports valid", async () => {
  vi.mocked(stringFlag).mockReturnValue("lock.json");
  vi.mocked(readFile).mockResolvedValue('{"version":1}');
  await validateCommand(fakeContext({ command: "validate", repository }));
  expect(readFile).toHaveBeenCalledWith("lock.json", "utf8");
  expect(managedLockErrors).toHaveBeenCalledWith({ version: 1 }, repository);
  expect(print).toHaveBeenCalledWith(
    expect.objectContaining({ status: "valid" }),
    false,
  );
});

test("validate refuses a lock that does not match the environment, naming every problem, before it checks portability", async () => {
  vi.mocked(stringFlag).mockReturnValue("lock.json");
  vi.mocked(readFile).mockResolvedValue("{}");
  vi.mocked(managedLockErrors).mockReturnValue([
    "grafana: digest",
    "kong: digest",
  ]);
  await expect(
    validateCommand(fakeContext({ command: "validate", repository })),
  ).rejects.toThrow(
    "platform image lock lock.json does not match environment local:\ngrafana: digest\nkong: digest",
  );
  expect(validatePortability).not.toHaveBeenCalled();
});

test("validate names the file when the lock is not JSON", async () => {
  vi.mocked(stringFlag).mockReturnValue("lock.json");
  vi.mocked(readFile).mockResolvedValue("not json");
  await expect(
    validateCommand(fakeContext({ command: "validate", repository })),
  ).rejects.toThrow(
    /^--platform-image-lock lock\.json must be the platform-images\.lock\.json of a release: SyntaxError/,
  );
});

test("doctor prints every check and exits 1 when one failed", async () => {
  const checks = [{ name: "docker", status: "failed" }];
  vi.mocked(doctor).mockResolvedValue(checks as never);
  vi.mocked(doctorFailed).mockReturnValue(true);
  expect(
    await doctorCommand(
      fakeContext({ command: "doctor", repository, runner, json: true }),
    ),
  ).toBe(1);
  expect(doctor).toHaveBeenCalledWith(repository, runner);
  expect(print).toHaveBeenCalledWith(checks, true);
});

test("doctor exits 0 when no check failed", async () => {
  vi.mocked(doctor).mockResolvedValue([] as never);
  vi.mocked(doctorFailed).mockReturnValue(false);
  expect(await doctorCommand(fakeContext({ command: "doctor" }))).toBe(0);
});

test("journal reads the environment's journal and prints tab-separated lines and an interrupted notice", async () => {
  const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
  expect(
    await journalCommand(fakeContext({ command: "journal", repository })),
  ).toBe(0);
  expect(readJournal).toHaveBeenCalledWith("/repo", "local");
  expect(log.mock.calls.map((call) => call[0])).toEqual([
    "2026-11-07T10:00:00.000Z\tINTERRUPTED\tlocal up\t",
    "2026-11-07T10:01:00.000Z\tok\tcluster stop\t",
    "1 interrupted operation(s): rerun the command, it is idempotent.",
  ]);
  expect(print).not.toHaveBeenCalled();
});

test("journal --limit shows only the most recent operations, and counts interruptions among those", async () => {
  vi.mocked(stringFlag).mockReturnValue("1");
  await journalCommand(
    fakeContext({ command: "journal", repository, json: true }),
  );
  expect(print).toHaveBeenCalledWith(
    { environment: "local", operations: [operations[1]], interrupted: 0 },
    true,
  );
});

test("journal refuses a --limit that is not a positive whole number", async () => {
  for (const limit of ["0", "zero", "2.5", "-1"]) {
    vi.mocked(stringFlag).mockReturnValue(limit);
    await expect(
      journalCommand(fakeContext({ command: "journal" })),
    ).rejects.toThrow("--limit must be a positive integer");
  }
});

test("validate with --platform-claims and the organization-service-apis flag off warns, reads no claims file, and reports the claims as gated-off", async () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.mocked(stringFlag).mockImplementation((_args, name) =>
    name === "platform-claims" ? "claims.json" : undefined,
  );
  vi.mocked(featureEnabled).mockReturnValue(false);
  await validateCommand(
    fakeContext({ command: "validate", repository, json: true }),
  );
  expect(readFile).not.toHaveBeenCalled();
  expect(platformClaimErrors).not.toHaveBeenCalled();
  expect(error).toHaveBeenCalledWith(
    expect.stringContaining("--platform-claims skipped"),
  );
  expect(print).toHaveBeenCalledWith(
    expect.objectContaining({
      status: "valid",
      platformClaims: { status: "gated-off" },
    }),
    true,
  );
});

test("validate with the flag on checks every claim in --platform-claims and reports how many it checked", async () => {
  vi.mocked(stringFlag).mockImplementation((_args, name) =>
    name === "platform-claims" ? "claims.json" : undefined,
  );
  vi.mocked(featureEnabled).mockReturnValue(true);
  vi.mocked(readFile).mockResolvedValue(
    '[{"kind":"Service"},{"kind":"Organization"}]',
  );
  vi.mocked(platformClaimErrors).mockReturnValue([]);
  await validateCommand(
    fakeContext({ command: "validate", repository, json: true }),
  );
  expect(readFile).toHaveBeenCalledWith("claims.json", "utf8");
  expect(platformClaimErrors).toHaveBeenCalledWith([
    { kind: "Service" },
    { kind: "Organization" },
  ]);
  expect(print).toHaveBeenCalledWith(
    expect.objectContaining({
      status: "valid",
      platformClaims: { status: "valid", count: 2 },
    }),
    true,
  );
});

test("validate with the flag on refuses claims that break a rule, naming the file and every error, and reports nothing valid", async () => {
  vi.mocked(stringFlag).mockImplementation((_args, name) =>
    name === "platform-claims" ? "claims.json" : undefined,
  );
  vi.mocked(featureEnabled).mockReturnValue(true);
  vi.mocked(readFile).mockResolvedValue("[{}]");
  vi.mocked(platformClaimErrors).mockReturnValue([
    "claims[0].kind: missing; set it to Organization or Service",
  ]);
  await expect(
    validateCommand(fakeContext({ command: "validate", repository })),
  ).rejects.toThrow(
    "--platform-claims claims.json does not satisfy the platform API schema:\nclaims[0].kind: missing; set it to Organization or Service",
  );
  expect(print).not.toHaveBeenCalled();
});

test("validate names the file when --platform-claims is not JSON", async () => {
  vi.mocked(stringFlag).mockImplementation((_args, name) =>
    name === "platform-claims" ? "claims.json" : undefined,
  );
  vi.mocked(featureEnabled).mockReturnValue(true);
  vi.mocked(readFile).mockResolvedValue("not json");
  await expect(
    validateCommand(fakeContext({ command: "validate", repository })),
  ).rejects.toThrow(
    /^--platform-claims claims\.json must be a JSON array of claims: SyntaxError/,
  );
});
