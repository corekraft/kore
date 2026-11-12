import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { loadRepository, type Repository } from "../config/index.js";
import {
  encodeBase64,
  entry,
  fakeRunner,
  pushPassword,
  stubRegistry,
} from "./local-image-fixtures.js";
import { buildAndSignLocalImage } from "./local-image.js";
import {
  k3dImagePublishArgs,
  k3dRegistrySessionArgs,
} from "./local-image-args.js";

const registryReference = vi.hoisted(() => vi.fn());
vi.mock("./registry.js", () => ({ localRegistryReference: registryReference }));
const registryHead = vi.hoisted(() => vi.fn());
vi.mock("./registry-https.js", () => ({ registryHead }));

const roots: string[] = [];
afterEach(async () => {
  registryReference.mockReset();
  registryHead.mockReset();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

async function k3dRepository(): Promise<Repository> {
  const root = await mkdtemp(join(tmpdir(), "kore-k3d-publish-"));
  roots.push(root);
  const base = await loadRepository("local");
  const { cluster: _cluster, ...environment } = base.environment;
  return {
    ...base,
    root,
    environment: {
      ...environment,
      provider: "k3d",
      kubeContext: "k3d-kore-local",
      k3d: {
        clusterName: "kore-local",
        serviceCidr: "10.96.0.0/12",
        ports: [{ hostPort: 8443, loadBalancerPort: 443 }],
      },
    },
  };
}

const basic = encodeBase64(`kore-push:${pushPassword}`);

test("k3d publishes through the node's containerd client with docker exec, and no node shell", async () => {
  const { runner, calls } = fakeRunner();
  stubRegistry(registryReference, registryHead);

  await buildAndSignLocalImage(
    await k3dRepository(),
    runner,
    "reference",
    entry,
  );

  const commands = calls.map(({ command }) => command);
  expect(commands).not.toContain("minikube");
  expect(commands).not.toContain("ssh");
  const publish = calls.find(
    (c) => c.command === "docker" && c.args[0] === "exec",
  )!;
  expect(publish.args.slice(0, 3)).toEqual([
    "exec",
    "--interactive",
    "k3d-kore-local-server-0",
  ]);
  expect(publish.args.join(" ")).toContain("ctr");
  expect(publish.args.join(" ")).toContain("push");
});

test("the k3d push credential travels only on stdin, never in an argument", async () => {
  const { runner, calls } = fakeRunner();
  stubRegistry(registryReference, registryHead);

  await buildAndSignLocalImage(
    await k3dRepository(),
    runner,
    "reference",
    entry,
  );

  const publish = calls.find(
    (c) => c.command === "docker" && c.args[0] === "exec",
  )!;
  expect(publish.options?.input).toBe(`${basic}\n`);
  const everyArgument = JSON.stringify(calls.map((c) => c.args));
  expect(everyArgument).not.toContain(pushPassword);
  expect(everyArgument).not.toContain(basic);
});

test("the k3d node keeps the credential in memory-backed storage and removes it on every exit", () => {
  const args = k3dImagePublishArgs(
    "kore-local",
    "kore-local/reference:kore-local",
    "10.96.0.50:5000",
    "reference:kore-local",
    "CA",
  );
  const script = args.join(" ");
  expect(script).toContain("/dev/shm");
  expect(script).toMatch(/trap .*rm -rf/);
  expect(script).toContain("IFS= read -r");
  expect(script).toContain("--hosts-dir");
});

test("a failed k3d publish never carries the credential in its error", async () => {
  const { runner } = fakeRunner();
  stubRegistry(registryReference, registryHead);
  const echoing: typeof runner = {
    async run(command, args, options) {
      if (command === "docker" && args[0] === "exec") {
        throw new Error(`docker exec failed (1): ${pushPassword} ${basic}`);
      }
      return runner.run(command, args, options);
    },
  };

  const error = await buildAndSignLocalImage(
    await k3dRepository(),
    echoing,
    "reference",
    entry,
  ).catch((e: unknown) => e as Error);

  if (!(error instanceof Error)) {
    throw new Error("the failed publish must reject");
  }
  expect(error.message).not.toContain(pushPassword);
  expect(error.message).not.toContain(basic);
  expect(String(error.stack)).not.toContain(pushPassword);
  expect(error.message).toContain("[REDACTED]");
});

test("the k3d session rejects a malformed address before running anything", () => {
  expect(() =>
    k3dRegistrySessionArgs("kore-local", "bad address;", "CA", ["true"]),
  ).toThrow(/invalid registry address/);
});
