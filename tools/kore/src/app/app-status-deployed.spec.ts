import { loadMinikubeLocal } from "../config/minikube-local-support.js";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";

import type { Runner } from "../runtime/index.js";
import { digest, releaseSigner } from "./app-fixtures.js";
import { appStatus } from "./app.js";

// Exit criterion: status reports the deployed digest, verified signer
// identity, registry, and namespace image-enforcement state without exposing
// credentials (ADR 0063).

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((r) => rm(r, { recursive: true, force: true })),
  );
});

async function statusFor(options: {
  signer?: string;
  deployedDigest?: string | undefined;
  enrolled?: string;
}) {
  const base = await loadMinikubeLocal();
  const root = await mkdtemp(join(tmpdir(), "kore-app-status-deployed-"));
  roots.push(root);
  const signer = options.signer ?? releaseSigner;
  await mkdir(join(root, "infra/catalog"), { recursive: true });
  await writeFile(
    join(root, "infra/catalog/images.lock.json"),
    JSON.stringify({
      version: 1,
      authorizedSigners: [signer],
      entries: {
        reference: {
          image: "registry.kore.local:30500/reference",
          digest,
          signer,
        },
      },
    }),
  );
  const calls: string[][] = [];
  const runner: Runner = {
    async run(command, args) {
      calls.push([command, ...args]);
      const ok = (stdout: string) => ({ stdout, stderr: "", code: 0 });
      if (command === "helm" && args[0] === "get") {
        return ok(
          JSON.stringify({
            image: {
              repository: "registry.kore.local:30500/reference",
              ...(options.deployedDigest !== undefined && {
                digest: options.deployedDigest,
              }),
            },
          }),
        );
      }
      if (command === "helm") {
        return ok('{"info":{"status":"deployed"}}');
      }
      if (args.some((arg) => arg.includes("policy\\.sigstore\\.dev/include"))) {
        return ok(options.enrolled ?? "true");
      }
      return ok("kube-system");
    },
  };
  const status = await appStatus({ ...base, root }, runner, "reference");
  return { status, calls };
}

test("status reports the deployed digest, registry, signer identity and enrollment", async () => {
  const { status } = await statusFor({ deployedDigest: digest });
  expect(status["deployed"]).toEqual({
    digest,
    registry: "registry.kore.local:30500",
    matchesLock: true,
    signer: releaseSigner,
    signerKind: "release-automation",
    namespaceImageEnforcement: "enrolled",
    environmentImageInventory: "audit",
  });
});

test("status says so when the deployed digest differs from the lock", async () => {
  const { status } = await statusFor({
    deployedDigest: "sha256:" + "b".repeat(64),
  });
  expect(status["deployed"]).toMatchObject({
    digest: "sha256:" + "b".repeat(64),
    matchesLock: false,
  });
});

test("status marks a local developer signature and an unenrolled namespace", async () => {
  const { status } = await statusFor({
    signer: "local-kore-key",
    deployedDigest: digest,
    enrolled: "",
  });
  expect(status["deployed"]).toMatchObject({
    signerKind: "local-developer-key",
    namespaceImageEnforcement: "not enrolled",
  });
});

test("a release that reports no digest leaves the digest unknown instead of guessing", async () => {
  const { status } = await statusFor({ deployedDigest: undefined });
  expect(status["deployed"]).toMatchObject({ digest: "unknown" });
  expect(status["deployed"]).toMatchObject({ matchesLock: false });
});

test("status reads only user-supplied release values and never a Secret", async () => {
  const { calls } = await statusFor({ deployedDigest: digest });
  const gets = calls.filter((c) => c[0] === "helm" && c[1] === "get");
  expect(gets.map((c) => c[2])).toEqual(["values"]);
  expect(gets[0]).not.toContain("--all");
  expect(calls.some((c) => c.includes("secret") || c.includes("secrets"))).toBe(
    false,
  );
});
