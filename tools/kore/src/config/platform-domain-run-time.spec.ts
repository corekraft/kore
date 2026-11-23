// Docs: docs/decisions/0164-the-platform-domain-is-a-run-time-value-and-the-repository-holds-a-placeholder.md
import { expect, test } from "vitest";
import { fakeEnvironment } from "./config-support.js";
import {
  platformDomainErrors,
  platformHelmArgs,
  platformPlan,
  platformWildcard,
  runTimeDomainErrors,
} from "./platform-domain.js";
import { platformDomainOrigin } from "./run-time-domain.js";

const local = fakeEnvironment({
  platform: { domain: "kore.internal", organizationId: "platform" },
});
const vps = fakeEnvironment({
  name: "vps",
  provider: "managed",
  kubeContext: "kore-vps",
  platform: { domain: "kore.internal", organizationId: "platform" },
});
const overridden: NodeJS.ProcessEnv = { KORE_PLATFORM_DOMAIN: "example.com" };
const placeholderPlan = { domain: "kore.internal", organizationId: "platform" };

test("with KORE_PLATFORM_DOMAIN set, a managed environment's plan returns it, and the overlay keeps its placeholder", () => {
  expect(platformPlan(vps, overridden)).toEqual({
    domain: "example.com",
    organizationId: "platform",
  });
  expect(vps.platform).toEqual(placeholderPlan);
});

test("with the variable unset or empty the plan returns the overlay placeholder", () => {
  expect(platformPlan(vps, {})).toEqual(placeholderPlan);
  expect(platformPlan(vps, { KORE_PLATFORM_DOMAIN: "" })).toEqual(
    placeholderPlan,
  );
});

test("the variable never changes a local environment, whose domain is the local one in its overlay", () => {
  expect(platformPlan(local, overridden).domain).toBe("kore.internal");
  expect(platformDomainOrigin(local, overridden)).toBe("overlay");
});

test("the origin of the platform domain is run-time only when a managed environment has the variable set", () => {
  expect(platformDomainOrigin(vps, overridden)).toBe("run-time");
  expect(platformDomainOrigin(vps, {})).toBe("overlay");
});

test("the placeholder and a valid run-time domain both validate, so nothing needs a real name to validate", () => {
  expect(platformDomainErrors(vps, {})).toEqual([]);
  expect(platformDomainErrors(vps, overridden)).toEqual([]);
  expect(runTimeDomainErrors(vps, overridden)).toEqual([]);
});

test("a malformed run-time domain is refused naming the variable and an example, and the value is never echoed", () => {
  const errors = platformDomainErrors(vps, {
    KORE_PLATFORM_DOMAIN: "Example..com",
  });
  expect(errors).toEqual([
    "KORE_PLATFORM_DOMAIN must be a lowercase DNS name of at least two labels, at most 180 characters, for example example.com; fix KORE_PLATFORM_DOMAIN in the shell that runs kore",
  ]);
  expect(JSON.stringify(errors)).not.toContain("Example..com");
});

test("a run-time domain past 180 characters is refused by the same rule as the overlay's", () => {
  const label = "a".repeat(60);
  expect(
    runTimeDomainErrors(vps, {
      KORE_PLATFORM_DOMAIN: [label, label, label].join("."),
    }),
  ).toHaveLength(1);
});

test("the run-time domain reaches the Helm parameters a chart takes, and the derived wildcard follows it", () => {
  expect(platformWildcard(vps, overridden)).toBe("*.platform.example.com");
  expect(platformHelmArgs(vps, "kore-platform-config", overridden)).toEqual([
    "--set-string",
    "gateway.hostname=example.com",
    "--set-string",
    "gateway.platformHostname=*.platform.example.com",
  ]);
  expect(platformHelmArgs(vps, "kore-platform-apis", overridden)).toEqual([
    "--set-string",
    "platformDomain=example.com",
  ]);
});

test("with the variable unset the Helm parameters are the placeholder's, unchanged", () => {
  expect(platformHelmArgs(vps, "kore-platform-config", {})).toEqual([
    "--set-string",
    "gateway.hostname=kore.internal",
    "--set-string",
    "gateway.platformHostname=*.platform.kore.internal",
  ]);
});
