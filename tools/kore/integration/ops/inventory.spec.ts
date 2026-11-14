import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, test } from "vitest";
import {
  findRoot,
  loadRepository,
  type Repository,
} from "../../src/config/index.js";
import type { Runner } from "../../src/runtime/index.js";
import { opsReport } from "../../src/ops/index.js";

// Real files and real units together: the inventory and its integrity checks
// read a temporary repository through the ops barrel. Unit tests of each file
// live beside it in src/ops.

const DIGEST = `sha256:${"a".repeat(64)}`;

/** A minimal repository whose pins all pass; tests break one pin at a time. */
function pinnedFiles(): Record<string, string> {
  return {
    "infra/catalog/versions.yaml": JSON.stringify({
      tools: { helm: "4.3.1", tofu: "1.13.9" },
      kubernetes: "1.37.2",
      components: { demo: "1.2.3" },
      images: {
        demo: `ghcr.io/example/demo:1.2.3@${DIGEST}`,
        reference: "kore/reference:0.1.0",
      },
    }),
    "infra/catalog/components.yaml": JSON.stringify({
      components: [
        { name: "demo", version: "demo", kind: "helm", chart: "demo" },
        { name: "own", version: "local", kind: "local-chart" },
      ],
    }),
    "infra/catalog/approved-images.yaml": JSON.stringify({
      images: [{ image: `quay.io/x/y:1@${DIGEST}`, name: "y" }],
    }),
    "infra/catalog/seeds.yaml": JSON.stringify({
      seeds: [{ image: `docker.io/library/registry:3@${DIGEST}` }],
    }),
    "infra/catalog/images.lock.json": JSON.stringify({
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
    ".mise.toml": '[tools]\nhelm = "4.3.1"\nopentofu = "1.13.9"\n',
    "tools/kore/package.json": JSON.stringify({
      devDependencies: { vitest: "5.1.0" },
    }),
    "tools/kore/package-lock.json": JSON.stringify({
      lockfileVersion: 3,
      packages: {
        "": { name: "kore" },
        "node_modules/vitest": {
          version: "5.1.0",
          resolved: "https://registry.npmjs.org/vitest/-/vitest-5.1.0.tgz",
          integrity: `sha512-${"b".repeat(86)}==`,
        },
      },
    }),
    ".github/workflows/check.yml": `jobs:\n  a:\n    steps:\n      - uses: actions/checkout@${"c".repeat(40)} # v7\n      - uses: ./.github/actions/local\n`,
  };
}

/** A process runner that fails the test: the inventory reads files and starts nothing. */
const noProcesses: Runner = {
  run: () => Promise.reject(new Error("the inventory starts no process")),
};

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function repository(
  overrides: Record<string, string> = {},
): Promise<Repository> {
  const root = await mkdtemp(join(tmpdir(), "kore-ops-"));
  roots.push(root);
  for (const [path, content] of Object.entries({
    ...pinnedFiles(),
    ...overrides,
  })) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), content);
  }
  return { root } as unknown as Repository;
}

async function inventory(overrides: Record<string, string> = {}) {
  return opsReport("inventory", {
    repository: await repository(overrides),
    runner: noProcesses,
    json: true,
  });
}

async function problems(
  overrides: Record<string, string> = {},
): Promise<string[]> {
  return (await inventory(overrides)).report["problems"] as string[];
}

test("a fully pinned repository is valid and lists every dependency kind", async () => {
  const { report, ok } = await inventory();
  assert.equal(ok, true);
  assert.equal(report["status"], "valid");
  assert.deepEqual(report["problems"], []);
  const items = report["items"] as { kind: string; version: string }[];
  const kinds = new Set(items.map((item) => item.kind));
  for (const kind of ["tool", "component", "image", "npm", "action"]) {
    assert.ok(kinds.has(kind), `inventory lists ${kind} entries`);
  }
  assert.ok(
    items.some((item) => item.kind === "component" && item.version === "1.2.3"),
    "component versions resolve through the version catalog",
  );
});

test("the inventory is deterministic so it can be reviewed and diffed", async () => {
  const root = await repository();
  const first = await opsReport("inventory", {
    repository: root,
    runner: noProcesses,
    json: true,
  });
  const second = await opsReport("inventory", {
    repository: root,
    runner: noProcesses,
    json: true,
  });
  assert.deepEqual(first, second);
});

