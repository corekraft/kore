import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { beforeEach, expect, test, vi } from "vitest";
import { buildInventory, type InventoryItem } from "./inventory.js";
import { serveDirectories, serveFiles } from "./ops-support.js";

vi.mock("node:fs/promises");
vi.mock("node:path");

const ROOT = "/repo";
const DIGEST = `sha256:${"a".repeat(64)}`;
const COMMIT = "c".repeat(40);
const SHA512 = `sha512-${"b".repeat(86)}==`;

/** A repository whose pins all pass, keyed by absolute path as the real reads are. */
function pinnedRepository(): Record<string, string> {
  return {
    [`${ROOT}/infra/catalog/versions.yaml`]: JSON.stringify({
      tools: { helm: "4.3.1", tofu: "1.13.9" },
      kubernetes: "1.37.2",
      components: { demo: "1.2.3" },
      images: { demo: `ghcr.io/example/demo:1.2.3@${DIGEST}` },
    }),
    [`${ROOT}/infra/catalog/components.yaml`]: JSON.stringify({
      components: [
        { name: "demo", version: "demo", kind: "helm", chart: "demo" },
        { name: "own", version: "local", kind: "local-chart" },
      ],
    }),
    [`${ROOT}/infra/catalog/approved-images.yaml`]: JSON.stringify({
      images: [{ image: `quay.io/x/y:1@${DIGEST}`, name: "y" }],
    }),
    [`${ROOT}/infra/catalog/seeds.yaml`]: JSON.stringify({
      seeds: [{ image: `docker.io/library/registry:3@${DIGEST}` }],
    }),
    [`${ROOT}/infra/catalog/images.lock.json`]: JSON.stringify({
      version: 1,
      authorizedSigners: ["local-kore-key"],
      entries: {
        reference: {
          image: "registry.kore.local:30500/reference",
          digest: DIGEST,
          signer: "local-kore-key",
        },
      },
    }),
    [`${ROOT}/.mise.toml`]: '[tools]\nhelm = "4.3.1"\nopentofu = "1.13.9"\n',
    [`${ROOT}/tools/kore/package.json`]: JSON.stringify({
      devDependencies: { vitest: "5.1.0" },
    }),
    [`${ROOT}/tools/kore/package-lock.json`]: JSON.stringify({
      lockfileVersion: 3,
      packages: {
        "": { name: "kore" },
        "node_modules/vitest": {
          version: "5.1.0",
          resolved: "https://registry.npmjs.org/vitest/-/vitest-5.1.0.tgz",
          integrity: SHA512,
        },
      },
    }),
    [`${ROOT}/.github/workflows/check.yml`]: `jobs:\n  a:\n    steps:\n      - uses: actions/checkout@${COMMIT} # v7\n      - uses: ./.github/actions/local\n`,
    [`${ROOT}/.github/workflows/notes.txt`]: "uses: not/a-workflow@v1\n",
  };
}

const workflows = { [`${ROOT}/.github/workflows`]: ["check.yml", "notes.txt"] };

beforeEach(() => {
  vi.mocked(join).mockImplementation((...parts: string[]) => parts.join("/"));
});

/** Every pinned item of pinnedRepository(), in the order buildInventory sorts them. */
const PINNED_ITEMS: InventoryItem[] = [
  {
    kind: "action",
    name: "actions/checkout",
    version: COMMIT,
    source: ".github/workflows/check.yml",
  },
  {
    kind: "component",
    name: "demo",
    version: "1.2.3",
    source: "infra/catalog/components.yaml",
  },
  {
    kind: "image",
    name: "demo",
    version: "ghcr.io/example/demo:1.2.3",
    source: "infra/catalog/versions.yaml",
    digest: DIGEST,
  },
  {
    kind: "image",
    name: `docker.io/library/registry:3@${DIGEST}`,
    version: "docker.io/library/registry:3",
    source: "infra/catalog/seeds.yaml",
    digest: DIGEST,
  },
  {
    kind: "image",
    name: "y",
    version: "quay.io/x/y:1",
    source: "infra/catalog/approved-images.yaml",
    digest: DIGEST,
  },
  {
    kind: "lock",
    name: "reference",
    version: "registry.kore.local:30500/reference",
    source: "infra/catalog/images.lock.json",
    digest: DIGEST,
    resolved: "local-kore-key",
  },
  {
    kind: "npm",
    name: "vitest",
    version: "5.1.0",
    source: "tools/kore/package-lock.json",
    resolved: "https://registry.npmjs.org/vitest/-/vitest-5.1.0.tgz",
    integrity: SHA512,
  },
  {
    kind: "tool",
    name: "helm",
    version: "4.3.1",
    source: "infra/catalog/versions.yaml",
  },
  {
    kind: "tool",
    name: "kubernetes",
    version: "1.37.2",
    source: "infra/catalog/versions.yaml",
  },
  {
    kind: "tool",
    name: "tofu",
    version: "1.13.9",
    source: "infra/catalog/versions.yaml",
  },
];

