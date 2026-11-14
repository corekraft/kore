import { beforeEach, expect, test, vi } from "vitest";
import { appDown, appStatus, appUpRelease } from "../app/index.js";
import {
  clusterDestroy,
  clusterStatus,
  clusterStop,
  clusterUp,
  exportRetainedData,
  restoreRetainedData,
} from "../cluster/index.js";
import {
  bootstrapControllers,
  closeGateIfDegraded,
  platformDestroy,
  platformRender,
  platformStatusReport,
  platformStop,
  platformUp,
  readinessFailureSummary,
} from "../platform/index.js";
import {
  appCommand,
  clusterCommand,
  dataCommand,
  platformCommand,
} from "./commands-infra.js";
import {
  actionsOf,
  appContext,
  flags,
  platformStatusCases,
  renderCases,
  restoreCases,
} from "./commands-infra-support.js";
import { mutateAction } from "./context.js";
import { imageLockFlag } from "./image-lock-flag.js";
import { print } from "./output.js";
import {
  fakeContext,
  fakeRepository,
  parsedArgs,
  sharedRunner,
} from "./cli-support.js";

vi.mock("../app/index.js");
vi.mock("../cluster/index.js");
vi.mock("../platform/index.js");
vi.mock("./context.js");
vi.mock("./flags.js");
vi.mock("./image-lock-flag.js");
vi.mock("./output.js");

const repository = fakeRepository();
const runner = sharedRunner;

beforeEach(() => {
  flags({});
  vi.mocked(mutateAction).mockResolvedValue(0);
  vi.mocked(readinessFailureSummary).mockReturnValue("SUMMARY");
});

test("cluster status prints the cluster's status and mutates nothing", async () => {
  vi.mocked(clusterStatus).mockResolvedValue({ status: "running" } as never);
  const context = fakeContext({
    command: "cluster",
    action: "status",
    json: true,
  });
  expect(await clusterCommand(context)).toBe(0);
  expect(print).toHaveBeenCalledWith({ status: "running" }, true);
  expect(mutateAction).not.toHaveBeenCalled();
});

test("cluster up and stop run as environment mutations on their own handlers", async () => {
  const context = fakeContext({ command: "cluster", action: "up" });
  expect(await clusterCommand(context)).toBe(0);
  await actionsOf().up!(context, runner);
  await actionsOf().stop!(context, runner);
  expect(clusterUp).toHaveBeenCalledWith(repository, runner);
  expect(clusterStop).toHaveBeenCalledWith(repository, runner);
});

test("cluster destroy passes --yes, --purge-data and --force to the teardown", async () => {
  flags({ yes: true, "purge-data": true, force: true });
  await clusterCommand(fakeContext({ command: "cluster", action: "destroy" }));
  await actionsOf().destroy!(fakeContext(), runner);
  expect(clusterDestroy).toHaveBeenCalledWith(repository, runner, {
    yes: true,
    purgeData: true,
    force: true,
  });
});

test.each(platformStatusCases)("%s", async (_title, rows, exitCode) => {
  vi.mocked(platformStatusReport).mockResolvedValue(rows as never);
  const context = fakeContext({ command: "platform", action: "status" });
  expect(await platformCommand(context)).toBe(exitCode);
  expect(print).toHaveBeenCalledWith(rows, false);
});

test.each(renderCases)(
  "%s",
  async (_title, flagValues, directory, report, json) => {
    flags(flagValues);
    const context = fakeContext({
      command: "platform",
      action: "render",
      json,
    });
    expect(await platformCommand(context)).toBe(0);
    expect(platformRender).toHaveBeenCalledWith(repository, runner, directory);
    expect(print).toHaveBeenCalledWith(report, json);
  },
);

test("platform bootstrap and up run as environment mutations on their own handlers", async () => {
  const context = fakeContext({ command: "platform", action: "up" });
  await platformCommand(context);
  await actionsOf().bootstrap!(context, runner);
  await actionsOf().up!(context, runner);
  expect(bootstrapControllers).toHaveBeenCalledWith(repository, runner);
  expect(platformUp).toHaveBeenCalledWith(repository, runner);
});

test("platform stop passes --force to the stop and no retained-data option", async () => {
  flags({ force: true });
  await platformCommand(fakeContext({ command: "platform", action: "stop" }));
  await actionsOf().stop!(fakeContext(), runner);
  expect(platformStop).toHaveBeenCalledWith(
    repository,
    runner,
    {},
    { force: true },
  );
});

test("platform destroy passes --yes, --purge-data and --force to the teardown", async () => {
  flags({ yes: true, "purge-data": true });
  await platformCommand(
    fakeContext({ command: "platform", action: "destroy" }),
  );
  await actionsOf().destroy!(fakeContext(), runner);
  expect(platformDestroy).toHaveBeenCalledWith(repository, runner, {
    yes: true,
    purgeData: true,
    force: false,
  });
});

