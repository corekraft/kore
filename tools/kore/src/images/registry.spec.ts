import assert from "node:assert/strict";
import { expect, test, vi } from "vitest";
import { localRegistryReference } from "./registry.js";
import type { Runner } from "../runtime/index.js";

const spawnMock = vi.hoisted(() => vi.fn());
const connectionOutcomes = vi.hoisted(() => [] as boolean[]);
vi.mock("node:child_process", () => ({ spawn: spawnMock }));
vi.mock("./registry-tls.js", () => ({
  loadRegistryCa: async () => "ca-pem",
}));
vi.mock("node:tls", () => ({
  connect: vi.fn(() => {
    const connected = connectionOutcomes.shift() ?? false;
    // A live forward accepts the connection and answers the probe request.
    return {
      once(event: string, callback: (chunk?: Buffer) => void) {
        if (connected && event === "secureConnect") {
          queueMicrotask(() => callback());
        } else if (connected && event === "data") {
          setTimeout(() => callback(Buffer.from("HTTP/1.1 401 \r\n")), 0);
        } else if (!connected && event === "error") {
          queueMicrotask(() => callback());
        }
        return this;
      },
      write() {
        return true;
      },
      destroy() {},
    };
  }),
}));

test("local registry verification starts a host-side port forward", async () => {
  const calls: {
    command: string;
    args: readonly string[];
    input: string | undefined;
  }[] = [];
  let portChecks = 0;
  const runner: Runner = {
    async run(command, args, options) {
      calls.push({ command, args, input: options?.input });
      return { stdout: "", stderr: "", code: 0 };
    },
  };

  const reference = await localRegistryReference(
    {
      kubeContext: "k3d-kore-local",
      environment: {
        provider: "k3d",
        kubeContext: "k3d-kore-local",
      },
    } as never,
    runner,
    "registry.kore.local:30500/reference@sha256:" + "a".repeat(64),
    {
      spawnPortForward: (repository) => {
        calls.push({
          command: "kubectl",
          args: [
            "--context",
            repository.environment.kubeContext,
            "--namespace",
            "kore-registry",
            "port-forward",
            "service/oci-registry",
            "30500:5000",
          ],
          input: undefined,
        });
        return 1234;
      },
      isPortOpen: async () => portChecks++ > 0,
    },
  );
  assert.equal(reference, "127.0.0.1:30500/reference@sha256:" + "a".repeat(64));
  assert.deepEqual(calls[0]!.args, [
    "--context",
    "k3d-kore-local",
    "--namespace",
    "kore-registry",
    "port-forward",
    "service/oci-registry",
    "30500:5000",
  ]);
});

test("managed registry references pass through without a local port forward", async () => {
  const reference = "registry.example.com/reference@sha256:" + "a".repeat(64);
  let started = false;

  await expect(
    localRegistryReference(
      {
        environment: { provider: "managed", kubeContext: "managed" },
      } as never,
      {} as Runner,
      reference,
      {
        spawnPortForward: () => {
          started = true;
          return 1;
        },
      },
    ),
  ).resolves.toBe(reference);
  expect(started).toBe(false);
});

test("an already available local registry avoids starting another port forward", async () => {
  const reference = "registry.kore.local:30500/reference:dev";
  let started = false;

  await expect(
    localRegistryReference(
      {
        environment: { provider: "k3d", kubeContext: "k3d-kore-local" },
      } as never,
      {} as Runner,
      reference,
      {
        isPortOpen: async () => true,
        spawnPortForward: () => {
          started = true;
          return 1;
        },
      },
    ),
  ).resolves.toBe("127.0.0.1:30500/reference:dev");
  expect(started).toBe(false);
});

test("local registry setup reports when the port forward never becomes ready", async () => {
  const now = vi.spyOn(Date, "now");
  now.mockReturnValueOnce(0).mockReturnValueOnce(16_000);
  const spawnPortForward = vi.fn(() => 1234);

  await expect(
    localRegistryReference(
      {
        environment: { provider: "k3d", kubeContext: "k3d-kore-local" },
      } as never,
      {} as Runner,
      "registry.kore.local/reference:dev",
      {
        isPortOpen: async () => false,
        spawnPortForward,
      },
    ),
  ).rejects.toThrow(/did not become ready/);
  expect(spawnPortForward).toHaveBeenCalledOnce();
});

test("default local registry setup starts kubectl and waits for its port", async () => {
  connectionOutcomes.push(false, true);
  const child = { pid: 1234, unref: vi.fn() };
  spawnMock.mockReturnValue(child);
  const repository = {
    environment: { provider: "k3d", kubeContext: "k3d-kore-local" },
  } as never;

  try {
    await expect(
      localRegistryReference(
        repository,
        {} as Runner,
        "registry.kore.local/reference:dev",
      ),
    ).resolves.toBe("127.0.0.1:30500/reference:dev");
    expect(spawnMock).toHaveBeenCalledWith(
      "kubectl",
      [
        "--context",
        "k3d-kore-local",
        "--namespace",
        "kore-registry",
        "port-forward",
        "service/oci-registry",
        "30500:5000",
      ],
      { detached: true, stdio: "ignore" },
    );
    expect(child.unref).toHaveBeenCalledOnce();
  } finally {
    connectionOutcomes.length = 0;
  }
});

test("default local registry setup fails if kubectl cannot start", async () => {
  connectionOutcomes.push(false);
  spawnMock.mockReturnValue({ pid: undefined, unref: vi.fn() });

  try {
    await expect(
      localRegistryReference(
        {
          environment: { provider: "k3d", kubeContext: "k3d-kore-local" },
        } as never,
        {} as Runner,
        "registry.kore.local/reference:dev",
      ),
    ).rejects.toThrow(/could not start the local OCI registry port-forward/);
  } finally {
    connectionOutcomes.length = 0;
  }
});

test("a k3d environment starts the registry port forward for its own context", async () => {
  let forwardedContext = "";
  let portChecks = 0;

  const reference = await localRegistryReference(
    {
      environment: {
        provider: "k3d",
        kubeContext: "k3d-kore-local",
      },
    } as never,
    {} as Runner,
    "10.96.0.50:5000/reference:kore-local",
    {
      spawnPortForward: (repository) => {
        forwardedContext = repository.environment.kubeContext;
        return 1;
      },
      isPortOpen: async () => portChecks++ > 0,
    },
  );

  expect(forwardedContext).toBe("k3d-kore-local");
  expect(reference).toBe("127.0.0.1:30500/reference:kore-local");
});