test("a tool version range is reported", async () => {
  const versions = JSON.parse(pinnedFiles()["infra/catalog/versions.yaml"]!);
  versions.tools.helm = "^4.3.1";
  const found = await problems({
    "infra/catalog/versions.yaml": JSON.stringify(versions),
  });
  assert.ok(
    found.some((p) => /tool helm.*\^4\.3\.1.*exact/.test(p)),
    found.join("\n"),
  );
});

test("a mise pin that differs from the version catalog is reported", async () => {
  const found = await problems({
    ".mise.toml": '[tools]\nhelm = "4.3.0"\nopentofu = "1.13.9"\n',
  });
  assert.ok(
    found.some((p) => /helm.*4\.3\.0.*4\.3\.1/.test(p)),
    found.join("\n"),
  );
});

test("an image without a digest is reported, but a local build is not", async () => {
  const versions = JSON.parse(pinnedFiles()["infra/catalog/versions.yaml"]!);
  versions.images.demo = "ghcr.io/example/demo:1.2.3";
  const found = await problems({
    "infra/catalog/versions.yaml": JSON.stringify(versions),
  });
  assert.equal(found.length, 1, found.join("\n"));
  assert.match(found[0]!, /image demo.*digest/);
});

test("an approved image or seed without a digest is reported", async () => {
  const found = await problems({
    "infra/catalog/approved-images.yaml": JSON.stringify({
      images: [{ image: "quay.io/x/y:1", name: "y" }],
    }),
    "infra/catalog/seeds.yaml": JSON.stringify({
      seeds: [{ image: "docker.io/library/registry:3" }],
    }),
  });
  assert.equal(found.length, 2, found.join("\n"));
});

test("a lock entry with a malformed digest or an unauthorized signer is reported", async () => {
  const found = await problems({
    "infra/catalog/images.lock.json": JSON.stringify({
      version: 1,
      authorizedSigners: ["local-kore-key"],
      entries: {
        a: { image: "r/a", digest: "sha256:short", signer: "local-kore-key" },
        b: { image: "r/b", digest: DIGEST, signer: "someone-else" },
      },
    }),
  });
  assert.ok(
    found.some((p) => /lock entry a.*digest/.test(p)),
    found.join("\n"),
  );
  assert.ok(
    found.some((p) => /lock entry b.*signer/.test(p)),
    found.join("\n"),
  );
});

test("an npm package without an integrity hash or an https source is reported", async () => {
  const found = await problems({
    "tools/kore/package-lock.json": JSON.stringify({
      lockfileVersion: 3,
      packages: {
        "": {},
        "node_modules/a": { version: "1.0.0", resolved: "https://r/a.tgz" },
        "node_modules/b": {
          version: "1.0.0",
          resolved: "http://r/b.tgz",
          integrity: "sha512-x",
        },
      },
    }),
  });
  assert.ok(
    found.some((p) => /npm a.*integrity/.test(p)),
    found.join("\n"),
  );
  assert.ok(
    found.some((p) => /npm b.*https/.test(p)),
    found.join("\n"),
  );
});

test("a package.json range is reported", async () => {
  const found = await problems({
    "tools/kore/package.json": JSON.stringify({
      devDependencies: { vitest: "^5.1.0" },
    }),
  });
  assert.ok(
    found.some((p) => /vitest.*\^5\.1\.0.*exact/.test(p)),
    found.join("\n"),
  );
});

test("a GitHub Action pinned to a tag instead of a commit is reported", async () => {
  const found = await problems({
    ".github/workflows/check.yml":
      "jobs:\n  a:\n    steps:\n      - uses: actions/checkout@v4\n",
  });
  assert.ok(
    found.some((p) => /action actions\/checkout.*commit/.test(p)),
    found.join("\n"),
  );
});

test("this repository's own pins pass the inventory check", async () => {
  const root = await findRoot();
  const { ok } = await opsReport("inventory", {
    repository: await loadRepository("local", root),
    runner: noProcesses,
    json: false,
  });
  assert.equal(ok, true);
});
