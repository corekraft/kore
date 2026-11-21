// Docs: docs/decisions/0176-the-kore-local-listener-and-the-8443-mapping-are-removed.md
import { expect, test } from "vitest";
import { fakeEnvironment } from "./config-support.js";
import type { Environment } from "./types.js";
import { platformDomainErrors, platformHelmArgs } from "./platform-domain.js";

// An overlay written before ADR 0176 still declares the field, which the type no longer carries.
const stale = {
  domain: "kore.internal",
  organizationId: "platform",
  deprecatedAlias: "kore.local",
} as unknown as Environment["platform"];

const declaring = fakeEnvironment({
  platform: stale,
  features: { "platform-dns": true },
});

test("an overlay that still declares the removed deprecated alias fails validation with the fix, naming its environment", () => {
  expect(platformDomainErrors(declaring)).toEqual([
    "platform.deprecatedAlias was removed with the kore.local listener (ADR 0176); delete the field from environment local",
  ]);
});

test("no chart is handed a deprecated alias, even with platform-dns on, so no kore.internal listener or certificate name renders", () => {
  expect(platformHelmArgs(declaring, "kore-platform-config")).toEqual([
    "--set-string",
    "gateway.hostname=kore.internal",
    "--set-string",
    "gateway.platformHostname=*.platform.kore.internal",
  ]);
  expect(platformHelmArgs(declaring, "kore-local-tls")).toEqual([
    "--set-string",
    "gateway.hostname=kore.internal",
  ]);
});
