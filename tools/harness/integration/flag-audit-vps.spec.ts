// Docs: docs/decisions/0147-vps-v1-is-every-applicable-flag-proven-live-one-per-run-from-release-locks.md
import { describe, expect, it } from "vitest";
import { run } from "../src/cli/index.js";
import {
  inventoryWith,
  overlay,
  provenIdea,
  repository,
} from "../src/testing/index.js";

const VPS = "infra/environments/vps/environment.yaml";
const INVENTORY = ".claude/guardrails.yaml";

const vpsRule = (mode: "audit" | "enforce") =>
  inventoryWith({ "vps-flag-proof": mode });

describe("harness flag audit --vps", () => {
  it("warns, naming the flag and its fix, and exits zero while the vps rule is in audit", async () => {
    const h = repository({
      [VPS]: overlay({ openbao: true }, "vps"),
      [INVENTORY]: vpsRule("audit"),
    });
    expect(await run(["flag", "audit", "--vps"], h.deps)).toBe(0);
    expect(h.err()).toMatch(/warning: Flag openbao is on in vps/);
    expect(h.err()).toMatch(/harness flag activate openbao --environment vps/);
  });

  it("fails naming the same flag once the vps rule is in enforce", async () => {
    const h = repository({
      [VPS]: overlay({ openbao: true }, "vps"),
      [INVENTORY]: vpsRule("enforce"),
    });
    expect(await run(["flag", "audit", "--vps"], h.deps)).toBe(1);
    expect(h.err()).toMatch(/Flag openbao is on in vps/);
  });

  it("reports nothing when every true vps flag has a live-run outcome", async () => {
    const h = repository({
      [VPS]: overlay({ openbao: true }, "vps"),
      [INVENTORY]: vpsRule("enforce"),
      "docs/ideas/0001-proof.md": provenIdea({
        Flag: "openbao",
        Environment: "vps",
      }),
    });
    expect(await run(["flag", "audit", "--vps"], h.deps)).toBe(0);
    expect(h.out()).toMatch(/passed/);
    expect(h.err()).toBe("");
  });

  it("does not count an owner waiver as proof on vps", async () => {
    const h = repository({
      [VPS]: overlay({ openbao: true }, "vps"),
      [INVENTORY]: vpsRule("enforce"),
      "docs/ideas/0001-proof.md": provenIdea({
        Flag: "openbao",
        Environment: "vps",
        Source: "owner-waiver",
      }),
    });
    expect(await run(["flag", "audit", "--vps"], h.deps)).toBe(1);
    expect(h.err()).toMatch(/Flag openbao is on in vps/);
  });
});
