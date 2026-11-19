import assert from "node:assert/strict";
import { expect, test, vi } from "vitest";
import { localRegistryReference } from "../../src/images/index.js";
import type { Repository } from "../../src/config/index.js";
import type { Runner } from "../../src/runtime/index.js";
import { localPlatform } from "../local-platform-support.js";

const platform = await localPlatform();

// The registry units read only the repository's environment, so a fake carries
// those fields alone. The one cast stands in for the rest of the Repository type.
const repositoryWith = (fields: object): Repository => fields as Repository;

const spawnMock = vi.hoisted(() => vi.fn());
const connectionOutcomes = vi.hoisted(() => [] as boolean[]);
vi.mock("node:child_process", () => ({ spawn: spawnMock }));
// The runner answers the registry CA read with a PEM, so the real CA read runs.
const caPem = "-----BEGIN CERTIFICATE-----\nQUJD\n-----END CERTIFICATE-----\n";
const caRunner: Runner = {
  run: async () => ({
    stdout: JSON.stringify({
      data: { "ca.crt": Buffer.from(caPem).toString("base64") },
    }),
    stderr: "",
    code: 0,
  }),
};
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
  const reference = await localRegistryReference(
    repositoryWith({
      kubeContext: "k3d-kore-local",
      environment: {
        provider: "k3d",
        kubeContext: "k3d-kore-local",
      },
    }),
    caRunner,
    `${platform.registry}/reference@sha256:` + "a".repeat(64),
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
            `${platform.registryPort}:5000`,
          ],
          input: undefined,
        });
        return 1234;
      },
      isPortOpen: async () => portChecks++ > 0,
    },
  );
  assert.equal(
    reference,
    `${platform.registryForward}/reference@sha256:` + "a".repeat(64),
  );
  assert.deepEqual(calls[0]!.args, [
    "--context",
    "k3d-kore-local",
    "--namespace",
    "kore-registry",
    "port-forward",
    "service/oci-registry",
    `${platform.registryPort}:5000`,
  ]);
});

test("managed registry references pass through without a local port forward", async () => {
  const reference = "registry.example.com/reference@sha256:" + "a".repeat(64);
  let started = false;

  await expect(
    localRegistryReference(
      repositoryWith({
        environment: { provider: "managed", kubeContext: "managed" },
      }),
      caRunner,
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
  const reference = `${platform.registry}/reference:dev`;
  let started = false;

  await expect(
    localRegistryReference(
      repositoryWith({
        environment: { provider: "k3d", kubeContext: "k3d-kore-local" },
      }),
      caRunner,
      reference,
      {
        isPortOpen: async () => true,
        spawnPortForward: () => {
          started = true;
          return 1;
        },
      },
    ),
  ).resolves.toBe(`${platform.registryForward}/reference:dev`);
  expect(started).toBe(false);
});

test("local registry setup reports when the port forward never becomes ready", async () => {
  const now = vi.spyOn(Date, "now");
  now.mockReturnValueOnce(0).mockReturnValueOnce(16_000);
  const spawnPortForward = vi.fn(() => 1234);

  await expect(
    localRegistryReference(
      repositoryWith({
        environment: { provider: "k3d", kubeContext: "k3d-kore-local" },
      }),
      caRunner,
      `${platform.registryHost}/reference:dev`,
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
  const repository = repositoryWith({
    environment: { provider: "k3d", kubeContext: "k3d-kore-local" },
  });

  try {
    await expect(
      localRegistryReference(
        repository,
        caRunner,
        `${platform.registryHost}/reference:dev`,
      ),
    ).resolves.toBe(`${platform.registryForward}/reference:dev`);
    expect(spawnMock).toHaveBeenCalledWith(
      "kubectl",
      [
        "--context",
        "k3d-kore-local",
        "--namespace",
        "kore-registry",
        "port-forward",
        "service/oci-registry",
        `${platform.registryPort}:5000`,
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
        repositoryWith({
          environment: { provider: "k3d", kubeContext: "k3d-kore-local" },
        }),
        caRunner,
        `${platform.registryHost}/reference:dev`,
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
    repositoryWith({
      environment: {
        provider: "k3d",
        kubeContext: "k3d-kore-local",
      },
    }),
    caRunner,
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
  expect(reference).toBe(`${platform.registryForward}/reference:kore-local`);
});
