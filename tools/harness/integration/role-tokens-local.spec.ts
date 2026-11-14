import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const OVERLAY = new URL(
  "../../../infra/environments/local/environment.yaml",
  import.meta.url,
);

describe("the local environment overlay", () => {
  it("turns role-tokens on so session spawn hands writer and judge panes their tokens (#336)", () => {
    const overlay = JSON.parse(readFileSync(OVERLAY, "utf8")) as {
      features: Record<string, boolean>;
    };
    expect(overlay.features["role-tokens"]).toBe(true);
  });

  it("leaves ingress-agentgateway as it was", () => {
    const overlay = JSON.parse(readFileSync(OVERLAY, "utf8")) as {
      features: Record<string, boolean>;
    };
    expect(overlay.features["ingress-agentgateway"]).toBe(false);
  });
});
