import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { ensureRegistryTrust } from "../images/index.js";
import type { Runner } from "../runtime/index.js";
import { clusterUp } from "./cluster.js";
import {
  fakeRunner,
  fast,
  k3dRepository,
  text,
} from "./k3d-cluster.fixtures.js";
import { k3dCreateArgs } from "./k3d-cluster.js";

// Docs: docs/decisions/0084-k3d-registry-trust-through-a-mounted-ca-directory.md

const pem = "-----BEGIN CERTIFICATE-----\nQUJD\n-----END CERTIFICATE-----\n";
let home: string;
beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "kore-k3d-trust-"));
});
afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

const caRunner = (ca: string): Runner => ({
  async run(_command, args) {
    return {
      stdout: args.includes("oci-registry-tls")
        ? JSON.stringify({
            data: { "ca.crt": Buffer.from(ca).toString("base64") },
          })
        : "",
      stderr: "",
      code: 0,
    };
  },
});

const trustDirectory = () =>
  join(home, ".kore", "k3d", "kore-local", "registry-trust");

test("create mounts the CA directory and the k3s registry configuration into every node", async () => {
  const args = k3dCreateArgs(await k3dRepository(), trustDirectory());
  const volumes = args.flatMap((arg, i) =>
    args[i - 1] === "--volume" ? [arg] : [],
  );
  expect(volumes).toEqual([
    `${trustDirectory()}:/etc/kore/registry-ca@all`,
    `${trustDirectory()}/registries.yaml:/etc/rancher/k3s/registries.yaml@all`,
  ]);
});

test("create never uses a k3d-managed registry flag, so Kore's registry stays the only one", async () => {
  const args = k3dCreateArgs(await k3dRepository(), trustDirectory());
  expect(args.filter((arg) => arg.startsWith("--registry"))).toEqual([]);
});

test("cluster up writes a registries.yaml that names the registry address and its CA file before creating", async () => {
  const repository = await k3dRepository();
  const { runner, calls } = fakeRunner(undefined);
  const before = (): Promise<string> =>
    readFile(join(trustDirectory(), "registries.yaml"), "utf8");
  let atCreate = "";
  const watching: Runner = {
    async run(command, args, options) {
      if (command === "k3d" && args[1] === "create") {
        atCreate = await before();
      }
      return runner.run(command, args, options);
    },
  };
  await clusterUp(repository, watching, fast, home);
  expect(text(calls).some((line) => line.includes("cluster create"))).toBe(
    true,
  );
  expect(atCreate).toContain('"10.96.0.50:5000":');
  expect(atCreate).toContain("ca_file: /etc/kore/registry-ca/ca.crt");
  expect(atCreate).not.toMatch(/insecure|skip|mirrors|endpoint/);
});

test("trust writes the public CA into the host directory after issuance and runs no node shell", async () => {
  const repository = await k3dRepository();
  const calls: { command: string; args: readonly string[] }[] = [];
  const runner: Runner = {
    async run(command, args) {
      calls.push({ command, args });
      return {
        stdout: args.includes("oci-registry-tls")
          ? JSON.stringify({
              data: { "ca.crt": Buffer.from(pem).toString("base64") },
            })
          : "",
        stderr: "",
        code: 0,
      };
    },
  };
  await ensureRegistryTrust(repository, runner, home);
  expect(await readFile(join(trustDirectory(), "ca.crt"), "utf8")).toBe(pem);
  expect(calls.map((c) => c.command).sort()).toEqual(["kubectl", "kubectl"]);
  expect(JSON.stringify(calls)).not.toMatch(/ssh|exec|docker/);
  expect(await readFile(join(trustDirectory(), "ca.crt"), "utf8")).not.toMatch(
    /PRIVATE KEY/,
  );
});

test("cluster up writes registries.yaml before starting a stopped cluster, so Docker never creates the mount source as a directory", async () => {
  const repository = await k3dRepository();
  const { runner } = fakeRunner(0);
  let atStart = "";
  const watching: Runner = {
    async run(command, args, options) {
      if (command === "k3d" && args[1] === "start") {
        atStart = await readFile(
          join(trustDirectory(), "registries.yaml"),
          "utf8",
        );
      }
      return runner.run(command, args, options);
    },
  };
  await clusterUp(repository, watching, fast, home);
  expect(atStart).toContain("ca_file: /etc/kore/registry-ca/ca.crt");
});

test("the CA is replaced atomically: a second write swaps the content and leaves no temporary file", async () => {
  const repository = await k3dRepository();
  const second = pem.replace("QUJD", "REVG");
  for (const ca of [pem, second]) {
    await ensureRegistryTrust(repository, caRunner(ca), home);
  }
  expect(await readFile(join(trustDirectory(), "ca.crt"), "utf8")).toBe(second);
  expect(await readdir(trustDirectory())).toEqual(["ca.crt"]);
});

test("an external registry gets no trust mounts and writes no files on k3d", async () => {
  const base = await k3dRepository();
  const repository = {
    ...base,
    environment: {
      ...base.environment,
      registry: { address: "registry.example.com" },
    },
  };
  expect(
    k3dCreateArgs(repository, trustDirectory()).filter((arg) =>
      arg.startsWith("--volume"),
    ),
  ).toEqual([]);
  const { runner, calls } = fakeRunner(undefined);
  await clusterUp(repository, runner, fast, home);
  await ensureRegistryTrust(repository, caRunner(pem), home);
  expect(await readdir(home)).toEqual([]);
  expect(text(calls).some((line) => line.includes("--volume"))).toBe(false);
});
