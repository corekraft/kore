/** The fields of hc's JSON for one terminal that this adapter reads. */
export interface HcTerminal {
  address: string;
  name?: string | null;
  parent?: string | null;
  state: "live" | "finished";
  status?: string | null;
  exit_code?: number | null;
  labels: Record<string, string>;
  cwd: string;
}

/** The fields of hc's wait JSON that this adapter reads. */
export interface HcWait {
  terminal: string;
  ended: boolean;
  reason: string;
  children: { terminal: string; reason: string }[];
}

export interface HcList {
  terminals: HcTerminal[];
}

export interface HcRead {
  text: string;
  complete: boolean;
}

export interface HcRemoved {
  removed: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The minimum shape of a reply that only says it worked. */
export function isJsonObject(value: unknown): value is Record<string, unknown> {
  return isRecord(value);
}

export function isHcTerminal(value: unknown): value is HcTerminal {
  return isRecord(value) && typeof value.address === "string";
}

export function isHcList(value: unknown): value is HcList {
  return (
    isRecord(value) &&
    Array.isArray(value.terminals) &&
    value.terminals.every(isHcTerminal)
  );
}

export function isHcWait(value: unknown): value is HcWait {
  return (
    isRecord(value) &&
    typeof value.terminal === "string" &&
    typeof value.ended === "boolean" &&
    typeof value.reason === "string" &&
    Array.isArray(value.children) &&
    value.children.every(
      (child: unknown) =>
        isRecord(child) &&
        typeof child.terminal === "string" &&
        typeof child.reason === "string",
    )
  );
}

export function isHcRead(value: unknown): value is HcRead {
  return (
    isRecord(value) &&
    typeof value.text === "string" &&
    typeof value.complete === "boolean"
  );
}

export function isHcRemoved(value: unknown): value is HcRemoved {
  return isRecord(value) && typeof value.removed === "string";
}
