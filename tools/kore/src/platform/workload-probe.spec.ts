// Docs: infra/plans/14-test-tiers.md#step-2-pilots
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { Repository } from "../config/index.js";
import type { Runner } from "../runtime/index.js";
import { scope, verdictOf, type AdmissionVerdict } from "./admission-probe.js";
import { workloadVerdict } from "./workload-probe.js";

vi.mock("./admission-probe.js");

// Docs: docs/decisions/0072-constraint-promotion-procedure.md

const SOURCE = `10.96.0.50:5000/reference@sha256:${"c".repeat(64)}`;
const SCOPE = ["--context", "k3d-kore-local", "--namespace", "reference"];
const repository = {
  environment: { kubeContext: "k3d-kore-local" },
} as unknown as Repository;

const run = vi.fn<Runner["run"]>();
const runner = { run } as Runner;

/** The server's refusal, as the admission verdict reports it. */
function verdict(): AdmissionVerdict {
  return { admitted: false, detail: "denied" };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(0);
  vi.mocked(scope).mockReturnValue(SCOPE);
  vi.mocked(verdictOf).mockResolvedValue(verdict());
});

afterEach(() => {
  vi.useRealTimers();
});

/** The Deployment the probe sent to the server, parsed from the stdin it was given. */
function sentDeployment(): unknown {
  const [, , body] = vi.mocked(verdictOf).mock.calls[0] ?? [];
  return JSON.parse(String(body));
}

test("a workload verdict is the server's verdict on a Deployment dry-run in the namespace's scope", async () => {
  const result = await workloadVerdict(
    repository,
    runner,
    "reference",
    SOURCE,
    "default",
  );

  expect(scope).toHaveBeenCalledWith(repository, "reference");
  expect(verdictOf).toHaveBeenCalledWith(
    runner,
    [...SCOPE, "create", "--dry-run=server", "--filename=-"],
    expect.any(String),
  );
  expect(result).toEqual(verdict());
});

test("the probe Deployment runs the image as the named ServiceAccount, with no token mounted", async () => {
  await workloadVerdict(repository, runner, "reference", SOURCE, "default");

  expect(sentDeployment()).toEqual({
    apiVersion: "apps/v1",
    kind: "Deployment",
    metadata: { name: "kore-admission-probe-0" },
    spec: {
      replicas: 1,
      selector: {
        matchLabels: { "app.kubernetes.io/name": "kore-admission-probe-0" },
      },
      template: {
        metadata: {
          labels: { "app.kubernetes.io/name": "kore-admission-probe-0" },
        },
        spec: {
          serviceAccountName: "default",
          automountServiceAccountToken: false,
          containers: [{ name: "probe", image: SOURCE }],
        },
      },
    },
  });
});

test("the probe's name is the clock in base 36, so each probe run gets its own name", async () => {
  vi.setSystemTime(1296);

  await workloadVerdict(repository, runner, "reference", SOURCE, "default");

  expect(sentDeployment()).toMatchObject({
    metadata: { name: "kore-admission-probe-100" },
  });
});

test("the probe names the ServiceAccount it was given, and no other", async () => {
  await workloadVerdict(
    repository,
    runner,
    "reference",
    SOURCE,
    "reference-app",
  );

  expect(sentDeployment()).toMatchObject({
    spec: {
      template: { spec: { serviceAccountName: "reference-app" } },
    },
  });
});

test("the workload probe creates nothing itself: it hands the dry-run to the admission verdict and never calls the runner", async () => {
  await workloadVerdict(repository, runner, "reference", SOURCE, "default");

  expect(run).not.toHaveBeenCalled();
  expect(vi.mocked(verdictOf)).toHaveBeenCalledTimes(1);
});
