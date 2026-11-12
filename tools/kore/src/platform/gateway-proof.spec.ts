import assert from "node:assert/strict";
import { test } from "vitest";
import type { Json } from "./gateway-proof.js";
import {
  certificateProblem,
  proofManifests,
  routeProblem,
  secretKeys,
  tunnelProcessProblem,
} from "./gateway-proof.js";

const options = {
  namespace: "kore-proof-abc",
  hostname: "kore.local",
  gateway: { name: "kore-gateway", namespace: "kore-system" },
  image: "kore/reference@sha256:" + "a".repeat(64),
  pullPolicy: "Never",
  storeName: "platform-secrets",
  source: { key: "reference-app", property: "API_TOKEN" },
  target: { secret: "proof-target", key: "PROOF_KEY" },
};

function get(value: unknown, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>(
      (node, key) => (node as Record<string, unknown> | undefined)?.[key],
      value,
    );
}
const manifests = () => proofManifests(options);
const ofKind = (kind: string): Json =>
  manifests().find((doc) => doc.kind === kind) as Json;

test("the proof route attaches to the infrastructure Gateway, never creating one", () => {
  assert.ok(!manifests().some((doc) => doc.kind === "Gateway"));
  const route = ofKind("HTTPRoute");
  assert.deepEqual(get(route, "spec.parentRefs"), [
    { name: "kore-gateway", namespace: "kore-system" },
  ]);
  assert.deepEqual(get(route, "spec.hostnames"), ["kore.local"]);
  assert.equal(get(route, "metadata.namespace"), "kore-proof-abc");
});

test("every proof object lives in the throwaway namespace", () => {
  for (const doc of manifests().filter(({ kind }) => kind !== "Namespace")) {
    assert.equal(
      get(doc, "metadata.namespace"),
      "kore-proof-abc",
      String(doc.kind),
    );
  }
  assert.equal(get(ofKind("Namespace"), "metadata.name"), "kore-proof-abc");
});

test("the echo backend runs the given digest-pinned image, non-root and without privilege escalation", () => {
  const container = get(
    ofKind("Deployment"),
    "spec.template.spec.containers",
  ) as Json[];
  assert.equal(container[0]!.image, options.image);
  assert.equal(container[0]!.imagePullPolicy, "Never");
  assert.equal(get(container[0], "securityContext.runAsNonRoot"), true);
  assert.equal(
    get(container[0], "securityContext.allowPrivilegeEscalation"),
    false,
  );
  assert.match(String(container[0]!.image), /@sha256:[0-9a-f]{64}$/);
});

test("the ExternalSecret reads the platform store and writes only the declared target key", () => {
  const external = ofKind("ExternalSecret");
  assert.deepEqual(get(external, "spec.secretStoreRef"), {
    kind: "ClusterSecretStore",
    name: "platform-secrets",
  });
  assert.equal(get(external, "spec.target.name"), "proof-target");
  assert.deepEqual(get(external, "spec.data"), [
    {
      secretKey: "PROOF_KEY",
      remoteRef: { key: "reference-app", property: "API_TOKEN" },
    },
  ]);
});

