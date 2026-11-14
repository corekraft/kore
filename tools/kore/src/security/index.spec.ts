// Docs: docs/decisions/0009-encrypted-secrets-through-external-secrets.md
import { expect, test, vi } from "vitest";
import * as security from "./index.js";
import { syncLocalSecrets } from "./secrets.js";
import { installLocalTrust, removeLocalTrustArtifacts } from "./trust.js";

vi.mock("./secrets.js");
vi.mock("./trust.js");

test("the security barrel exposes exactly the local secret sync and local trust entry points", () => {
  expect(Object.keys(security).sort()).toEqual([
    "installLocalTrust",
    "removeLocalTrustArtifacts",
    "syncLocalSecrets",
  ]);
  expect(security.syncLocalSecrets).toBe(syncLocalSecrets);
  expect(security.installLocalTrust).toBe(installLocalTrust);
  expect(security.removeLocalTrustArtifacts).toBe(removeLocalTrustArtifacts);
});
