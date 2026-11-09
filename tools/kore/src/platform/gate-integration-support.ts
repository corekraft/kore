import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { type Repository } from "../config/index.js";
import { CommandError, type Runner } from "../runtime/index.js";
import {
  admissionGate,
  admissionGateName,
  admissionGateResource,
} from "./admission-gate.js";
import { readinessEvidenceName } from "./readiness-manifest.js";

// Shared by gate.integration.spec.ts: the live proof helpers. Kept out of the
// spec so the spec stays within the max-lines rule; behaviour is unchanged.

export const developer = [
  "--as",
  "kore-gate-developer",
  "--as-group",
  "kore:developers",
];
export const bootstrap = [
  "--as",
  "kore-gate-bootstrap",
  "--as-group",
  "kore:bootstrap",
];
export const replicaSetController = [
  "--as",
  "system:serviceaccount:kube-system:replicaset-controller",
];
export const closedMessage = /application admission gate is closed/;
export const gateObject = `${admissionGateResource}/${admissionGateName}`;
export const evidenceObject = `configmaps/${readinessEvidenceName}`;
export const evidenceScope = ["-n", "kore-system"];

export interface Live {
  repository: Repository;
  runner: Runner;
}

export async function kubectl(
  { repository, runner }: Live,
  args: string[],
  input?: string,
): Promise<{ ok: boolean; output: string }> {
  try {
    const result = await runner.run(
      "kubectl",
      ["--context", repository.environment.kubeContext, ...args],
      { capture: true, ...(input === undefined ? {} : { input }) },
    );
    return { ok: true, output: result.stdout.trim() };
  } catch (error) {
    if (error instanceof CommandError) {
      return { ok: false, output: error.result.stderr.trim() };
    }
    throw error;
  }
}

export async function canI(
  cluster: Live,
  identity: string[],
  request: [verb: string, resource: string, ...scope: string[]],
): Promise<boolean> {
  const [verb, resource, ...scope] = request;
  const answer = await kubectl(cluster, [
    ...identity,
    "auth",
    "can-i",
    verb,
    resource,
    ...scope,
  ]);
  return answer.output.startsWith("yes");
}

export async function assertRbac(cluster: Live): Promise<void> {
  const denied: [string, string, ...string[]][] = [
    ["update", gateObject],
    ["patch", gateObject],
    ["delete", gateObject],
    ["create", admissionGateResource],
    ["patch", "namespaces"],
    ["update", evidenceObject, ...evidenceScope],
    ["patch", evidenceObject, ...evidenceScope],
    ["create", "clusterrolebindings"],
    ["update", "validatingwebhookconfigurations"],
  ];
  for (const request of denied) {
    assert.equal(
      await canI(cluster, developer, request),
      false,
      `a developer must not be able to ${request.join(" ")}`,
    );
  }
  const allowed: [string, string, ...string[]][] = [
    ["patch", gateObject],
    ["patch", evidenceObject, ...evidenceScope],
    ["patch", "namespaces"],
  ];
  for (const request of allowed) {
    assert.equal(
      await canI(cluster, bootstrap, request),
      true,
      `bootstrap automation must be able to ${request.join(" ")}`,
    );
  }
  assert.equal(
    await canI(cluster, bootstrap, [
      "delete",
      evidenceObject,
      ...evidenceScope,
    ]),
    false,
    "nobody is granted delete on the readiness evidence",
  );
}

export function workload(
  namespace: string,
  image: string,
  kind: "Pod" | "Deployment",
) {
  const container = { name: "probe", image };
  const metadata = { name: "probe", namespace };
  return JSON.stringify(
    kind === "Pod"
      ? { apiVersion: "v1", kind, metadata, spec: { containers: [container] } }
      : {
          apiVersion: "apps/v1",
          kind,
          metadata,
          spec: {
            replicas: 0,
            selector: { matchLabels: { app: "probe" } },
            template: {
              metadata: { labels: { app: "probe" } },
              spec: { containers: [container] },
            },
          },
        },
  );
}

export interface Proof {
  cluster: Live;
  namespace: string;
  constraint: string;
  image: string;
}