test("no proof manifest carries an inline secret value", () => {
  const text = JSON.stringify(manifests());
  assert.ok(!/"kind":"Secret"/.test(text));
  assert.ok(!/stringData|"data":\{/.test(text));
});

const condition = (
  type: string,
  status: string,
  reason = "",
  message = "",
) => ({
  type,
  status,
  reason,
  message,
});
const route = (...parents: unknown[][]) => ({
  status: { parents: parents.map((conditions) => ({ conditions })) },
});

test("an accepted, resolved route has no problem", () => {
  assert.equal(
    routeProblem(
      route([condition("Accepted", "True"), condition("ResolvedRefs", "True")]),
    ),
    undefined,
  );
});

test("a route with no parent status yet reports it is not reported", () => {
  assert.match(routeProblem({}) ?? "", /no parent status/);
  assert.match(routeProblem(route()) ?? "", /no parent status/);
});

test("an unresolved backend names the condition, reason, and message", () => {
  const problem = routeProblem(
    route([
      condition("Accepted", "True"),
      condition("ResolvedRefs", "False", "BackendNotFound", "backend echo"),
    ]),
  );
  assert.match(problem ?? "", /ResolvedRefs/);
  assert.match(problem ?? "", /BackendNotFound/);
  assert.match(problem ?? "", /backend echo/);
});

test("a route missing a condition is a problem, not a pass", () => {
  assert.match(
    routeProblem(route([condition("Accepted", "True")])) ?? "",
    /ResolvedRefs/,
  );
});

const now = new Date("2026-11-08T00:00:00Z");
const certificate = (status: Record<string, unknown>) => ({ status });
const ready = [condition("Ready", "True")];

test("a ready certificate with renewal before expiry has no problem", () => {
  assert.equal(
    certificateProblem(
      certificate({
        conditions: ready,
        notAfter: "2027-02-01T00:00:00Z",
        renewalTime: "2027-01-01T00:00:00Z",
      }),
      now,
    ),
    undefined,
  );
});

test("a certificate that is not Ready names the reason", () => {
  assert.match(
    certificateProblem(
      certificate({
        conditions: [condition("Ready", "False", "Pending", "waiting")],
      }),
      now,
    ) ?? "",
    /Ready.*Pending/,
  );
});

test("missing renewal metadata is a problem", () => {
  assert.match(
    certificateProblem(
      certificate({ conditions: ready, notAfter: "2027-02-01T00:00:00Z" }),
      now,
    ) ?? "",
    /renewalTime/,
  );
  assert.match(
    certificateProblem(
      certificate({ conditions: ready, renewalTime: "2027-01-01T00:00:00Z" }),
      now,
    ) ?? "",
    /notAfter/,
  );
});

test("a renewal time after expiry, or an expired certificate, is a problem", () => {
  assert.match(
    certificateProblem(
      certificate({
        conditions: ready,
        notAfter: "2027-01-01T00:00:00Z",
        renewalTime: "2027-02-01T00:00:00Z",
      }),
      now,
    ) ?? "",
    /before/,
  );
  assert.match(
    certificateProblem(
      certificate({
        conditions: ready,
        notAfter: "2026-01-01T00:00:00Z",
        renewalTime: "2025-12-01T00:00:00Z",
      }),
      now,
    ) ?? "",
    /expired/,
  );
});

test("secretKeys lists sorted key names and never returns values", () => {
  const keys = secretKeys({ data: { B: "c2VjcmV0", A: "eA==" } });
  assert.deepEqual(keys, ["A", "B"]);
  assert.deepEqual(secretKeys({}), []);
});

test("a host process list with a minikube tunnel or its ssh forward is a tunnel problem", () => {
  assert.match(
    tunnelProcessProblem(
      [
        { pid: 10, command: "/usr/bin/node server.js" },
        { pid: 11, command: "/opt/homebrew/bin/minikube tunnel -p kore-local" },
      ],
      8443,
    ) ?? "",
    /minikube tunnel.*pid 11/,
  );
  assert.match(
    tunnelProcessProblem(
      [
        {
          pid: 12,
          command:
            "ssh -L 8443:10.0.0.1:8443 -L 15021:10.0.0.1:15021 -i /Users/x/.minikube/machines/kore-local/id_rsa docker@127.0.0.1",
        },
      ],
      8443,
    ) ?? "",
    /ssh forward.*pid 12/,
  );
});

test("the k3d load balancer and unrelated processes are not a tunnel", () => {
  assert.equal(
    tunnelProcessProblem(
      [
        { pid: 1, command: "docker-proxy -proto tcp -host-port 8443" },
        { pid: 2, command: "ssh -L 5432:db:5432 bastion" },
        { pid: 3, command: "/usr/bin/vim minikube-notes.txt tunnel" },
      ],
      8443,
    ),
    undefined,
  );
});
