// Docs: docs/decisions/0035-fail-fast-readiness-diagnosis.md
// Real units together, no cluster: app status reads the real platform status
// for the admission components. Only the runner is faked. A new managed
// workload is denied while the registry or signature verifier is unavailable,
// so app status says so rather than showing only Helm's view.
import { copyFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { appStatus } from "../src/app/index.js";
import { loadRepository } from "../src/config/index.js";
import type { Runner } from "../src/runtime/index.js";
import { healthyWebhookOutput, list } from "../src/testing/index.js";

type Down = "none" | "registry" | "verifier";

async function statusWith(down: Down) {
  const base = await loadRepository("local");
  const root = await mkdtemp(join(tmpdir(), "kore-app-status-admission-"));
  const calls: string[] = [];
  try {
    await mkdir(join(root, "infra/catalog"), { recursive: true });
    await copyFile(
      join(base.root, "infra/catalog/images.lock.json"),
      join(root, "infra/catalog/images.lock.json"),
    );
    const runner: Runner = {
      async run(command, args) {
        if (command === "k3d") {
          return { stdout: list(1), stderr: "", code: 0 };
        }
        const joined = args.join(" ");
        calls.push(`${command} ${joined}`);
        const ok = (stdout: string) => ({ stdout, stderr: "", code: 0 });
        if (command === "helm") {
          return ok('{"info":{"status":"deployed"}}');
        }
        const unavailable =
          (down === "registry" &&
            joined.includes("--namespace kore-registry") &&
            joined.includes("availableReplicas")) ||
          (down === "verifier" &&
            joined.includes("--namespace cosign-system") &&
            joined.includes("availableReplicas"));
        if (unavailable) {
          return ok("");
        }
        const healthy = healthyWebhookOutput(args);
        return ok(healthy ?? "kube-system");
      },
    };
    const status = await appStatus({ ...base, root }, runner, "reference");
    return { status, calls };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("app status reports ready when the registry and verifier are available", async () => {
  const { status } = await statusWith("none");
  expect(status["status"]).toBe("ready");
  expect(status["degraded"]).toEqual([]);
});

test("app status reports degraded and names the registry when it is unavailable", async () => {
  const { status } = await statusWith("registry");
  expect(status["status"]).toBe("degraded");
  const degraded = status["degraded"] as {
    component: string;
    detail: string;
  }[];
  expect(degraded.map(({ component }) => component)).toEqual(["oci-registry"]);
  expect(degraded[0]!.detail).toMatch(/deployment\/oci-registry/);
});

test("app status reports degraded and names the policy controller when the verifier is unavailable", async () => {
  const { status } = await statusWith("verifier");
  expect(status["status"]).toBe("degraded");
  const degraded = status["degraded"] as {
    component: string;
    detail: string;
  }[];
  expect(degraded.map(({ component }) => component)).toEqual([
    "policy-controller",
  ]);
  expect(degraded[0]!.detail).toMatch(/policy-controller-webhook/);
});

test("app status stays read-only while reporting degraded", async () => {
  const { calls } = await statusWith("registry");
  const mutating = calls.filter((call) =>
    /\b(apply|create|delete|patch|upgrade|install|replace|scale|label)\b/.test(
      call,
    ),
  );
  expect(mutating).toEqual([]);
});

test("app status has no tunnel entry and starts no host process", async () => {
  const { status, calls } = await statusWith("none");
  expect(status["status"]).toBe("ready");
  expect("tunnel" in status).toBe(false);
  expect(calls.some((call) => /tunnel/.test(call))).toBe(false);
});
