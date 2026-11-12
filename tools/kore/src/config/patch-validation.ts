// Docs: docs/decisions/0088-declarative-probe-patches-through-a-helm-post-renderer.md
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

function patchErrors(label: string, raw: unknown): string[] {
  const patch = (raw ?? {}) as Record<string, unknown>;
  const target = (patch["target"] ?? {}) as Record<string, unknown>;
  const errors: string[] = [];
  if (text(patch["reason"]).trim() === "") {
    errors.push(`${label} requires a reason`);
  }
  if (!patchableKinds.includes(text(target["kind"]))) {
    errors.push(`${label} kind ${text(target["kind"])} is not patchable`);
  }
  for (const key of ["name", "container"]) {
    if (text(target[key]) === "") {
      errors.push(`${label} target.${key} is required`);
    }
  }
  const probes = Object.entries((patch["probes"] ?? {}) as object);
  if (probes.length === 0) {
    errors.push(`${label} sets no probe`);
  }
  for (const [probe, fields] of probes) {
    if (!probeNames.includes(probe)) {
      errors.push(`${label} ${probe} is not a probe`);
      continue;
    }
    for (const [field, value] of Object.entries(fields as object)) {
      if (!probeFields.includes(field)) {
        errors.push(`${label} ${probe}.${field} is not a probe field`);
      } else if (!Number.isInteger(value) || (value as number) < 1) {
        errors.push(`${label} ${probe}.${field} must be a positive integer`);
      }
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
