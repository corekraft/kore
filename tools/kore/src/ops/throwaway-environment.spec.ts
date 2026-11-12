import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";
import {
  THROWAWAY,
  installThrowawayEnvironment,
  throwawayEnvironment,
} from "./throwaway-environment.js";

const local = {
  name: "local",
  provider: "minikube",
  kubeContext: "kore-local",
  cluster: { profile: "kore-local", cpus: 4 },
  gateway: { hostname: "kore.local", port: 8443, name: "kore-gateway" },
  registry: { address: "10.96.0.50:5000" },
};

test("the throwaway environment shares nothing with kore-local that a destroy or tunnel could hit", () => {
  const env = throwawayEnvironment(local) as typeof local;
  assert.equal(env.name, THROWAWAY.name);
  assert.equal(env.kubeContext, THROWAWAY.profile);
  assert.equal(env.cluster.profile, THROWAWAY.profile);
  assert.notEqual(env.kubeContext, "kore-local");
  assert.equal(env.gateway.port, THROWAWAY.gatewayPort);
  assert.notEqual(env.gateway.port, local.gateway.port);
  assert.equal(env.cluster.cpus, 4, "everything else is inherited");
  assert.equal(local.name, "local", "the input is not mutated");
});

test("the overlay is written beside the tree's own local environment and removed again", async () => {
  const root = await mkdtemp(join(tmpdir(), "kore-throwaway-"));
  try {
    await mkdir(join(root, "infra/environments/local"), { recursive: true });
    await writeFile(
      join(root, "infra/environments/local/environment.yaml"),
      JSON.stringify(local),
    );
    const remove = await installThrowawayEnvironment(root);
    const written = JSON.parse(
      await readFile(
        join(root, `infra/environments/${THROWAWAY.name}/environment.yaml`),
        "utf8",
      ),
    ) as typeof local;
    assert.equal(written.cluster.profile, THROWAWAY.profile);
    await assert.rejects(installThrowawayEnvironment(root), /already exists/);
    await remove();
    await assert.rejects(
      readFile(
        join(root, `infra/environments/${THROWAWAY.name}/environment.yaml`),
      ),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
