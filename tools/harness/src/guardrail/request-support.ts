// Shared fixtures for the guardrail request and status specs.
import { readFileSync } from "node:fs";
import { run } from "../cli/index.js";
import { LEDGER, linked, type Harness } from "../outcome/outcome-support.js";
import { fixtures } from "../hook/retro-scan-support.js";
import { INVENTORY_PATH } from "./index.js";

const entry = (rule: string, mode: string, extra = {}) => ({
  rule,
  kind: "bash",
  mode,
  owner: "guard.ts",
  ...extra,
});

export const INVENTORY = JSON.stringify({
  guardrails: [
    entry("image-digest", "audit"),
    entry("sample-audit", "audit"),
    entry("unquoted-glob", "audit"),
    entry("enforced-rule", "enforce"),
  ],
});

export async function ready(overrides = {}) {
  const { h, issue } = await linked(overrides);
  h.set(INVENTORY_PATH, INVENTORY);
  for (const name of ["alpha", "bravo", "charlie"]) {
    h.set(
      `transcripts/${name}.jsonl`,
      readFileSync(`${fixtures}${name}.jsonl`, "utf8"),
    );
  }
  return { h, issue };
}

export const request = (
  h: Harness,
  rule: string,
  to: string,
  extra: string[] = [],
) =>
  run(
    [
      "guardrail",
      "request",
      "--rule",
      rule,
      "--to",
      to,
      "--idea",
      "1",
      "--dir",
      "/repo/transcripts",
      "--ledger",
      LEDGER,
      "--json",
      ...extra,
    ],
    h.deps,
  );

export const ledgerEvents = (h: Harness) =>
  (h.get(".kore/state/ledger.jsonl") ?? "")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
