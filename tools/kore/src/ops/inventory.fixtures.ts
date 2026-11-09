import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach } from "vitest";

export const DIGEST = `sha256:${"a".repeat(64)}`;

/** A minimal repository whose pins all pass; tests break one pin at a time. */
export function pinnedFiles(): Record<string, string> {
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

export function useFixtureRepository(): {
  write: (overrides?: Record<string, string>) => Promise<string>;
} {
  const roots: string[] = [];
  afterEach(async () => {
    await Promise.all(
      roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
    );
  });
  return {
    async write(overrides = {}) {
      const root = await mkdtemp(join(tmpdir(), "kore-ops-"));
      roots.push(root);
      for (const [path, content] of Object.entries({
        ...pinnedFiles(),
        ...overrides,
      })) {
        await mkdir(dirname(join(root, path)), { recursive: true });
        await writeFile(join(root, path), content);
      }
      return root;
    },
  };
}
