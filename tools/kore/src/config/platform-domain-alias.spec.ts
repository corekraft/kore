// Docs: docs/decisions/0132-local-names-resolve-through-platform-dns-and-one-loopback-entry-point.md
import { expect, test } from "vitest";
import { fakeEnvironment } from "./config-support.js";
import {
  deprecatedAliasOf,
  platformDomainErrors,
  platformHelmArgs,
} from "./platform-domain.js";

const declaring = (platformDns: boolean) =>
  fakeEnvironment({
    platform: {
      domain: "kore.internal",
      organizationId: "platform",
      deprecatedAlias: "kore.local",
    },
    features: { "platform-dns": platformDns },
  });

test("a deprecated alias is one lowercase DNS name, and a bad one is named with its field", () => {
  expect(platformDomainErrors(declaring(true))).toEqual([]);
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

test("with platform-dns on the alias is handed to the platform config and the local certificate beside the domain, and to no other chart", () => {
  expect(platformHelmArgs(declaring(true), "kore-platform-config")).toEqual([
    "--set-string",
    "gateway.hostname=kore.internal",
    "--set-string",
    "gateway.platformHostname=*.platform.kore.internal",
    "--set-string",
    "gateway.deprecatedAlias=kore.local",
  ]);
  expect(platformHelmArgs(declaring(true), "kore-local-tls")).toEqual([
    "--set-string",
    "gateway.hostname=kore.internal",
    "--set-string",
    "gateway.deprecatedAlias=kore.local",
  ]);
  expect(platformHelmArgs(declaring(true), "kore-platform-apis")).toEqual([
    "--set-string",
    "platformDomain=kore.internal",
  ]);
});

test("with platform-dns off a declared alias is handed to no chart: the arguments equal the ones with no alias at all, so the flag-off render is unchanged", () => {
  const plain = fakeEnvironment({
    platform: { domain: "kore.internal", organizationId: "platform" },
    features: { "platform-dns": false },
  });
  for (const component of ["kore-platform-config", "kore-local-tls"]) {
    expect(platformHelmArgs(declaring(false), component)).toEqual(
      platformHelmArgs(plain, component),
    );
  }
  expect(deprecatedAliasOf(declaring(false))).toBeUndefined();
  expect(deprecatedAliasOf(declaring(true))).toBe("kore.local");
});
