import assert from "node:assert/strict";
import { test } from "vitest";
import { loadRepository, type Repository } from "../config/index.js";
import type { Runner } from "../runtime/index.js";
import { imageInventory, imageInventoryStatus } from "./image-inventory.js";

// Docs: infra/plans/2-implementation.md#step-7-bootstrap-registry-image-trust-controllers-and-crd-ownership
// Docs: docs/decisions/0056-platform-image-inventory.md

interface PodSpec {
  namespace: string;
  name: string;
  containers?: string[];
  initContainers?: string[];
  ephemeralContainers?: string[];
  phase?: string;
}

const label = { "policy.sigstore.dev/include": "true" };

function names(repository: Repository): string[] {
  return [...new Set(repository.catalog.components.map((c) => c.namespace))];
}

function cluster(
  repository: Repository,
  pods: PodSpec[],
  options: { unlabelled?: string[]; failPods?: boolean } = {},
) {
  const calls: string[] = [];
  const runner: Runner = {
    async run(command, args) {
      calls.push(`${command} ${args.join(" ")}`);
      const joined = args.join(" ");
      if (command !== "kubectl") {
        throw new Error(`unexpected ${command}`);
      }
      if (joined.includes("get pods")) {
        if (options.failPods) {
          throw new Error("connection refused");
        }
        const entry = (list: string[] | undefined, prefix: string) =>
          (list ?? []).map((image, i) => ({ name: `${prefix}${i}`, image }));
        return {
          stdout: JSON.stringify({
            items: pods.map((pod) => ({
              metadata: { namespace: pod.namespace, name: pod.name },
              status: { phase: pod.phase ?? "Running" },
              spec: {
                containers: entry(pod.containers, "c"),
                initContainers: entry(pod.initContainers, "i"),
                ephemeralContainers: entry(pod.ephemeralContainers, "e"),
              },
            })),
          }),
          stderr: "",
          code: 0,
        };
      }
      if (joined.includes("get namespaces")) {
        return {
          stdout: JSON.stringify({
            items: [...names(repository), "kube-system"].map((name) => ({
              metadata: {
                name,
                labels: options.unlabelled?.includes(name) ? {} : label,
              },
            })),
          }),
          stderr: "",
          code: 0,
        };
      }
      throw new Error(`unexpected ${joined}`);
    },
  };
  return { runner, calls };
}

const sha = (n: string) => `sha256:${n.repeat(64)}`;

async function local() {
  return await loadRepository("local");
}

test("an approved upstream digest is classified approved-upstream-digest, a seed as seed", async () => {
  const repository = await local();
  const seed = repository.seeds.seeds[0]!;
  const approved = repository.approved.images[0]!;
  const { runner } = cluster(repository, [
    { namespace: "kore-registry", name: "a", containers: [seed.image] },
    { namespace: "observability", name: "b", containers: [approved.image] },
  ]);

  const inventory = await imageInventory(repository, runner);

  assert.deepEqual(
    inventory.images.map((image) => image.classification),
    ["seed", "approved-upstream-digest"],
  );
});

test("tag-only and unlisted digests are classified, and init and ephemeral containers are inventoried", async () => {
  const repository = await local();
  const { runner } = cluster(repository, [
    {
      namespace: "observability",
      name: "p",
      containers: ["busybox:1.37.0"],
      initContainers: [`docker.io/evil/x@${sha("a")}`],
      ephemeralContainers: ["debug:latest"],
    },
  ]);

  const { images } = await imageInventory(repository, runner);

  assert.deepEqual(
    images.map((i) => [i.kind, i.classification]),
    [
      ["container", "tag-only"],
      ["init", "unknown"],
      ["ephemeral", "tag-only"],
    ],
  );
  assert.equal(images[0]?.pod, "p");
  assert.equal(images[0]?.namespace, "observability");
});

