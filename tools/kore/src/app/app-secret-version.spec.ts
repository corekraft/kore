import { loadRepository } from "../config/index.js";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, expect, test, vi } from "vitest";

const localRegistryReferenceMock = vi.hoisted(() => vi.fn());
vi.mock("../images/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../images/index.js")>()),
  localRegistryReference: localRegistryReferenceMock,
}));
import { findRoot } from "../config/config.js";

import { appUp, appUpRelease } from "./up.js";
import {
  healthyRunner,
  lockedImage,
  passthroughRegistry,
  removeReleaseLocks,
  repositoryTrustingRelease,
  writeReleaseLock,
  type Call,
} from "./app-fixtures.js";
import type { Runner } from "../runtime/index.js";

afterEach(removeReleaseLocks);

const run = promisify(execFile);
const rotationId = "0123456789abcdef";

function withRotationId(calls: Call[], id: string): Runner {
  const inner = healthyRunner(calls);
  return {
    async run(command, args, options) {
      if (
        command === "kubectl" &&
        args.includes("secret") &&
        args.includes("reference-app") &&
        args.some((arg) => arg.includes("platform\\.kore\\.dev/rotation-id"))
      ) {
        calls.push({ command, args });
        return {
          stdout: id ? `${id}|2026-11-09T10:00:00.400Z` : "|",
          stderr: "",
          code: 0,
        };
      }
      if (command === "kubectl" && args.includes("externalsecret")) {
        calls.push({ command, args });
        return {
          stdout: "2026-11-09T10:00:05Z|True|SecretSynced",
          stderr: "",
          code: 0,
        };
      }
      return inner.run(command, args, options);
    },
  };
}

function workloadSet(calls: Call[]): string[] {
  const upgrade = calls.find(
    ({ command, args }) =>
      command === "helm" && args[0] === "upgrade" && args[2] === "reference",
  );
  return (upgrade?.args ?? []).filter((arg) =>
    arg.startsWith("secretVersion="),
  );
}

test("the workload release carries a one-way digest of the source rotation id", async () => {
  const repository = await loadRepository("local");
  localRegistryReferenceMock.mockImplementation(passthroughRegistry);
  const calls: Call[] = [];
  await appUp(
    repository,
    withRotationId(calls, rotationId),
    "reference",
    lockedImage(),
    {
      publicKey: "/tmp/kore.pub",
    },
  );
  const expected = createHash("sha256")
    .update(rotationId)
    .digest("hex")
    .slice(0, 16);
  expect(workloadSet(calls)).toEqual([`secretVersion=${expected}`]);
  expect(workloadSet(calls)[0]).not.toContain(rotationId);
});

test("a release deploy carries the same secret version, so consumers roll on both paths", async () => {
  const repository = await repositoryTrustingRelease();
  localRegistryReferenceMock.mockImplementation(passthroughRegistry);
  const calls: Call[] = [];
  const lock = await writeReleaseLock(repository.root);
  await appUpRelease(
    repository,
    withRotationId(calls, rotationId),
    "reference",
    lock,
  );
  const expected = createHash("sha256")
    .update(rotationId)
    .digest("hex")
    .slice(0, 16);
  expect(workloadSet(calls)).toEqual([`secretVersion=${expected}`]);
});

test("a source without a rotation id adds no secret version, so legacy releases do not churn", async () => {
  const repository = await loadRepository("local");
  localRegistryReferenceMock.mockImplementation(passthroughRegistry);
  const calls: Call[] = [];
  await appUp(
    repository,
    withRotationId(calls, ""),
    "reference",
    lockedImage(),
    {
      publicKey: "/tmp/kore.pub",
    },
  );
  expect(workloadSet(calls)).toEqual([]);
});

test("the workload chart restarts pods when the secret version changes, without knowing the secret store", async () => {
  const chart = join(await findRoot(), "apps/reference/charts/workload");
  const render = async (...set: string[]): Promise<string> =>
    (
      await run("helm", [
        "template",
        "reference",
        chart,
        "--set",
        "platform.gateway.hostname=kore.local",
        ...set,
      ])
    ).stdout;
  const plain = await render();
  const rotated = await render("--set-string", "secretVersion=abc123");
  expect(plain).not.toContain("platform.kore.dev/secret-version");
  expect(
    rotated.match(/platform\.kore\.dev\/secret-version: "?abc123"?/g),
  ).toHaveLength(2);
  expect(rotated.toLowerCase()).not.toContain("externalsecret");
});
