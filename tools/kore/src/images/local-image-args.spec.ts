import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { expect, test, vi } from "vitest";
import {
  imageDigestFromRegistryHead,
  k3dImageImportArgs,
  k3dImagePublishArgs,
  k3dRegistrySessionArgs,
  localDockerBuildArgs,
  localSignArgs,
  newRunTag,
  shellQuote,
} from "./local-image-args.js";

vi.mock("node:crypto");
vi.mock("node:path");

const digest = (char: string): string => `sha256:${char.repeat(64)}`;

test("a docker build reads the Dockerfile from the application path and tags the image", () => {
  vi.mocked(join).mockReturnValue("/apps/reference/Dockerfile");

  expect(
    localDockerBuildArgs("/apps/reference", "kore-local/reference:run"),
  ).toEqual([
    "build",
    "--file",
    "/apps/reference/Dockerfile",
    "--tag",
    "kore-local/reference:run",
    "/apps/reference",
  ]);
  expect(join).toHaveBeenCalledWith("/apps/reference", "Dockerfile");
});

test("an image import names the tag and the cluster it goes into", () => {
  expect(k3dImageImportArgs("kore-local", "kore-local/reference:run")).toEqual([
    "image",
    "import",
    "kore-local/reference:run",
    "--cluster",
    "kore-local",
  ]);
});

test("shell quoting wraps a value in single quotes and escapes an embedded one", () => {
  expect(shellQuote("reference")).toBe("'reference'");
  expect(shellQuote("it's")).toBe("'it'\\''s'");
});

test("a session refuses a registry address that is not host[:port]", () => {
  expect(() =>
    k3dRegistrySessionArgs("kore-local", "10.0.0.8:5000; rm -rf /", "CA", []),
  ).toThrow(/invalid registry address.*fix registry.address/);
});

test("a session refuses a cluster name that is not lowercase letters, digits and hyphens", () => {
  expect(() =>
    k3dRegistrySessionArgs("Kore_Local", "10.96.0.50:5000", "CA", []),
  ).toThrow(/k3d cluster name "Kore_Local" is invalid/);
});

test("a session runs its commands inside the cluster's server node after the credential is read", () => {
  const args = k3dRegistrySessionArgs("kore-local", "10.96.0.50:5000", "CA", [
    "echo done",
  ]);

  expect(args.slice(0, 5)).toEqual([
    "exec",
    "--interactive",
    "k3d-kore-local-server-0",
    "sh",
    "-c",
  ]);
  const script = args[5] ?? "";
  expect(script.split("\n").slice(0, 2)).toEqual([
    "set -e",
    expect.stringContaining("/dev/shm"),
  ]);
  expect(script).toContain(`server = "https://10.96.0.50:5000"`);
  expect(script).toContain(`IFS= read -r t`);
  expect(script.split("\n").slice(-2)).toEqual(["unset t", "echo done"]);
});

test("a session never puts a registry credential literal in an argument; it arrives on stdin", () => {
  const args = k3dRegistrySessionArgs("kore-local", "10.96.0.50:5000", "CA", [
    "true",
  ]);

  expect(args.join(" ")).not.toMatch(/Basic [A-Za-z0-9+/=]{8,}/);
  expect(args.join(" ")).toContain(`IFS= read -r t`);
});

test("publishing refuses a registry address that is not an IPv4 ClusterIP", () => {
  expect(() =>
    k3dImagePublishArgs(
      "p",
      "tag",
      "10.0.0.8:5000; rm -rf /",
      "repo:kore-local",
      "CA",
    ),
  ).toThrow(/invalid registry address/);
});

test("publishing tags the image into the registry, then pushes it and names its digest", () => {
  const script = k3dImagePublishArgs(
    "kore-local",
    "kore-local/reference:run",
    "10.96.0.50:5000",
    "reference:run",
    "CA",
  )[5];

  expect(script).toContain(
    "ctr --namespace k8s.io images tag --force 'docker.io/kore-local/reference:run' '10.96.0.50:5000/reference:run'",
  );
  expect(script).toContain(
    `ctr --namespace k8s.io images push --hosts-dir "$d" '10.96.0.50:5000/reference:run'`,
  );
  expect(script).toContain(`test -n "$g"`);
});

test("publishing keeps a tag that already names its registry host", () => {
  const script = k3dImagePublishArgs(
    "kore-local",
    "registry.kore.local:30500/reference:run",
    "10.96.0.50:5000",
    "reference:run",
    "CA",
  )[5];

  expect(script).toContain("--force 'registry.kore.local:30500/reference:run'");
  expect(script).not.toContain("docker.io/registry.kore.local");
});

test("a registry answering with conflicting manifest digests is rejected", () => {
  const headers = `Docker-Content-Digest: ${digest("a")}\r\nDocker-Content-Digest: ${digest("b")}\r\n`;
  expect(() => imageDigestFromRegistryHead(200, headers)).toThrow(
    /one valid manifest digest/,
  );
});

test("repeated identical manifest digests are accepted as one", () => {
  const line = `Docker-Content-Digest: ${digest("c")}\r\n`;
  expect(imageDigestFromRegistryHead(200, line + line)).toBe(digest("c"));
});

test("a manifest lookup that does not answer 200 reports the status", () => {
  expect(() => imageDigestFromRegistryHead(404, "")).toThrow(
    "local registry manifest lookup failed with HTTP 404",
  );
});

test("local signatures use the legacy tag format Policy Controller 0.13 reads for key authorities", () => {
  const args = localSignArgs(
    "k8s://kore-system/key",
    "10.96.0.50:5000/app@sha256:x",
    "/tmp/ca.crt",
  );
  expect(args).toEqual([
    "sign",
    "--key",
    "k8s://kore-system/key",
    "--new-bundle-format=false",
    "--use-signing-config=false",
    "--tlog-upload=false",
    "--registry-cacert",
    "/tmp/ca.crt",
    "--yes",
    "10.96.0.50:5000/app@sha256:x",
  ]);
  expect(args).not.toContain("--signing-config");
});

test("each build gets its own run tag from six random bytes", () => {
  vi.mocked(randomBytes as (size: number) => Buffer).mockReturnValue(
    Buffer.from("aabbccddeeff", "hex"),
  );

  expect(newRunTag()).toBe("kore-local-aabbccddeeff");
  expect(randomBytes).toHaveBeenCalledWith(6);
});
