// A fake reader for the ledger a spec's file map holds: one JSON event per line.
import { LEDGER } from "./flag-support.js";

export function ledgerEvents(files: Map<string, string>) {
  return (files.get(LEDGER) ?? "")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}
