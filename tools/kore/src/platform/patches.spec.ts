import assert from "node:assert/strict";
import { test } from "vitest";
import { applyProbePatches, type ProbePatch } from "./patches.js";

const stream = `---
# Source: cloudnative-pg/templates/deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: cloudnative-pg
  namespace: cnpg-system
spec:
  template:
    spec:
      containers:
      - args:
        - controller
        image: "ghcr.io/cloudnative-pg/cloudnative-pg:1.30.1"
        livenessProbe:
          httpGet:
            path: /readyz
            port: webhook-server
            scheme: HTTPS
          initialDelaySeconds: 3
        name: manager
        readinessProbe:
          httpGet:
            path: /readyz
            port: webhook-server
            scheme: HTTPS
          timeoutSeconds: 1
        resources: {}
      - name: sidecar
        livenessProbe:
          timeoutSeconds: 1
---
apiVersion: v1
kind: Service
metadata:
  name: cloudnative-pg
spec: {}
`;

const patch: ProbePatch = {
  target: { kind: "Deployment", name: "cloudnative-pg", container: "manager" },
  reason: "chart has no timeout value",
  probes: {
    livenessProbe: { timeoutSeconds: 5, failureThreshold: 6 },
    readinessProbe: { timeoutSeconds: 5 },
  },
};

test("a patch adds missing probe fields and replaces existing ones in the targeted container only", () => {
  const out = applyProbePatches(stream, [patch]);
  assert.match(
    out,
    /livenessProbe:\n {10}httpGet:[\s\S]*?initialDelaySeconds: 3\n {10}timeoutSeconds: 5\n {10}failureThreshold: 6\n {8}name: manager/,
  );
  assert.match(out, /scheme: HTTPS\n {10}timeoutSeconds: 5\n {8}resources/);
  assert.doesNotMatch(out, /timeoutSeconds: 1\n {8}resources/);
  // The sidecar's probe and every other document stay byte-for-byte.
  assert.match(
    out,
    /- name: sidecar\n {8}livenessProbe:\n {10}timeoutSeconds: 1/,
  );
  assert.equal(out.split("---")[2], stream.split("---")[2]);
});

test("patching is idempotent", () => {
  const once = applyProbePatches(stream, [patch]);
  assert.equal(applyProbePatches(once, [patch]), once);
});

test("no patches leaves the stream unchanged", () => {
  assert.equal(applyProbePatches(stream, []), stream);
});

test("a missing workload fails loudly, naming the target", () => {
  assert.throws(
    () =>
      applyProbePatches(stream, [
        { ...patch, target: { ...patch.target, name: "renamed" } },
      ]),
    /patch target Deployment\/renamed container manager not found/,
  );
});

test("a missing container fails loudly, naming the target", () => {
  assert.throws(
    () =>
      applyProbePatches(stream, [
        { ...patch, target: { ...patch.target, container: "gone" } },
      ]),
    /patch target Deployment\/cloudnative-pg container gone not found/,
  );
});

test("a probe the container does not define fails loudly rather than being invented", () => {
  assert.throws(
    () =>
      applyProbePatches(stream, [
        { ...patch, probes: { startupProbe: { timeoutSeconds: 5 } } },
      ]),
    /Deployment\/cloudnative-pg container manager has no startupProbe/,
  );
});

test("flow-style metadata and a dash-indented container list are patched", () => {
  const flow = `apiVersion: apps/v1
kind: Deployment
metadata: {name: opa, namespace: x}
spec:
  template:
    spec:
      containers:
        - name: opa
          livenessProbe:
            httpGet: {path: /health, port: health}
`;
  const out = applyProbePatches(flow, [
    {
      target: { kind: "Deployment", name: "opa", container: "opa" },
      reason: "r",
      probes: { livenessProbe: { timeoutSeconds: 5 } },
    },
  ]);
  assert.match(
    out,
    /httpGet: \{path: \/health, port: health\}\n {12}timeoutSeconds: 5\n$/,
  );
});

test("a probe written in flow style fails with guidance, not a missing-probe error", () => {
  const flow = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: web
spec:
  template:
    spec:
      containers:
      - name: app
        livenessProbe: {httpGet: {path: /h, port: 80}}
`;
  assert.throws(
    () =>
      applyProbePatches(flow, [
        {
          target: { kind: "Deployment", name: "web", container: "app" },
          reason: "r",
          probes: { livenessProbe: { timeoutSeconds: 5 } },
        },
      ]),
    /Deployment\/web container app livenessProbe is written in flow style; Kore patches block-style probes only\. Check the chart version or its values/,
  );
});
