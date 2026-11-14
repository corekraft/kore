import { beforeEach, expect, test, vi } from "vitest";
import { isSensitiveName } from "../runtime/index.js";
import { redactManifest } from "./render-redaction.js";

// The runtime's name rule is another unit's behaviour, so it is a typed stub
// here. The redaction marker is a constant and stays the real value.
vi.mock("../runtime/index.js", () => ({
  isSensitiveName: vi.fn(),
  redactionMarker: "<redacted>",
}));

const sensitive = /secret|password|token|credential/i;

beforeEach(() => {
  vi.mocked(isSensitiveName).mockImplementation((name) => sensitive.test(name));
});

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

  expect(out).not.toContain("c3VwZXItc2VjcmV0LXVzZXI=");
  expect(out).not.toContain("aHVudGVyMg==");
  expect(out).not.toContain("plain-text-secret");
  expect(out).not.toContain("other=line");
  expect(out).not.toContain("plain-value-123");
  expect(out).toMatch(/username: <redacted>/);
  expect(out).toMatch(/config: <redacted>/);
});

test("redaction keeps the keys and structure of Secrets and of other documents", () => {
  const out = redactManifest(secretManifest);

  expect(out).toContain(
    "apiVersion: v1\nkind: Secret\nmetadata:\n  name: db\n",
  );
  expect(out).toContain("---\n");
  expect(out).toContain("kind: ConfigMap\n");
  expect(out).toContain("greeting: hello");
});

test("redaction hides inline flow-style Secret data", () => {
  const out = redactManifest(
    "kind: Secret\ndata: {password: aHVudGVyMg==}\nstringData: {token: abc123}\n",
  );

  expect(out).not.toContain("aHVudGVyMg==");
  expect(out).not.toContain("abc123");
});

test("redaction hides values under keys the runtime names sensitive, outside Secrets", () => {
  const out = redactManifest(
    "kind: Deployment\nenv:\n  - name: X\n    password: hunter2\n  token: abc.def\n",
  );

  expect(out).toBe(
    "kind: Deployment\nenv:\n  - name: X\n    password: <redacted>\n  token: <redacted>\n",
  );
});

test("redaction leaves a key the runtime does not name sensitive exactly as written", () => {
  const manifest = "kind: Deployment\nspec:\n  replicas: 3\n  image: app\n";

  expect(redactManifest(manifest)).toBe(manifest);
  expect(isSensitiveName).toHaveBeenCalledWith("replicas");
});

test("redaction leaves secret references and ordinary keys readable even when the runtime names them sensitive", () => {
  const manifest =
    "kind: ExternalSecret\nspec:\n  secretStoreRef: {name: platform-secrets}\n  secretName: db-credentials\n  remoteRef:\n    key: platform/db\n";

  expect(redactManifest(manifest)).toBe(manifest);
});
