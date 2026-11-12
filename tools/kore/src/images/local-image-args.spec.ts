import { expect, test } from "vitest";
import {
  imageDigestFromRegistryHead,
  localSignArgs,
  k3dImagePublishArgs,
} from "./local-image-args.js";

const digest = (char: string): string => `sha256:${char.repeat(64)}`;

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