test("a digest under the platform mirror is internal-digest only when approved", async () => {
  const repository = await loadRepository("managed-example");
  const approved = repository.approved.images[0]!;
  const digest = approved.image.slice(approved.image.indexOf("@") + 1);
  const mirror = repository.environment.platformMirror!;
  const { runner } = cluster(repository, [
    {
      namespace: "observability",
      name: "ok",
      containers: [`${mirror}/${approved.name}@${digest}`],
    },
    {
      namespace: "observability",
      name: "unlisted",
      containers: [`${mirror}/${approved.name}@${sha("b")}`],
    },
  ]);

  const { images } = await imageInventory(repository, runner);

  assert.deepEqual(
    images.map((i) => i.classification),
    ["internal-digest", "unknown"],
  );
});

test("pods outside platform namespaces and finished pods are ignored", async () => {
  const repository = await local();
  const { runner } = cluster(repository, [
    { namespace: "reference", name: "app", containers: ["busybox:1"] },
    {
      namespace: "observability",
      name: "done",
      containers: ["busybox:1"],
      phase: "Succeeded",
    },
  ]);

  assert.deepEqual((await imageInventory(repository, runner)).images, []);
});

test("namespaces without the Policy Controller inclusion label are reported", async () => {
  const repository = await local();
  const { runner } = cluster(repository, [], { unlabelled: ["observability"] });

  const inventory = await imageInventory(repository, runner);

  assert.deepEqual(inventory.unenrolledNamespaces, ["observability"]);
});

test("audit mode reports findings but the status stays ready", async () => {
  const repository = await local();
  assert.equal(repository.environment.imageInventory, "audit");
  const { runner } = cluster(
    repository,
    [{ namespace: "observability", name: "p", containers: ["busybox:1"] }],
    { unlabelled: ["observability"] },
  );

  const status = await imageInventoryStatus(repository, runner);

  assert.equal(status.status, "ready");
  assert.match(status.detail, /audit/);
  assert.match(status.detail, /1 tag-only/);
  assert.equal(status.inventory?.images.length, 1);
  assert.deepEqual(status.inventory?.unenrolledNamespaces, ["observability"]);
});

test("enforce mode is degraded and names each offending pod, container and image", async () => {
  const repository = await loadRepository("managed-example");
  const { runner } = cluster(
    repository,
    [
      {
        namespace: "observability",
        name: "grafana-0",
        containers: ["busybox:1"],
      },
    ],
    { unlabelled: ["cert-manager"] },
  );

  const status = await imageInventoryStatus(repository, runner);

  assert.equal(status.status, "degraded");
  assert.match(
    status.detail,
    /observability\/grafana-0 container c0 busybox:1 \(tag-only\)/,
  );
  assert.match(status.detail, /cert-manager/);
});

test("enforce mode is ready when every image is internal-digest and every namespace enrolled", async () => {
  const repository = await loadRepository("managed-example");
  const approved = repository.approved.images[0]!;
  const digest = approved.image.slice(approved.image.indexOf("@") + 1);
  const mirror = repository.environment.platformMirror!;
  const { runner } = cluster(repository, [
    {
      namespace: "observability",
      name: "ok",
      containers: [`${mirror}/${approved.name}@${digest}`],
    },
  ]);

  assert.equal(
    (await imageInventoryStatus(repository, runner)).status,
    "ready",
  );
});

test("an unreadable cluster is degraded, never ready, and never mutates", async () => {
  const repository = await local();
  const { runner, calls } = cluster(repository, [], { failPods: true });

  const status = await imageInventoryStatus(repository, runner);

  assert.equal(status.status, "degraded");
  assert.match(status.detail, /connection refused/);
  assert.ok(calls.every((call) => /\bget\b/.test(call)));
  assert.ok(calls.every((call) => call.includes("--context kore-local")));
});

test("exempt namespaces are not reported unenrolled but every other one is checked, and their images are still classified", async () => {
  const repository = await loadRepository("managed-example");
  const all = names(repository);
  const { runner } = cluster(
    repository,
    [{ namespace: "kore-registry", name: "r", containers: ["busybox:1"] }],
    { unlabelled: all },
  );

  const inventory = await imageInventory(repository, runner);

  assert.deepEqual(
    inventory.unenrolledNamespaces,
    all.filter((ns) => ns !== "cosign-system" && ns !== "kore-registry").sort(),
  );
  assert.equal(inventory.images[0]?.classification, "tag-only");
});
