// Docs: docs/decisions/0147-vps-v1-is-every-applicable-flag-proven-live-one-per-run-from-release-locks.md
import { describe, expect, it } from "vitest";
import { noOutcomeMessage } from "./flag-activate-messages.js";

const FLAG = "ingress-agentgateway";
const record = (environment: string) =>
  `harness outcome record --idea <number> --kind verification --source live-run --result confirmed --flag ${FLAG} --environment ${environment} --evidence <run> --summary <text>`;

describe("noOutcomeMessage in a production environment (ADR 0147)", () => {
  const overlay = {
    path: "infra/environments/vps/environment.yaml",
    production: true,
  };

  it("says a live run is required, names the overlay left unchanged, and gives the record command", () => {
    expect(noOutcomeMessage(FLAG, "vps", overlay)).toBe(
      `No verification outcome records a live run of ${FLAG} in vps, so infra/environments/vps/environment.yaml is unchanged. Prove it live, then run \`${record("vps")}\`.`,
    );
  });

  it("never offers an owner waiver, because a production environment does not accept one", () => {
    const message = noOutcomeMessage(FLAG, "vps", overlay);
    expect(message).not.toContain("owner waiver");
    expect(message).not.toContain("--source owner-waiver");
  });
});

describe("noOutcomeMessage in a local environment", () => {
  const overlay = { path: "infra/environments/local/environment.yaml" };

  it("names a live run or an owner waiver, gives the record command, and offers the waiver", () => {
    expect(noOutcomeMessage(FLAG, "local", overlay)).toBe(
      `No verification outcome records a live run or an owner waiver of ${FLAG} in local, so infra/environments/local/environment.yaml is unchanged. Prove it live, then run \`${record("local")}\`. Or, when the owner has waived the live run in a GitHub comment, use \`--source owner-waiver --evidence <comment url>\`.`,
    );
  });

  it("offers the owner waiver for an overlay that is not marked production", () => {
    const message = noOutcomeMessage(FLAG, "local", {
      ...overlay,
      production: false,
    });
    expect(message).toContain("--source owner-waiver --evidence <comment url>");
  });
});
