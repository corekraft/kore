// Docs: docs/decisions/0009-encrypted-secrets-through-external-secrets.md
import { expect, test, vi } from "vitest";
import * as security from "./index.js";
import { syncLocalSecrets } from "./secrets.js";
import { applySmtpCredentials, parseSmtpCredentials } from "./smtp-secret.js";
import { ensureLocalCaTrust, loadLocalCa } from "./local-ca-trust.js";
import {
  installLocalTrust,
  removeLocalTrustArtifacts,
  trustIssuer,
} from "./trust.js";
import {
  activeTokenConsumers,
  applyCloudflareTokens,
  cloudflareTokenSecretName,
} from "./cloudflare-token.js";

vi.mock("./local-ca-trust.js");
vi.mock("./secrets.js");
vi.mock("./smtp-secret.js");
vi.mock("./trust.js");
vi.mock("./cloudflare-token.js");

test("the security barrel exposes exactly the local secret sync, local trust, local CA distribution and local CA read entry points, the SMTP credential entry points, and the Cloudflare token entry points", () => {
  expect(Object.keys(security).sort()).toEqual([
    "activeTokenConsumers",
    "applyCloudflareTokens",
    "applySmtpCredentials",
    "cloudflareTokenSecretName",
    "ensureLocalCaTrust",
    "installLocalTrust",
    "loadLocalCa",
    "parseSmtpCredentials",
    "removeLocalTrustArtifacts",
    "syncLocalSecrets",
    "trustIssuer",
  ]);
  expect(security.activeTokenConsumers).toBe(activeTokenConsumers);
  expect(security.applyCloudflareTokens).toBe(applyCloudflareTokens);
  expect(security.cloudflareTokenSecretName).toBe(cloudflareTokenSecretName);
  expect(security.applySmtpCredentials).toBe(applySmtpCredentials);
  expect(security.parseSmtpCredentials).toBe(parseSmtpCredentials);
  expect(security.ensureLocalCaTrust).toBe(ensureLocalCaTrust);
  expect(security.loadLocalCa).toBe(loadLocalCa);
  expect(security.syncLocalSecrets).toBe(syncLocalSecrets);
  expect(security.installLocalTrust).toBe(installLocalTrust);
  expect(security.removeLocalTrustArtifacts).toBe(removeLocalTrustArtifacts);
  expect(security.trustIssuer).toBe(trustIssuer);
});
