// Docs: docs/decisions/0154-workloads-run-two-replicas-roll-out-one-surge-pod-at-a-time-and-keep-a-disruption-budget.md
import { readFile } from "node:fs/promises";
import { beforeEach, expect, test, vi } from "vitest";
import {
  gatewayClassName,
  helmInstalledComponents,
  keycloakHostname,
  platformPlan,
} from "../config/index.js";
import { composeGoldenPathDelivery } from "./golden-path-delivery.js";
import {
  fakeComponent,
  fakeRepository,
  fakeRunner,
} from "./platform-support.js";

vi.mock("node:fs/promises");
vi.mock("../config/index.js");

const sha = "a".repeat(40);
const digest = (c: string) => `sha256:${c.repeat(64)}`;
const base = fakeRepository();
const repository = {
  ...base,
  environment: {
    ...base.environment,
    platform: { domain: "kore.internal", organizationId: "platform" },
    gateway: { namespace: "g", name: "g", port: 8443 },
  },
};
const lock = {
  entries: {
    "static-frontend": { image: "ghcr.io/o/fe", digest: digest("1") },
    "kotlin-bff": { image: "ghcr.io/o/bff", digest: digest("2") },
  },
};

function git() {
  return fakeRunner((_command, args) =>
    args.includes("rev-parse")
      ? `${sha}\n`
      : "https://github.com/corekraft/kore.git\n",
  );
}

function withFlag(on: boolean) {
  return {
    ...repository,
    environment: {
      ...repository.environment,
      features: { "golden-path-safety-defaults": on },
    },
  };
}

beforeEach(() => {
  vi.mocked(helmInstalledComponents).mockReturnValue([
    fakeComponent({ name: "kore-golden-path-delivery" }),
  ]);
  vi.mocked(gatewayClassName).mockReturnValue("agentgateway");
  vi.mocked(keycloakHostname).mockReturnValue("keycloak.kore.internal");
  vi.mocked(platformPlan).mockReturnValue({
    domain: "kore.internal",
    organizationId: "platform",
  } as never);
  vi.mocked(readFile).mockResolvedValue(JSON.stringify(lock));
});

test("with golden-path-safety-defaults on the values carry safetyDefaults, so the sync sets each workload's safety defaults (ADR 0154)", async () => {
  const composed = await composeGoldenPathDelivery(
    withFlag(true),
    git(),
    "template.lock.json",
  );
  expect(composed.goldenPathDelivery?.safetyDefaults).toBe(true);
});

test("with golden-path-safety-defaults off the values carry no safetyDefaults, so the flag-off Application is unchanged", async () => {
  const composed = await composeGoldenPathDelivery(
    withFlag(false),
    git(),
    "template.lock.json",
  );
  expect(composed.goldenPathDelivery).not.toHaveProperty("safetyDefaults");
});
