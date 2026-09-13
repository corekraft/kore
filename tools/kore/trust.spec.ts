import assert from "node:assert/strict";
import { test } from "vitest";
import { issuerManifest } from "./trust.js";

test("CA issuer manifest references a generated secret and never embeds key material",()=>{
  const manifest=issuerManifest("kore-local-ca","kore-local-ca-key-pair");
  assert.match(manifest,/kind: ClusterIssuer/); assert.match(manifest,/secretName: kore-local-ca-key-pair/); assert.doesNotMatch(manifest,/BEGIN (RSA )?PRIVATE KEY/);
});
