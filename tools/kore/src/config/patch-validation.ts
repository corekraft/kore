// Docs: docs/decisions/0089-declarative-probe-patches-through-a-helm-post-renderer.md
import type { Component } from "./types.js";

export const probeNames = ["livenessProbe", "readinessProbe", "startupProbe"];
export const probeFields = [
  "initialDelaySeconds",
  "periodSeconds",
  "timeoutSeconds",
  "successThreshold",
  "failureThreshold",
];
export const patchableKinds = ["Deployment", "StatefulSet", "DaemonSet"];

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

const patchKeys = ["target", "reason", "probes"];
const targetKeys = ["kind", "name", "container"];

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function unknownKeys(
  label: string,
  value: Record<string, unknown>,
  known: string[],
): string[] {
  return Object.keys(value)
    .filter((key) => !known.includes(key))
    .map((key) => `${label} has unknown key ${key}`);
}

function probeErrors(label: string, probe: string, fields: unknown): string[] {
  if (!isObject(fields)) {
    return [`${label} ${probe} must be an object of probe fields`];
  }
  const entries = Object.entries(fields);
  if (entries.length === 0) {
    return [`${label} ${probe} sets no field`];
  }
  return entries.flatMap(([field, value]) => {
    if (!probeFields.includes(field)) {
      return [`${label} ${probe}.${field} is not a probe field`];
    }
    if (!Number.isInteger(value) || (value as number) < 1) {
      return [`${label} ${probe}.${field} must be a positive integer`];
    }
    // Kubernetes requires successThreshold 1 for liveness and startup probes.
    if (
      field === "successThreshold" &&
      probe !== "readinessProbe" &&
      value !== 1
    ) {
      return [`${label} ${probe}.${field} must be 1`];
    }
    return [];
  });
}

function patchErrors(label: string, raw: unknown): string[] {
  if (!isObject(raw)) {
    return [`${label} must be an object with target, reason and probes`];
  }
  const target = isObject(raw["target"]) ? raw["target"] : {};
  const errors: string[] = [...unknownKeys(label, raw, patchKeys)];
  if (text(raw["reason"]).trim() === "") {
    errors.push(`${label} requires a reason`);
  }
  if (!patchableKinds.includes(text(target["kind"]))) {
    errors.push(`${label} kind ${text(target["kind"])} is not patchable`);
  }
  errors.push(...unknownKeys(`${label} target`, target, targetKeys));
  for (const key of ["name", "container"]) {
    if (text(target[key]) === "") {
      errors.push(`${label} target.${key} is required`);
    }
  }
  const probes = isObject(raw["probes"]) ? Object.entries(raw["probes"]) : [];
  if (probes.length === 0) {
    errors.push(`${label} sets no probe`);
  }
  for (const [probe, fields] of probes) {
    if (!probeNames.includes(probe)) {
      errors.push(`${label} ${probe} is not a probe`);
    } else {
      errors.push(...probeErrors(label, probe, fields));
    }
  }
  return errors;
}

/** Problems with a component's probe patches, each naming the component. */
export function componentPatchErrors(component: Component): string[] {
  if (component.patches === undefined) {
    return [];
  }
  if (component.kind === "manifest") {
    return [`${component.name}: patches do not apply to a manifest component`];
  }
  return component.patches.flatMap((raw, index) =>
    patchErrors(`${component.name}: patches[${index}]`, raw),
  );
}
