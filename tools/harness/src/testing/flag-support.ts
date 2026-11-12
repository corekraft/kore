import { harness, INDEX } from "./records-support.js";

export const LEDGER = "/repo/.kore/state/ledger.jsonl";
export const OVERLAY = "infra/environments/local/environment.yaml";

/** An environment overlay as prettier writes it: JSON-compatible YAML. */
export function overlay(features: Record<string, boolean>): string {
  const lines = Object.entries(features).map(
    ([name, on]) => `"${name}": ${on}`,
  );
  return [
    "{",
    '  "name": "local",',
    `  "features": { ${lines.join(", ")} },`,
    '  "imageInventory": "audit"',
    "}",
    "",
  ].join("\n");
}

/** A fake repository whose local overlay declares two flags, both off. */
export function repository(files: Record<string, string> = {}) {
  return harness({
    "docs/index.md": INDEX,
    [OVERLAY]: overlay({ "ingress-agentgateway": false, "other-flag": false }),
    ...files,
  });
}

/** An idea whose recorded outcome is confirmed live-run verification of the default flag; override any line. */
export function provenIdea(change: Record<string, string> = {}): string {
  const lines = {
    Result: "confirmed",
    Kind: "verification",
    Source: "live-run",
    Flag: "ingress-agentgateway",
    Environment: "local",
    ...change,
  };
  return [
    "---",
    "summary: Replace the gateway",
    "hypothesis: h",
    "expected-outcome: e",
    "measurement: m",
    "safety-pattern: feature-flagged",
    "date: 2026-01-01",
    `outcome: ${lines.Result}`,
    "---",
    "",
    "# Idea 0001: Replace the gateway",
    "",
    "## Outcome",
    "",
    ...Object.entries(lines).map(([key, value]) => `- ${key}: ${value}`),
    "- Evidence: kore local up run 2026-01-01",
    "- Recorded: 2026-01-01",
    "",
    "It worked.",
    "",
  ].join("\n");
}

export function activate(
  flag = "ingress-agentgateway",
  environment = "local",
): string[] {
  return [
    "flag",
    "activate",
    flag,
    "--environment",
    environment,
    "--ledger",
    LEDGER,
  ];
}
