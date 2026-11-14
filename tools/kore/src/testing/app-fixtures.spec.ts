import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { describe, expect, test, vi } from "vitest";
import { CommandError } from "../runtime/index.js";
import {
  digest,
  gateOutput,
  healthyReadinessOutput,
  healthyRunner,
  lockedImage,
  passthroughRegistry,
  pushPassword,
  readPassword,
  releaseNotFound,
  releaseSigner,
  removeReleaseLocks,
  repositoryTrustingRelease,
  writeReleaseLock,
  type Call,
} from "./app-fixtures.js";
import { gatedOffReleaseAbsent } from "./webhook-fixtures.js";

// Docs: docs/decisions/0028-image-trust-authority.md
// The fixtures the platform and app specs share. Their repository, file and
// path calls are faked here, so this spec never reads the real checkout.

vi.mock("node:fs/promises", () => ({
  mkdtemp: vi.fn(),
  rm: vi.fn(),
  writeFile: vi.fn(),
}));
vi.mock("node:os", () => ({ tmpdir: vi.fn() }));
vi.mock("node:path", () => ({
  join: vi.fn(),
  relative: vi.fn(),
}));
vi.mock("../config/index.js", () => ({
  loadRepository: async () => ({
    environment: { name: "local" },
    imageTrustValues: { trust: { type: "keyless", subjects: [] } },
  }),
}));
vi.mock("../platform/index.js", () => ({
  platformGeneration: () => "generation-local",
}));
vi.mock("./registry-tls-fixtures.js", () => ({
  registryTlsSecret: "tls-secret-json",
}));
vi.mock("./webhook-fixtures.js", () => ({
  gatedOffReleaseAbsent: vi.fn(),
  healthyDaemonSetOutput: (args: readonly string[]) =>
    args.includes("daemonset") ? "daemonset-ok" : undefined,
  healthyWebhookOutput: (args: readonly string[]) =>
    args.includes("validatingwebhookconfiguration") ? "webhook-ok" : undefined,
}));

const decode = (value: string | undefined) =>
  Buffer.from(value ?? "", "base64").toString("utf8");

