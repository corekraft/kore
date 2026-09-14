import { expect, test } from "vitest";
import { loadRepository } from "./config.js";
import { appStatus, appUp, imageReleaseArgs, verifyLockedImageArgs } from "./app.js";
import type { RunOptions, RunResult, Runner } from "./runner.js";

class UnreadyPlatformRunner implements Runner {
  calls: string[] = [];

  async run(
    command: string,
    args: readonly string[],
    _options?: RunOptions,
  ): Promise<RunResult> {
    this.calls.push(`${command} ${args.join(" ")}`);
    if (command === "helm" && args[0] === "status") {
      throw new Error("release is missing");
    }
    if (command === "minikube" && args[0] === "status") {
      return { stdout: '{"Host":"Running"}', stderr: "", code: 0 };
    }
    if (command === "kubectl") {
      return { stdout: "kube-system", stderr: "", code: 0 };
    }
    return { stdout: "", stderr: "", code: 0 };
  }
}

test("app up stops before installing resources when the platform is not ready", async () => {
  const repository = await loadRepository("local");
  const runner = new UnreadyPlatformRunner();

  await expect(appUp(repository, runner, "reference")).rejects.toThrow(
    /platform.*ready|missing/i,
  );
  expect(runner.calls.some((call) => call.includes(" upgrade "))).toBe(false);
});

test("workload release uses the immutable locked image reference", async () => {
  const repository = await loadRepository("local");
  expect(imageReleaseArgs(repository, "reference", {
    reference: "registry.kore.local/reference@sha256:" + "a".repeat(64),
    digest: "sha256:" + "a".repeat(64),
    signer: "release@kore.dev",
  })).toEqual([
    "--set-string", "image.repository=registry.kore.local/reference",
    "--set-string", "image.digest=sha256:" + "a".repeat(64),
  ]);
});

test("image verification is bound to the locked signer and digest", () => {
  expect(verifyLockedImageArgs({
    reference: "registry.kore.local/reference@sha256:" + "a".repeat(64),
    digest: "sha256:" + "a".repeat(64),
    signer: "release@kore.dev",
  })).toEqual([
    "verify",
    "--certificate-identity", "release@kore.dev",
    "--certificate-oidc-issuer", "https://token.actions.githubusercontent.com",
    "registry.kore.local/reference@sha256:" + "a".repeat(64),
  ]);
});

test("app status reports locked image provenance", async () => {
  const repository = await loadRepository("local");
  const runner: Runner = { async run(command, args) {
    if (command === "kubectl") return { stdout: "kube-system", stderr: "", code: 0 };
    if (command === "helm") return { stdout: '{"info":{"status":"deployed"}}', stderr: "", code: 0 };
    return { stdout: "", stderr: "", code: 0 };
  } };
  const status = await appStatus(repository, runner, "reference");
  expect(status.image).toEqual({
    reference: "registry.kore.local/reference@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    digest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    signer: "release@kore.dev",
  });
});
