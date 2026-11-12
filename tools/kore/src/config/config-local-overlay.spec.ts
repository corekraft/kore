import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "vitest";
import { loadRepository, validateRepository } from "./config.js";

test("the real local overlay is a valid k3d overlay with the matching kube context", async () => {
  const repository = await loadRepository("local");
  await validateRepository(repository);
  const { environment } = repository;
  assert.equal(environment.provider, "k3d");
  assert.equal(environment.cluster, undefined);
  assert.equal(
    environment.kubeContext,
    `k3d-${environment.k3d?.clusterName ?? ""}`,
  );
});

test("the load balancer maps the Gateway host port to the node port the overlay values publish", async () => {
  const repository = await loadRepository("local");
  const { gateway, k3d } = repository.environment;
  const values = await readFile(
    join(
      repository.root,
      "infra/environments/local/values/platform-config.yaml",
    ),
    "utf8",
  );
  const nodePort = Number(/^\s+nodePort:\s*(\d+)/m.exec(values)?.[1]);
  assert.deepEqual(
    k3d?.ports.filter((port) => port.hostPort === gateway.port),
    [{ hostPort: gateway.port, loadBalancerPort: nodePort }],
  );
});

async function files(directory: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory() && entry.name !== "node_modules") {
      found.push(...(await files(path)));
    } else if (entry.isFile()) {
      found.push(path);
    }
  }
  return found;
}

test("no application chart, platform chart or catalog entry mentions k3d", async () => {
  const { root } = await loadRepository("local");
  const candidates = [
    ...(await files(join(root, "apps"))),
    ...(await files(join(root, "infra/charts"))),
    join(root, "infra/catalog/components.yaml"),
  ];
  const mentions: string[] = [];
  for (const file of candidates) {
    if (/k3d/i.test(await readFile(file, "utf8"))) {
      mentions.push(file.slice(root.length + 1));
    }
  }
  assert.deepEqual(mentions, []);
});
