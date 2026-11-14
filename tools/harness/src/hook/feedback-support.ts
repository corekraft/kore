// Fakes shared by the hook domain's specs: the ledger's path and a parser for
// the events written to it. The run-based feedback helpers live in integration/hook.

export const LEDGER = "/repo/.kore/state/ledger.jsonl";

export function ledgerEvents(files: Map<string, string>) {
  const text = files.get(LEDGER) ?? "";
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}
