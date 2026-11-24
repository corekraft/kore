// Reads the CPU and memory quantities a record writes (a Service's requests, an Organization's
// quota) to numbers, and writes them back the way a record is written. A quantity it cannot
// read is undefined, and the caller names the field: nothing is guessed (ADR 0152).
// Docs: docs/decisions/0165-a-suborg-is-the-namespace-quota-and-trust-boundary-of-its-services.md

const cpuQuantity = /^(\d+(?:\.\d+)?)(m)?$/;
const memoryQuantity = /^(\d+(?:\.\d+)?)(Ki|Mi|Gi|Ti)$/;

/** Mebibytes per unit: the memory forms a record may write. */
const memoryUnits = new Map<string, number>([
  ["Ki", 1 / 1024],
  ["Mi", 1],
  ["Gi", 1024],
  ["Ti", 1024 * 1024],
]);

/** A CPU quantity in millicores: `500m` is 500, `1` is 1000 and `0.5` is 500. */
export function cpuMillis(text: string): number | undefined {
  const match = cpuQuantity.exec(text);
  if (!match) {
    return undefined;
  }
  const cores = Number(match[1]);
  return Math.round(match[2] ? cores : cores * 1000);
}

/** A memory quantity in mebibytes: `512Mi` is 512, `1Gi` is 1024 and `1.5Gi` is 1536. */
export function memoryMiB(text: string): number | undefined {
  const match = memoryQuantity.exec(text);
  const unit = match ? memoryUnits.get(match[2] ?? "") : undefined;
  return match && unit !== undefined ? Number(match[1]) * unit : undefined;
}

/** Millicores as a record writes them: whole cores as `2`, anything else as `1500m`. */
export function formatCpu(millis: number): string {
  return millis % 1000 === 0 ? String(millis / 1000) : `${millis}m`;
}

/** Mebibytes as a record writes them: whole gibibytes as `2Gi`, anything else as `512Mi`. */
export function formatMemory(mib: number): string {
  return mib % 1024 === 0 ? `${mib / 1024}Gi` : `${mib}Mi`;
}