export function proofConstraint(
  proof: Proof,
  state: "closed" | "open",
): string {
  const gate = admissionGate(proof.cluster.repository, state);
  return JSON.stringify({
    ...gate,
    metadata: { name: proof.constraint },
    spec: {
      ...gate.spec,
      enforcementAction: "deny",
      match: { ...gate.spec.match, namespaces: [proof.namespace] },
      // A generation no platform namespace shares, so the proof namespace is
      // never exempt.
      parameters: { ...gate.spec.parameters, generation: "g-proofproof00" },
    },
  });
}

export async function setProofGate(
  proof: Proof,
  state: "closed" | "open",
): Promise<void> {
  const result = await kubectl(
    proof.cluster,
    [
      ...bootstrap,
      "apply",
      "--server-side",
      "--field-manager=kore-bootstrap-gate",
      "--force-conflicts",
      "--filename=-",
    ],
    proofConstraint(proof, state),
  );
  assert.ok(
    result.ok,
    `bootstrap sets the proof gate ${state}: ${result.output}`,
  );
}

export async function dryRun(
  proof: Proof,
  identity: string[],
  kind: "Pod" | "Deployment",
): Promise<{ ok: boolean; output: string }> {
  return await kubectl(
    proof.cluster,
    [...identity, "create", "--dry-run=server", "--filename=-"],
    workload(proof.namespace, proof.image, kind),
  );
}

/** Gatekeeper loads constraint changes asynchronously; wait for the verdict. */
export async function dryRunUntil(
  proof: Proof,
  kind: "Pod" | "Deployment",
  closed: boolean,
): Promise<{ ok: boolean; output: string }> {
  let result = await dryRun(proof, developer, kind);
  for (
    let attempt = 0;
    attempt < 30 && closedMessage.test(result.output) !== closed;
    attempt += 1
  ) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    result = await dryRun(proof, developer, kind);
  }
  return result;
}

export async function assertClosedDenies(proof: Proof): Promise<void> {
  const deployment = await dryRunUntil(proof, "Deployment", true);
  assert.equal(deployment.ok, false, "a closed gate denies a Deployment");
  assert.match(deployment.output, closedMessage);
  const pod = await dryRun(proof, developer, "Pod");
  assert.equal(pod.ok, false);
  assert.match(pod.output, closedMessage);
  const forged = await kubectl(
    proof.cluster,
    [
      ...developer,
      "apply",
      "--server-side",
      "--force-conflicts",
      "--filename=-",
    ],
    proofConstraint(proof, "open"),
  );
  assert.equal(forged.ok, false, "a developer must not open the gate");
  assert.match(forged.output, /forbidden/i);
  // Running workloads are not disrupted: the cluster's own controller can
  // still replace the Pod of a workload admitted earlier.
  const controllerPod = await dryRun(proof, replicaSetController, "Pod");
  assert.doesNotMatch(controllerPod.output, closedMessage);
}

export async function proveAdmission(
  cluster: Live,
  image: string,
): Promise<void> {
  const id = randomBytes(4).toString("hex");
  const proof: Proof = {
    cluster,
    namespace: `kore-gate-proof-${id}`,
    constraint: `kore-gate-proof-${id}`,
    image,
  };
  try {
    assert.ok(
      (await kubectl(cluster, ["create", "namespace", proof.namespace])).ok,
    );
    assert.ok(
      (
        await kubectl(cluster, [
          "create",
          "rolebinding",
          "kore-gate-proof-edit",
          "--namespace",
          proof.namespace,
          "--clusterrole",
          "edit",
          "--user",
          "kore-gate-developer",
        ])
      ).ok,
    );
    await setProofGate(proof, "closed");
    await assertClosedDenies(proof);
    // Only bootstrap opens it; the developer's request is then not refused.
    await setProofGate(proof, "open");
    const admitted = await dryRunUntil(proof, "Deployment", false);
    assert.doesNotMatch(admitted.output, closedMessage);
    // An unhealthy prerequisite closes it again, and requests are denied again.
    await setProofGate(proof, "closed");
    const again = await dryRunUntil(proof, "Deployment", true);
    assert.match(again.output, closedMessage);
  } finally {
    await kubectl(cluster, [
      "delete",
      admissionGateResource,
      proof.constraint,
      "--ignore-not-found",
    ]);
    await kubectl(cluster, [
      "delete",
      "namespace",
      proof.namespace,
      "--ignore-not-found",
      "--wait=false",
    ]);
  }
}
