// Docs: docs/decisions/0164-the-platform-domain-is-a-run-time-value-and-the-repository-holds-a-placeholder.md
import { expect, test } from "vitest";
import { fakeEnvironment } from "./config-support.js";
import { platformDomainOrigin, runTimeDomain } from "./run-time-domain.js";

const vps = fakeEnvironment({ name: "vps", provider: "managed" });
const local = fakeEnvironment({ name: "local", provider: "k3d" });
const overridden: NodeJS.ProcessEnv = { KORE_PLATFORM_DOMAIN: "example.com" };

test("a managed environment reads the run-time domain from KORE_PLATFORM_DOMAIN when it is set and non-empty", () => {
  expect(runTimeDomain(vps, overridden)).toBe("example.com");
  expect(runTimeDomain(vps, { KORE_PLATFORM_DOMAIN: "" })).toBeUndefined();
  expect(runTimeDomain(vps, {})).toBeUndefined();
});

test("a local environment never reads the run-time domain, whatever the variable holds", () => {
  expect(runTimeDomain(local, overridden)).toBeUndefined();
});

test("the domain's origin is run-time for a managed environment with the variable, and overlay otherwise", () => {
  expect(platformDomainOrigin(vps, overridden)).toBe("run-time");
  expect(platformDomainOrigin(vps, {})).toBe("overlay");
  expect(platformDomainOrigin(local, overridden)).toBe("overlay");
});
