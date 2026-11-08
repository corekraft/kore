import assert from "node:assert/strict";
import { test } from "vitest";
import { redactManifest } from "./render-redaction.js";

const secretManifest = `apiVersion: v1
kind: Secret
metadata:
  name: db
type: Opaque
data:
  username: c3VwZXItc2VjcmV0LXVzZXI=
  password: aHVudGVyMg==
stringData:
  config: |
    token=plain-text-secret
    other=line
  note: plain-value-123
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: settings
data:
  greeting: hello
`;

test("redaction hides every Secret data and stringData value", () => {
  const out = redactManifest(secretManifest);

  for (const leaked of [
    "c3VwZXItc2VjcmV0LXVzZXI=",
    "aHVudGVyMg==",
    "plain-text-secret",
    "other=line",
    "plain-value-123",
  ]) {
    assert.ok(!out.includes(leaked), `${leaked} must not appear`);
  }
  assert.match(out, /username: <redacted>/);
  assert.match(out, /config: <redacted>/);
});

test("redaction keeps non-secret documents and structure intact", () => {
  const out = redactManifest(secretManifest);

  assert.match(out, /name: db/);
  assert.match(out, /kind: ConfigMap/);
  assert.match(out, /greeting: hello/);
});

test("redaction hides inline flow-style Secret data", () => {
  const out = redactManifest(
    "kind: Secret\ndata: {password: aHVudGVyMg==}\nstringData: {token: abc123}\n",
  );

  assert.ok(!out.includes("aHVudGVyMg=="));
  assert.ok(!out.includes("abc123"));
});

test("redaction hides known sensitive keys outside Secrets", () => {
  const out = redactManifest(
    "kind: Deployment\nenv:\n  - name: X\n    password: hunter2\n  token: abc.def\n",
  );

  assert.ok(!out.includes("hunter2"));
  assert.ok(!out.includes("abc.def"));
  assert.match(out, /password: <redacted>/);
});

test("redaction leaves secret references and ordinary keys readable", () => {
  const manifest =
    "kind: ExternalSecret\nspec:\n  secretStoreRef: {name: platform-secrets}\n  secretName: db-credentials\n  remoteRef:\n    key: platform/db\n";

  assert.equal(redactManifest(manifest), manifest);
});
