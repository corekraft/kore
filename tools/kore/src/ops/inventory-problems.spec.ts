import { expect, test } from "vitest";
import type { Inventory, InventoryItem } from "./inventory.js";
import { integrityProblems } from "./inventory-problems.js";

// The check is pure over an inventory it is handed: nothing is mocked, because
// the only import is the Inventory type.

const DIGEST = `sha256:${"a".repeat(64)}`;
const SHA512 = `sha512-${"b".repeat(86)}==`;
const COMMIT = "c".repeat(40);

function inventory(
  items: InventoryItem[],
  overrides: Partial<Omit<Inventory, "items">> = {},
): Inventory {
  return {
    items,
    misePins: {},
    npmRanges: {},
    authorizedSigners: ["local-kore-key"],
    ...overrides,
  };
}

const tool = (name: string, version: string): InventoryItem => ({
  kind: "tool",
  name,
  version,
  source: "infra/catalog/versions.yaml",
});

test("a fully pinned inventory has no integrity problems", () => {
  expect(
    integrityProblems(
      inventory(
        [
          tool("helm", "4.3.1"),
          {
            kind: "image",
            name: "demo",
            version: "ghcr.io/example/demo:1.2.3",
            source: "infra/catalog/versions.yaml",
            digest: DIGEST,
          },
          {
            kind: "image",
            name: "reference",
            version: "kore/reference:0.1.0",
            source: "infra/catalog/versions.yaml",
          },
          {
            kind: "npm",
            name: "vitest",
            version: "5.1.0",
            source: "tools/kore/package-lock.json",
            integrity: SHA512,
            resolved: "https://registry.npmjs.org/vitest/-/vitest-5.1.0.tgz",
          },
          {
            kind: "action",
            name: "actions/checkout",
            version: COMMIT,
            source: ".github/workflows/check.yml",
          },
        ],
        { misePins: { helm: "4.3.1" }, npmRanges: { vitest: "5.1.0" } },
      ),
    ),
  ).toEqual([]);
});

test("a tool version that is a range is reported as not exact", () => {
  expect(integrityProblems(inventory([tool("helm", "^4.3.1")]))).toEqual([
    'tool helm (infra/catalog/versions.yaml): version "^4.3.1" is not an exact version; pin it',
  ]);
});

test("an image from a registry without a digest is reported, and a local build is not", () => {
  const remote: InventoryItem = {
    kind: "image",
    name: "demo",
    version: "ghcr.io/example/demo:1.2.3",
    source: "infra/catalog/versions.yaml",
  };
  const local: InventoryItem = {
    kind: "image",
    name: "reference",
    version: "kore/reference:0.1.0",
    source: "infra/catalog/versions.yaml",
  };
  expect(integrityProblems(inventory([remote, local]))).toEqual([
    "image demo (infra/catalog/versions.yaml): ghcr.io/example/demo:1.2.3 has no sha256 digest; pin it by digest",
  ]);
});

test("an npm package without an integrity hash or with an http source is reported", () => {
  const noIntegrity: InventoryItem = {
    kind: "npm",
    name: "a",
    version: "1.0.0",
    source: "tools/kore/package-lock.json",
    resolved: "https://r/a.tgz",
  };
  const plainHttp: InventoryItem = {
    kind: "npm",
    name: "b",
    version: "1.0.0",
    source: "tools/kore/package-lock.json",
    resolved: "http://r/b.tgz",
    integrity: SHA512,
  };
  expect(integrityProblems(inventory([noIntegrity, plainHttp]))).toEqual([
    "npm a (tools/kore/package-lock.json): no sha512 integrity hash in the lockfile",
    "npm b (tools/kore/package-lock.json): resolved from http://r/b.tgz, which is not https",
  ]);
});

test("an npm package with no resolved URL is not reported as non-https", () => {
  const unresolved: InventoryItem = {
    kind: "npm",
    name: "a",
    version: "1.0.0",
    source: "tools/kore/package-lock.json",
    integrity: SHA512,
  };
  expect(integrityProblems(inventory([unresolved]))).toEqual([]);
});

test("an action pinned to a tag instead of a full commit SHA is reported", () => {
  expect(
    integrityProblems(
      inventory([
        {
          kind: "action",
          name: "actions/checkout",
          version: "v4",
          source: ".github/workflows/check.yml",
        },
      ]),
    ),
  ).toEqual([
    'action actions/checkout (.github/workflows/check.yml): pinned to "v4", not a full commit SHA',
  ]);
});

test("a lock entry with a malformed digest or an unauthorized signer is reported", () => {
  const malformed: InventoryItem = {
    kind: "lock",
    name: "a",
    version: "r/a",
    source: "infra/catalog/images.lock.json",
    digest: "sha256:short",
    resolved: "local-kore-key",
  };
  const stranger: InventoryItem = {
    kind: "lock",
    name: "b",
    version: "r/b",
    source: "infra/catalog/images.lock.json",
    digest: DIGEST,
    resolved: "someone-else",
  };
  expect(integrityProblems(inventory([malformed, stranger]))).toEqual([
    'lock entry a (infra/catalog/images.lock.json): digest "sha256:short" is not a sha256 digest',
    'lock entry b (infra/catalog/images.lock.json): signer "someone-else" is not an authorized signer',
  ]);
});

test("a mise pin that disagrees with the version catalog is reported, and a pin with no catalog entry is not", () => {
  expect(
    integrityProblems(
      inventory([tool("helm", "4.3.1")], {
        misePins: { helm: "4.3.0", tofu: "1.13.9" },
      }),
    ),
  ).toEqual([
    "tool helm: .mise.toml pins 4.3.0 but infra/catalog/versions.yaml pins 4.3.1",
  ]);
});

test("an npm range in package.json that is not exact is reported", () => {
  expect(
    integrityProblems(inventory([], { npmRanges: { vitest: "^5.1.0" } })),
  ).toEqual([
    'npm vitest (tools/kore/package.json): "^5.1.0" is not an exact version; pin it',
  ]);
});

test("item problems are listed before mise and npm range problems", () => {
  expect(
    integrityProblems(
      inventory([tool("helm", "^4.3.1")], {
        misePins: { helm: "4.3.0" },
        npmRanges: { vitest: "^5.1.0" },
      }),
    ),
  ).toEqual([
    'tool helm (infra/catalog/versions.yaml): version "^4.3.1" is not an exact version; pin it',
    "tool helm: .mise.toml pins 4.3.0 but infra/catalog/versions.yaml pins ^4.3.1",
    'npm vitest (tools/kore/package.json): "^5.1.0" is not an exact version; pin it',
  ]);
});
