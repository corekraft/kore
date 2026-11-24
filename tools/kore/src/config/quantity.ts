// Names the CPU and memory quantities a record writes the way a record writes them. Reading a
// quantity belongs to node-capacity.ts, the one grammar, so it is re-exported here and never
// parsed twice. A quantity it cannot read is undefined, and the caller names the field: nothing
// is guessed (ADR 0152).
// Docs: docs/decisions/0165-a-suborg-is-the-namespace-quota-and-trust-boundary-of-its-services.md

export { cpuMillis, memoryMiB } from "./node-capacity.js";

/** Millicores as a record writes them: whole cores as `2`, anything else as `1500m`. */
export function formatCpu(millis: number): string {
  return millis % 1000 === 0 ? String(millis / 1000) : `${millis}m`;
}

/** Mebibytes as a record writes them: whole gibibytes as `2Gi`, anything else as `512Mi`. */
export function formatMemory(mib: number): string {
  return mib % 1024 === 0 ? `${mib / 1024}Gi` : `${mib}Mi`;
}
