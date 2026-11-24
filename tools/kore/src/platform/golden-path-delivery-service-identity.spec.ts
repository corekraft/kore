// Context: issue #1551. The golden-path-service-identity flag decides whether the sync sets serviceIdentity on each workload.
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
      features: { "golden-path-service-identity": on },
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
  });
  vi.mocked(readFile).mockResolvedValue(JSON.stringify(lock));
});

test("with golden-path-service-identity on the values carry serviceIdentity, so the sync sets each workload's service identity", async () => {
  const composed = await composeGoldenPathDelivery(
    withFlag(true),
    git(),
    "template.lock.json",
  );
  expect(composed.goldenPathDelivery?.serviceIdentity).toBe(true);
});

test("with golden-path-service-identity off the values carry no serviceIdentity, so the flag-off Application is unchanged", async () => {
  const composed = await composeGoldenPathDelivery(
    withFlag(false),
    git(),
    "template.lock.json",
  );
  expect(composed.goldenPathDelivery).not.toHaveProperty("serviceIdentity");
});
