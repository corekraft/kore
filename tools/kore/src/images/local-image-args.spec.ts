import { expect, test } from "vitest";
import {
  imageDigestFromRegistryHead,
  minikubeImagePublishArgs,
} from "./local-image-args.js";

const digest = (char: string): string => `sha256:${char.repeat(64)}`;

test("publishing refuses a registry address that is not an IPv4 ClusterIP", () => {
  expect(() =>
    minikubeImagePublishArgs(
      "p",
      "tag",
      "10.0.0.8:5000; rm -rf /",
      "repo:kore-local",
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