test("gate-check prints a healthy gate and does not throw when no prerequisite failed", async () => {
  vi.mocked(closeGateIfDegraded).mockResolvedValue({
    closed: false,
    failures: [],
    evidence: {},
  } as never);
  const context = fakeContext({
    command: "platform",
    action: "gate-check",
    json: true,
  });
  await platformCommand(context);
  await actionsOf()["gate-check"]!(context, runner);
  expect(print).toHaveBeenCalledWith(
    { gate: "healthy", closed: false, failures: [] },
    true,
  );
});

test("gate-check fails naming the failed prerequisites and how to recover, and leaves running workloads alone", async () => {
  const failures = [{ requirement: "r", name: "gateway", detail: "d" }];
  const evidence = { failures };
  vi.mocked(closeGateIfDegraded).mockResolvedValue({
    closed: true,
    failures,
    evidence,
  } as never);
  const context = fakeContext({ command: "platform", action: "gate-check" });
  await platformCommand(context);
  await expect(actionsOf()["gate-check"]!(context, runner)).rejects.toThrow(
    "the application admission gate is closed for new applications: SUMMARY. Running workloads are untouched; fix the prerequisite and run kore platform up",
  );
  expect(readinessFailureSummary).toHaveBeenCalledWith(evidence);
  expect(print).toHaveBeenCalledWith(
    { gate: "unhealthy", closed: true, failures },
    false,
  );
});

test("app commands refuse to run without an application name", async () => {
  const context = fakeContext({
    command: "app",
    action: "status",
    parsed: parsedArgs(),
  });
  await expect(appCommand(context)).rejects.toThrow(
    "application name is required",
  );
  expect(appStatus).not.toHaveBeenCalled();
});

test("app status prints the named application's status", async () => {
  vi.mocked(appStatus).mockResolvedValue({ status: "ready" } as never);
  expect(await appCommand(appContext("status", true))).toBe(0);
  expect(appStatus).toHaveBeenCalledWith(repository, runner, "reference");
  expect(print).toHaveBeenCalledWith({ status: "ready" }, true);
});

test("app up deploys the named release from its --image-lock, inside a mutation labelled with the application", async () => {
  vi.mocked(imageLockFlag).mockReturnValue("releases/images.lock.json");
  const context = appContext("up");
  await appCommand(context);
  expect(mutateAction).toHaveBeenCalledWith(
    expect.anything(),
    expect.any(Object),
    "app up reference",
  );
  await actionsOf().up!(context, runner);
  expect(imageLockFlag).toHaveBeenCalledWith(context.parsed, repository.root);
  expect(appUpRelease).toHaveBeenCalledWith(
    repository,
    runner,
    "reference",
    "releases/images.lock.json",
  );
});

test("app down writes each warning to stderr and prints what it retained", async () => {
  const stderr = vi
    .spyOn(process.stderr, "write")
    .mockImplementation(() => true);
  vi.mocked(appDown).mockResolvedValue({
    retained: ["pvc-1"],
    warnings: ["w1"],
  } as never);
  const context = appContext("down");
  await appCommand(context);
  await actionsOf().down!(context, runner);
  expect(stderr).toHaveBeenCalledWith("warning: w1\n");
  expect(print).toHaveBeenCalledWith(
    { name: "reference", retained: ["pvc-1"] },
    false,
  );
});

test("app down prints nothing in plain mode when it retained nothing", async () => {
  vi.mocked(appDown).mockResolvedValue({ retained: [], warnings: [] } as never);
  const context = appContext("down");
  await appCommand(context);
  await actionsOf().down!(context, runner);
  expect(print).not.toHaveBeenCalled();
});

test("app down in --json mode prints the report, and omits the warnings key when there are none", async () => {
  vi.mocked(appDown).mockResolvedValue({ retained: [], warnings: [] } as never);
  const context = appContext("down", true);
  await appCommand(context);
  await actionsOf().down!(context, runner);
  expect(print).toHaveBeenCalledWith({ name: "reference", retained: [] }, true);
});

test.each([
  ["reads from the reference namespace by default", undefined, "reference"],
  ["reads from the --namespace it is given", "orders", "orders"],
])("data export %s", async (_title, namespace, expected) => {
  flags(namespace === undefined ? {} : { namespace });
  await dataCommand(fakeContext({ command: "data", action: "export" }));
  await actionsOf().export!(fakeContext(), runner);
  expect(exportRetainedData).toHaveBeenCalledWith(repository, runner, {
    namespace: expected,
  });
});

test("data restore refuses to run without the artifact it restores from", async () => {
  await dataCommand(fakeContext({ command: "data", action: "restore" }));
  await expect(actionsOf().restore!(fakeContext(), runner)).rejects.toThrow(
    "data restore requires --from <artifact file name in .kore/exports/<environment>>",
  );
  expect(restoreRetainedData).not.toHaveBeenCalled();
});

test.each(restoreCases)(
  "data restore %s",
  async (_title, flagValues, expected) => {
    flags(flagValues);
    await dataCommand(fakeContext({ command: "data", action: "restore" }));
    await actionsOf().restore!(fakeContext(), runner);
    const options = vi.mocked(restoreRetainedData).mock.calls[0]![2];
    expect(options).toStrictEqual(expected);
  },
);
