import { expect, test } from "vitest";
import { copyFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadRepository } from "../config/index.js";
import { appStatus, appDown } from "./app.js";
import type { Runner } from "../runtime/index.js";

test("app down uninstalls the named workload release", async () => {
  const repository = await loadRepository("local");
  const calls: { command: string; args: readonly string[] }[] = [];
  const runner: Runner = {
    async run(command, args) {
      calls.push({ command, args });
      if (command === "kubectl") {
        return { stdout: "kube-system", stderr: "", code: 0 };
      }
      return { stdout: "", stderr: "", code: 0 };
    },
  };

  await appDown(repository, runner, "reference");

  expect(calls.at(-1)).toEqual({
    command: "helm",
    args: [
      "uninstall",
      "reference",
      "--namespace=reference",
      "--kube-context",
      "kore-local",
      "--wait",
      "--timeout=10m",
    ],
  });
});

test("app status reports locked image provenance", async () => {
  const base = await loadRepository("local");
  const root = await mkdtemp(join(tmpdir(), "kore-app-status-"));
  await mkdir(join(root, "infra/catalog"), { recursive: true });
  await copyFile(
    join(base.root, "infra/catalog/images.lock.json"),
    join(root, "infra/catalog/images.lock.json"),
  );
  const repository = { ...base, root };
  const runner: Runner = {
    async run(command, _args) {
      if (command === "kubectl") {
        return { stdout: "kube-system", stderr: "", code: 0 };
      }
      if (command === "helm") {
        return {
          stdout: '{"info":{"status":"deployed"}}',
          stderr: "",
          code: 0,
        };
      }
      return { stdout: "", stderr: "", code: 0 };
    },
  };
  try {
    const status = await appStatus(repository, runner, "reference");
    expect(status.image).toEqual({
      reference:
        "registry.kore.local:30500/reference@sha256:76eae6c0774b5292f70e3541e57bd8f2b4df2e5f74aacaba258fed9fa894b3bc",
      digest:
        "sha256:76eae6c0774b5292f70e3541e57bd8f2b4df2e5f74aacaba258fed9fa894b3bc",
      signer: "local-kore-key",
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("app status prefers the local image lock when present", async () => {
  const base = await loadRepository("local");
  const root = await mkdtemp(join(tmpdir(), "kore-app-status-local-lock-"));
  await mkdir(join(root, ".kore/state"), { recursive: true });
  await copyFile(
    join(base.root, "infra/catalog/images.lock.json"),
    join(root, ".kore/state/local-images.lock.json"),
  );
  const runner: Runner = {
    async run(command) {
      if (command === "kubectl") {
        return { stdout: "kube-system", stderr: "", code: 0 };
      }
      return {
        stdout: '{"info":{"status":"deployed"}}',
        stderr: "",
        code: 0,
      };
    },
  };
  try {
    const status = await appStatus({ ...base, root }, runner, "reference");
    expect(status.image).toMatchObject({ signer: "local-kore-key" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
