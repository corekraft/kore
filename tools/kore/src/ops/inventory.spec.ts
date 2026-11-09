import assert from "node:assert/strict";
import { test } from "vitest";
import { findRoot } from "../config/config.js";
import { buildInventory } from "./inventory.js";
import { integrityProblems } from "./inventory-problems.js";
import {
  DIGEST,
  pinnedFiles,
  useFixtureRepository,
} from "./inventory.fixtures.js";

const fixtures = useFixtureRepository();

async function problems(
  overrides: Record<string, string> = {},
): Promise<string[]> {
  return integrityProblems(
    await buildInventory(await fixtures.write(overrides)),
  );
}

test("a fully pinned repository has no integrity problems and lists every dependency kind", async () => {
  const inventory = await buildInventory(await fixtures.write());
  assert.deepEqual(integrityProblems(inventory), []);
  const kinds = new Set(inventory.items.map((item) => item.kind));
  for (const kind of ["tool", "component", "image", "npm", "action"]) {
    assert.ok(kinds.has(kind as never), `inventory lists ${kind} entries`);
  }
  assert.ok(
    inventory.items.some(
      (item) => item.kind === "component" && item.version === "1.2.3",
    ),
    "component versions resolve through the version catalog",
  );
});

test("the inventory is deterministic so it can be reviewed and diffed", async () => {
  const root = await fixtures.write();
  assert.deepEqual(await buildInventory(root), await buildInventory(root));
});

test("a tool version range is reported", async () => {
  const files = pinnedFiles();
  const versions = JSON.parse(files["infra/catalog/versions.yaml"]!);
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
  const files = pinnedFiles();
  const versions = JSON.parse(files["infra/catalog/versions.yaml"]!);
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

test("a package.json range and a lock that disagrees with it are reported", async () => {
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

test("this repository's own pins pass the integrity check", async () => {
  const inventory = await buildInventory(await findRoot());
  assert.deepEqual(integrityProblems(inventory), []);
});
