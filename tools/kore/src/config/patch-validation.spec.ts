// Docs: docs/decisions/0089-declarative-probe-patches-through-a-helm-post-renderer.md
import { expect, test } from "vitest";
import { fakeComponent, malformed } from "./config-support.js";
import { componentPatchErrors } from "./patch-validation.js";
import type { ProbePatch } from "./types.js";

const target = { kind: "Deployment", name: "registry", container: "registry" };

/** A patch that passes every rule; a test changes the one field it checks. */
const patch = (fields: Record<string, unknown> = {}): ProbePatch =>
  ({
    target,
    reason: "the chart gives no probe timing",
    probes: { readinessProbe: { periodSeconds: 10 } },
    ...fields,
  }) as ProbePatch;

const check = (...patches: ProbePatch[]) =>
  componentPatchErrors(fakeComponent({ name: "kore-registry", patches }));

test("a component with no patches has nothing to check", () => {
  expect(componentPatchErrors(fakeComponent())).toEqual([]);
});

test("a sound patch on a workload passes", () => {
  expect(check(patch())).toEqual([]);
});

test("a patch on a manifest component is refused, naming the component", () => {
  const manifest = fakeComponent({
    name: "kore-policy",
    kind: "manifest",
    patches: [patch()],
  });
  expect(componentPatchErrors(manifest)).toEqual([
    "kore-policy: patches do not apply to a manifest component",
  ]);
});

test("a patch with no reason is refused", () => {
  expect(check(patch({ reason: "  " }))).toEqual([
    "kore-registry: patches[0] requires a reason",
  ]);
});

test("a patch aimed at a kind that is not a workload is refused", () => {
  expect(check(patch({ target: { ...target, kind: "Service" } }))).toEqual([
    "kore-registry: patches[0] kind Service is not patchable",
  ]);
});

test("a patch that names an unknown key on the patch or the target is refused", () => {
  expect(
    check(patch({ extra: true, target: { ...target, namespace: "x" } })),
  ).toEqual([
    "kore-registry: patches[0] has unknown key extra",
    "kore-registry: patches[0] target has unknown key namespace",
  ]);
});

test("a target without a name or a container is refused", () => {
  expect(check(patch({ target: { kind: "Deployment" } }))).toEqual([
    "kore-registry: patches[0] target.name is required",
    "kore-registry: patches[0] target.container is required",
  ]);
});

test("a patch with no probe, or with a name that is not a probe, is refused", () => {
  expect(check(patch({ probes: {} }))).toEqual([
    "kore-registry: patches[0] sets no probe",
  ]);
  expect(check(patch({ probes: { pingProbe: { periodSeconds: 5 } } }))).toEqual(
    ["kore-registry: patches[0] pingProbe is not a probe"],
  );
});

test("a probe with no fields, or with a field that is not a probe field, is refused", () => {
  expect(check(patch({ probes: { readinessProbe: {} } }))).toEqual([
    "kore-registry: patches[0] readinessProbe sets no field",
  ]);
  expect(check(patch({ probes: { readinessProbe: { retries: 3 } } }))).toEqual([
    "kore-registry: patches[0] readinessProbe.retries is not a probe field",
  ]);
});

test("a probe field must be a positive whole number", () => {
  expect(
    check(patch({ probes: { readinessProbe: { periodSeconds: 0 } } })),
  ).toEqual([
    "kore-registry: patches[0] readinessProbe.periodSeconds must be a positive integer",
  ]);
  expect(
    check(patch({ probes: { readinessProbe: { timeoutSeconds: 1.5 } } })),
  ).toEqual([
    "kore-registry: patches[0] readinessProbe.timeoutSeconds must be a positive integer",
  ]);
});

test("a liveness or startup probe must have a success threshold of 1, while readiness may have more", () => {
  expect(
    check(patch({ probes: { livenessProbe: { successThreshold: 2 } } })),
  ).toEqual([
    "kore-registry: patches[0] livenessProbe.successThreshold must be 1",
  ]);
  expect(
    check(patch({ probes: { startupProbe: { successThreshold: 2 } } })),
  ).toEqual([
    "kore-registry: patches[0] startupProbe.successThreshold must be 1",
  ]);
  expect(
    check(patch({ probes: { readinessProbe: { successThreshold: 2 } } })),
  ).toEqual([]);
});

test("a patch that is not an object is refused before any of its fields are read", () => {
  expect(check(malformed<ProbePatch>("registry"))).toEqual([
    "kore-registry: patches[0] must be an object with target, reason and probes",
  ]);
});

test("a probe whose fields are not an object is refused", () => {
  expect(check(patch({ probes: { readinessProbe: "fast" } }))).toEqual([
    "kore-registry: patches[0] readinessProbe must be an object of probe fields",
  ]);
});

test("each patch is checked and its errors name its index", () => {
  expect(check(patch(), patch({ reason: "" }))).toEqual([
    "kore-registry: patches[1] requires a reason",
  ]);
});