test("a pinned repository lists every dependency in a stable order, with its source, digest and signer", async () => {
  serveFiles(pinnedRepository());
  serveDirectories(workflows);
  const inventory = await buildInventory(ROOT);
  expect(inventory.items).toStrictEqual(PINNED_ITEMS);
  expect(inventory.misePins).toEqual({ helm: "4.3.1", tofu: "1.13.9" });
  expect(inventory.npmRanges).toEqual({ vitest: "5.1.0" });
  expect(inventory.authorizedSigners).toEqual(["local-kore-key"]);
});

test("only YAML workflow files are read for their action references", async () => {
  serveFiles(pinnedRepository());
  serveDirectories(workflows);
  await buildInventory(ROOT);
  const read = vi.mocked(readFile).mock.calls.map(([path]) => path);
  expect(read).toContain(`${ROOT}/.github/workflows/check.yml`);
  expect(read).not.toContain(`${ROOT}/.github/workflows/notes.txt`);
});

test("a repository with no workflows directory has no action entries", async () => {
  serveFiles(pinnedRepository());
  serveDirectories({});
  const inventory = await buildInventory(ROOT);
  expect(inventory.items.some((item) => item.kind === "action")).toBe(false);
});

test("a missing pinned file fails the inventory instead of reporting it clean", async () => {
  const files = pinnedRepository();
  delete files[`${ROOT}/.mise.toml`];
  serveFiles(files);
  serveDirectories(workflows);
  await expect(buildInventory(ROOT)).rejects.toMatchObject({ code: "ENOENT" });
});

test("a value of the wrong type reads as empty, so the check flags it", async () => {
  const files = pinnedRepository();
  files[`${ROOT}/infra/catalog/versions.yaml`] = JSON.stringify({
    tools: { helm: 4 },
    kubernetes: "1.37.2",
    components: {},
    images: {},
  });
  serveFiles(files);
  serveDirectories({});
  const inventory = await buildInventory(ROOT);
  expect(inventory.items).toContainEqual({
    kind: "tool",
    name: "helm",
    version: "",
    source: "infra/catalog/versions.yaml",
  });
});

test("an image without a digest keeps its whole reference and has no digest field", async () => {
  const files = pinnedRepository();
  files[`${ROOT}/infra/catalog/versions.yaml`] = JSON.stringify({
    tools: {},
    kubernetes: "1.37.2",
    components: {},
    images: { demo: "ghcr.io/example/demo:1.2.3" },
  });
  serveFiles(files);
  serveDirectories({});
  const inventory = await buildInventory(ROOT);
  expect(inventory.items).toContainEqual({
    kind: "image",
    name: "demo",
    version: "ghcr.io/example/demo:1.2.3",
    source: "infra/catalog/versions.yaml",
  });
});

test("a workflow reference with no @version is an action with an empty version", async () => {
  serveFiles({
    ...pinnedRepository(),
    [`${ROOT}/.github/workflows/check.yml`]:
      "jobs:\n  a:\n    steps:\n      - uses: actions/checkout\n",
  });
  serveDirectories(workflows);
  const inventory = await buildInventory(ROOT);
  expect(inventory.items).toContainEqual({
    kind: "action",
    name: "actions/checkout",
    version: "",
    source: ".github/workflows/check.yml",
  });
});

test("an npm package without an integrity hash has no integrity field, and a nested package takes its last name", async () => {
  serveFiles({
    ...pinnedRepository(),
    [`${ROOT}/tools/kore/package-lock.json`]: JSON.stringify({
      lockfileVersion: 3,
      packages: {
        "node_modules/a/node_modules/b": {
          version: "1.0.0",
          resolved: "https://r/b.tgz",
        },
      },
    }),
  });
  serveDirectories(workflows);
  const inventory = await buildInventory(ROOT);
  expect(inventory.items).toContainEqual({
    kind: "npm",
    name: "b",
    version: "1.0.0",
    source: "tools/kore/package-lock.json",
    resolved: "https://r/b.tgz",
  });
  const npm = inventory.items.find((item) => item.kind === "npm");
  expect(npm).not.toHaveProperty("integrity");
});
