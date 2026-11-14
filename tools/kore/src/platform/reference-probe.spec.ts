// Docs: infra/plans/14-test-tiers.md#step-2-pilots
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { Repository } from "../config/index.js";
import type { Runner } from "../runtime/index.js";
import {
  meshProbePod,
  parseProbeOutcome,
  runMeshProbe,
  type MeshProbe,
} from "./reference-probe.js";

// Docs: docs/decisions/0007-workload-identity-and-layered-authorization.md

const PROBE: MeshProbe = {
  image: "10.96.0.50:5000/reference@sha256:" + "d".repeat(64),
  serviceAccount: "reference-denied",
  url: "http://reference.reference.svc.cluster.local/",
};
const SCOPE = ["--context", "k3d-kore-local", "--namespace", "reference"];
const repository = {
  environment: { kubeContext: "k3d-kore-local" },
} as unknown as Repository;

type Run = Runner["run"];

/** A typed runner whose reply depends on the verb; `failOn` names a verb that throws. */
function fakeRunner(logs: string, failOn?: string) {
  const run = vi.fn<Run>(async (_command, args) => {
    const verb =
      args.find(
        (arg) =>
          arg === "apply" ||
          arg === "wait" ||
          arg === "logs" ||
          arg === "delete",
      ) ?? "";
    if (verb === failOn) {
      throw new Error(`${verb} failed`);
    }
    return { stdout: verb === "logs" ? logs : "", stderr: "", code: 0 };
  });
  return { runner: { run } as Runner, run };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(1296);
});

afterEach(() => {
  vi.useRealTimers();
});

test("the probe pod runs the application's own image as the chosen ServiceAccount, never mounting a token", () => {
  const pod = meshProbePod({ ...PROBE, name: "kore-reference-probe-100" });

  expect(pod).toMatchObject({
    apiVersion: "v1",
    kind: "Pod",
    metadata: {
      name: "kore-reference-probe-100",
      labels: { "app.kubernetes.io/name": "kore-reference-probe" },
    },
    spec: {
      restartPolicy: "Never",
      serviceAccountName: "reference-denied",
      automountServiceAccountToken: false,
      containers: [{ name: "probe", image: PROBE.image }],
    },
  });
});

test("the probe pod runs as a non-root user with a read-only root and every capability dropped", () => {
  const pod = meshProbePod({ ...PROBE, name: "p" }) as {
    spec: { containers: { securityContext: unknown }[] };
  };

  expect(pod.spec.containers[0]?.securityContext).toEqual({
    allowPrivilegeEscalation: false,
    readOnlyRootFilesystem: true,
    runAsNonRoot: true,
    runAsUser: 1000,
    runAsGroup: 1000,
    capabilities: { drop: ["ALL"] },
  });
});

test("the probe pod fetches the URL and prints its status or its error, one line each", () => {
  const pod = meshProbePod({ ...PROBE, name: "p" }) as {
    spec: { containers: { command: string[] }[] };
  };

  expect(pod.spec.containers[0]?.command).toEqual([
    "node",
    "-e",
    `fetch("http://reference.reference.svc.cluster.local/").then((r) => console.log("STATUS " + r.status)).catch((e) => console.log("ERROR " + e.message))`,
  ]);
});

test("a STATUS line is the HTTP status the mesh answered with", () => {
  expect(parseProbeOutcome("STATUS 403\n")).toEqual({ status: 403 });
});

test("an ERROR line is the error the probe could not get past the mesh with", () => {
  expect(parseProbeOutcome("ERROR connect ECONNREFUSED 10.0.0.1:80\n")).toEqual(
    {
      error: "connect ECONNREFUSED 10.0.0.1:80",
    },
  );
});

test("the first result line wins, and surrounding whitespace on a line is ignored", () => {
  expect(parseProbeOutcome("  STATUS 200  \nSTATUS 403\n")).toEqual({
    status: 200,
  });
});

test("a probe that printed no result fails naming the output it did print", () => {
  expect(() => parseProbeOutcome("node: unexpected token\n")).toThrow(
    "the probe printed no result: node: unexpected token",
  );
});

test("a probe that printed nothing at all says so", () => {
  expect(() => parseProbeOutcome("  \n")).toThrow(
    "the probe printed no result: (no output)",
  );
});

test("a run applies the probe pod in the namespace, waits for it to succeed, reads its logs and returns the outcome", async () => {
  const { runner, run } = fakeRunner("STATUS 403\n");

  const outcome = await runMeshProbe(repository, runner, "reference", PROBE);

  expect(outcome).toEqual({ status: 403 });
  expect(run.mock.calls.map(([, args]) => args)).toEqual([
    [...SCOPE, "apply", "--filename=-"],
    [
      ...SCOPE,
      "wait",
      "--for=jsonpath={.status.phase}=Succeeded",
      "pod/kore-reference-probe-100",
      "--timeout=120s",
    ],
    [...SCOPE, "logs", "pod/kore-reference-probe-100"],
    [
      ...SCOPE,
      "delete",
      "pod/kore-reference-probe-100",
      "--ignore-not-found",
      "--wait=false",
    ],
  ]);
});

test("the pod is applied from stdin built from the same probe, under the clock's name", async () => {
  const { runner, run } = fakeRunner("STATUS 200\n");

  await runMeshProbe(repository, runner, "reference", PROBE);

  const applied = JSON.parse(String(run.mock.calls[0]?.[2]?.input)) as {
    metadata: { name: string };
    spec: { serviceAccountName: string };
  };
  expect(applied.metadata.name).toBe("kore-reference-probe-100");
  expect(applied.spec.serviceAccountName).toBe("reference-denied");
});

test("a probe whose pod fails to succeed is still deleted, and the wait's failure is what the run reports", async () => {
  const { runner, run } = fakeRunner("", "wait");

  await expect(
    runMeshProbe(repository, runner, "reference", PROBE),
  ).rejects.toThrow("wait failed");

  expect(run).toHaveBeenCalledTimes(3);
  expect(run.mock.calls.at(-1)?.[1]).toContain("delete");
});

test("a probe that prints no result is still deleted before its parse error is reported", async () => {
  const { runner, run } = fakeRunner("garbage\n");

  await expect(
    runMeshProbe(repository, runner, "reference", PROBE),
  ).rejects.toThrow("the probe printed no result: garbage");

  expect(run.mock.calls.at(-1)?.[1]).toContain("delete");
});