describe("the fixture constants and images", () => {
  test("the digest is a sha256 of 64 hex characters, and the passwords are long enough to spot in output", () => {
    expect(digest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(readPassword.length).toBeGreaterThan(20);
    expect(pushPassword.length).toBeGreaterThan(20);
  });

  test("lockedImage defaults to the local signer and registry, and takes overrides", () => {
    expect(lockedImage()).toEqual({
      reference: `registry.kore.local:30500/reference@${digest}`,
      digest,
      signer: "local-kore-key",
    });
    expect(lockedImage("other", "reg:1").reference).toBe(
      `reg:1/reference@${digest}`,
    );
  });

  test("gateOutput carries the state and the local generation unless one is given", () => {
    expect(JSON.parse(gateOutput("open"))).toEqual({
      spec: { parameters: { state: "open", generation: "generation-local" } },
    });
    expect(JSON.parse(gateOutput("closed", "g2")).spec.parameters).toEqual({
      state: "closed",
      generation: "g2",
    });
  });
});

describe("healthyReadinessOutput: what the cluster answers to the readiness probes", () => {
  test("the admission gate reads back open for the local generation", () => {
    expect(
      healthyReadinessOutput([
        "koreapplicationadmission.constraints.gatekeeper.sh",
      ]),
    ).toBe(gateOutput("open"));
  });

  test("the activation label reads back the local generation", () => {
    expect(healthyReadinessOutput(["platform\\.kore\\.dev/activation=x"])).toBe(
      "generation-local",
    );
  });

  test("the registry credentials decode to the push and read identities", () => {
    const secret = JSON.parse(
      healthyReadinessOutput(["oci-registry-credentials"]) ?? "{}",
    ) as { data: Record<string, string> };
    expect(decode(secret.data["push-username"])).toBe("kore-push");
    expect(decode(secret.data["push-password"])).toBe(pushPassword);
    expect(decode(secret.data["read-username"])).toBe("kore-read");
    expect(decode(secret.data["read-password"])).toBe(readPassword);
  });

  test("the registry TLS Secret and the Gateway Service are healthy", () => {
    expect(healthyReadinessOutput(["oci-registry-tls"])).toBe(
      "tls-secret-json",
    );
    const service = JSON.parse(
      healthyReadinessOutput(["service", "--selector", "app=x"]) ?? "{}",
    ) as { items: { status: { loadBalancer: unknown } }[] };
    expect(service.items[0]?.status.loadBalancer).toEqual({
      ingress: [{ ip: "127.0.0.1" }],
    });
  });

  test("a Gateway reads back Accepted, Programmed and ResolvedRefs", () => {
    const gateway = JSON.parse(
      healthyReadinessOutput(["gateway/edge"]) ?? "{}",
    ) as {
      status: {
        conditions: { type: string; status: string }[];
        listeners: { conditions: { type: string; status: string }[] }[];
      };
    };
    expect(gateway.status.conditions.map(({ type }) => type)).toEqual([
      "Accepted",
      "Programmed",
    ]);
    expect(gateway.status.listeners[0]?.conditions[0]).toEqual({
      type: "ResolvedRefs",
      status: "True",
    });
  });

  test("the webhook, DaemonSet, namespace label and go-template answers come from their fixtures", () => {
    expect(healthyReadinessOutput(["validatingwebhookconfiguration"])).toBe(
      "webhook-ok",
    );
    expect(healthyReadinessOutput(["daemonset"])).toBe("daemonset-ok");
    expect(
      healthyReadinessOutput(["policy\\.sigstore\\.dev/include=true"]),
    ).toBe("true");
    expect(healthyReadinessOutput(["go-template=ready"])).toBe("ready");
  });

  test("a probe no fixture answers gets no output", () => {
    expect(healthyReadinessOutput(["get", "pods"])).toBeUndefined();
  });
});

describe("releaseNotFound: the history of a release that was never installed", () => {
  test("delegates to the gated-off check first, for every command", () => {
    releaseNotFound("helm", ["status"]);
    expect(gatedOffReleaseAbsent).toHaveBeenCalledWith("helm", ["status"]);
  });

  test("helm history fails with Helm's not-found error", () => {
    expect(() => releaseNotFound("helm", ["history", "kore"])).toThrow(
      CommandError,
    );
  });

  test("any other command passes through without an error", () => {
    expect(() => releaseNotFound("kubectl", ["get", "pods"])).not.toThrow();
  });
});

describe("healthyRunner: a healthy local cluster that records every call", () => {
  test("records each call with its command and arguments before answering", async () => {
    const calls: Call[] = [];
    await healthyRunner(calls).run("kubectl", ["get", "pods"]);
    expect(calls).toEqual([{ command: "kubectl", args: ["get", "pods"] }]);
  });

  test("answers the local k3d cluster as running", async () => {
    const result = await healthyRunner([]).run("k3d", ["cluster", "list"]);
    expect(JSON.parse(result.stdout)).toEqual([
      expect.objectContaining({
        name: "kore-local",
        serversRunning: 1,
        agentsRunning: 0,
      }),
    ]);
    expect(result.code).toBe(0);
  });

  test("answers helm status as deployed", async () => {
    const result = await healthyRunner([]).run("helm", ["status", "kore"]);
    expect(JSON.parse(result.stdout)).toEqual({
      info: { status: "deployed" },
    });
  });

  test("answers a clusterIP read with the cluster address, which a caller may set", async () => {
    const defaults = await healthyRunner([]).run("kubectl", [
      "get",
      "svc",
      "-o=jsonpath={.spec.clusterIP}",
    ]);
    const chosen = await healthyRunner([], "10.1.1.1").run("kubectl", [
      "get",
      "svc",
      "-o=jsonpath={.spec.clusterIP}",
    ]);
    expect(defaults.stdout).toBe("10.96.0.50");
    expect(chosen.stdout).toBe("10.1.1.1");
  });

  test("names the reference deployments for an --output=name read, and the namespace for a namespace read", async () => {
    const names = await healthyRunner([]).run("kubectl", [
      "get",
      "deploy",
      "--output=name",
    ]);
    const namespace = await healthyRunner([]).run("kubectl", [
      "get",
      "namespace",
    ]);
    expect(names.stdout).toBe(
      "deployment/reference-api\ndeployment.apps/reference-worker\n",
    );
    expect(namespace.stdout).toBe("kube-system");
  });

  test("a kubectl readiness probe gets its fixture answer", async () => {
    const result = await healthyRunner([]).run("kubectl", [
      "get",
      "gateway/edge",
    ]);
    expect(JSON.parse(result.stdout).status.conditions).toHaveLength(2);
  });

  test("an unanswered command returns empty output", async () => {
    const result = await healthyRunner([]).run("docker", ["ps"]);
    expect(result).toEqual({ stdout: "", stderr: "", code: 0 });
  });
});

describe("healthyRunner: failures", () => {
  test("a call the fail predicate names throws before any answer", async () => {
    const runner = healthyRunner(
      [],
      undefined,
      ({ command }) => command === "cosign",
    );
    await expect(runner.run("cosign", ["sign"])).rejects.toThrow(
      "cosign failed",
    );
  });

  test("a helm history call throws Helm's not-found error from the release check", async () => {
    await expect(
      healthyRunner([]).run("helm", ["history", "kore"]),
    ).rejects.toBeInstanceOf(CommandError);
  });
});

describe("passthroughRegistry and the release lock files", () => {
  test("passthroughRegistry returns the reference unchanged", async () => {
    expect(await passthroughRegistry({}, {}, "r/x@sha256:1")).toBe(
      "r/x@sha256:1",
    );
  });

  test("writeReleaseLock writes the lock under a fresh directory and returns its path relative to the root", async () => {
    vi.mocked(tmpdir).mockReturnValue("/tmp");
    vi.mocked(mkdtemp).mockResolvedValue("/tmp/kore-release-lock-1");
    vi.mocked(join).mockImplementation((...parts: string[]) => parts.join("/"));
    vi.mocked(relative).mockReturnValue("rel/images.lock.json");

    const path = await writeReleaseLock("/repo");

    expect(mkdtemp).toHaveBeenCalledWith("/tmp/kore-release-lock-");
    expect(relative).toHaveBeenCalledWith(
      "/repo",
      "/tmp/kore-release-lock-1/images.lock.json",
    );
    expect(path).toBe("rel/images.lock.json");
    const [file, body] = vi.mocked(writeFile).mock.calls[0]!;
    expect(file).toBe("/tmp/kore-release-lock-1/images.lock.json");
    if (typeof body !== "string") {
      throw new Error("the lock was not written as text");
    }
    expect(JSON.parse(body)).toMatchObject({
      version: 1,
      authorizedSigners: [releaseSigner],
      entries: { reference: { digest, signer: releaseSigner } },
    });
  });

  test("removeReleaseLocks deletes every lock directory written so far, then none", async () => {
    vi.mocked(mkdtemp).mockResolvedValue("/tmp/kore-release-lock-9");
    vi.mocked(join).mockImplementation((...parts: string[]) => parts.join("/"));
    vi.mocked(relative).mockReturnValue("x");
    // Directories an earlier test wrote are still tracked; drain them first.
    await removeReleaseLocks();
    vi.mocked(rm).mockClear();
    await writeReleaseLock("/repo");

    await removeReleaseLocks();
    await removeReleaseLocks();

    expect(rm).toHaveBeenCalledTimes(1);
    expect(rm).toHaveBeenCalledWith("/tmp/kore-release-lock-9", {
      force: true,
      recursive: true,
    });
  });
});

describe("repositoryTrustingRelease", () => {
  test("trusts the release signer by default, as a keyless subject in warn mode", async () => {
    const repository = await repositoryTrustingRelease();
    expect(repository.imageTrustValues).toEqual({
      trust: { type: "keyless", mode: "warn", subjects: [releaseSigner] },
    });
  });

  test("trusts the signer it is given instead of the release one", async () => {
    const repository = await repositoryTrustingRelease("other@ref");
    expect(repository.imageTrustValues).toEqual({
      trust: { type: "keyless", mode: "warn", subjects: ["other@ref"] },
    });
  });
});
