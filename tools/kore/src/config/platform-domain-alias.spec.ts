// Docs: docs/decisions/0132-local-names-resolve-through-platform-dns-and-one-loopback-entry-point.md
import { expect, test } from "vitest";
import { fakeEnvironment } from "./config-support.js";
import { platformDomainErrors, platformHelmArgs } from "./platform-domain.js";

const withAlias = fakeEnvironment({
  platform: {
    domain: "kore.internal",
    organizationId: "platform",
    deprecatedAlias: "kore.local",
  },
});

test("a deprecated alias is one lowercase DNS name, and a bad one is named with its field", () => {
  expect(platformDomainErrors(withAlias)).toEqual([]);
  const upper = fakeEnvironment({
    platform: {
      domain: "kore.internal",
      organizationId: "platform",
      deprecatedAlias: "Kore.Local",
    },
  });
  expect(platformDomainErrors(upper)).toEqual([
    `platform.deprecatedAlias must be a lowercase DNS name of at least two labels, for example kore.local, in environment local, got "Kore.Local"`,
  ]);
});

test("a deprecated alias that equals the platform domain is refused, since the listener it adds would duplicate the domain's", () => {
  const same = fakeEnvironment({
    platform: {
      domain: "kore.internal",
      organizationId: "platform",
      deprecatedAlias: "kore.internal",
    },
  });
  expect(platformDomainErrors(same)).toEqual([
    `platform.deprecatedAlias must differ from platform.domain, in environment local, got "kore.internal"`,
  ]);
});

test("with a deprecated alias the platform config and the local certificate are handed it beside the domain, and no other chart is", () => {
  expect(platformHelmArgs(withAlias, "kore-platform-config")).toEqual([
    "--set-string",
    "gateway.hostname=kore.internal",
    "--set-string",
    "gateway.platformHostname=*.platform.kore.internal",
    "--set-string",
    "gateway.deprecatedAlias=kore.local",
  ]);
  expect(platformHelmArgs(withAlias, "kore-local-tls")).toEqual([
    "--set-string",
    "gateway.hostname=kore.internal",
    "--set-string",
    "gateway.deprecatedAlias=kore.local",
  ]);
  expect(platformHelmArgs(withAlias, "kore-platform-apis")).toEqual([
    "--set-string",
    "platformDomain=kore.internal",
  ]);
});
