import type { TerminalEvent } from "./port.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The events one line of `hc events --json` stands for (plan 16, Step 4 (e)). The first line hc prints is a
 * snapshot of the terminals that match, each read as changed, so a change between the listing and the follow
 * is not lost. Each later line is a notification: a finish is finished, and any other change is changed.
 * A line that is neither, or a terminal that names no address, is undefined: the caller refuses the stream
 * rather than guess what it means.
 */
export function parseEventLine(line: string): TerminalEvent[] | undefined {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (!isRecord(value)) {
    return undefined;
  }
  if (Array.isArray(value["terminals"])) {
    const events: TerminalEvent[] = [];
    for (const entry of value["terminals"]) {
      const address = isRecord(entry) ? entry["address"] : undefined;
      if (typeof address !== "string") {
        return undefined;
      }
      events.push({ kind: "changed", terminal: address });
    }
    return events;
  }
  const params = value["params"];
  if (
    value["method"] === "event" &&
    isRecord(params) &&
    typeof params["terminal"] === "string" &&
    typeof params["type"] === "string"
  ) {
    return [
      {
        kind: params["type"] === "finished" ? "finished" : "changed",
        terminal: params["terminal"],
      },
    ];
  }
  return undefined;
}
