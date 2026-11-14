import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, type Mock } from "vitest";
import { loadRepository, type Repository } from "../../src/config/index.js";
import { buildAndSignLocalImage } from "../../src/images/index.js";
import {
  imageDigest as digest,
  imageEntry as entry,
  imageFakeRunner as fakeRunner,
} from "../../src/testing/index.js";

// Shared setup of the reuse integration specs: a support file, not a spec.

const roots: string[] = [];

/** Removes the temp checkouts `checkout` made. */
export async function removeCheckouts(): Promise<void> {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
}

/** A checkout whose app directory is `apps/reference`; `kore-reuse-` names its temp roots. */
export async function checkout(
  source = "v1",
  reuse = true,
): Promise<Repository> {
  const root = await mkdtemp(join(tmpdir(), "kore-reuse-"));
  roots.push(root);
  const app = join(root, "apps/reference");
  await mkdir(join(app, "src"), { recursive: true });
  await writeFile(
    join(app, "Dockerfile"),
    "FROM node:26.13.0-alpine3.24\nCOPY src ./src\n",
  );
  await writeFile(join(app, ".dockerignore"), "node_modules\n.git\n");
  await writeFile(join(app, "src/server.ts"), source);
  const local = await loadRepository("local");
  return {
    ...local,
    root,
    environment: {
      ...local.environment,
      features: { ...local.environment.features, "local-image-reuse": reuse },
    },
  };
}

export const appOf = (repository: Repository) =>
  join(repository.root, "apps/reference");

export const builds = (calls: { command: string; args: readonly string[] }[]) =>
  calls.filter((c) => c.command === "docker" && c.args[0] === "build");

export function pushedSourceTags(
  calls: { args: readonly string[] }[],
): string[] {
  return calls
    .flatMap(({ args }) => args.join("\n").match(/images push[^\n]*/g) ?? [])
    .flatMap((line) => line.match(/kore-src-[0-9a-f]{16}/g) ?? []);
}

/** The registry mocks a spec hoists for `registry.js` and `registry-https.js`. */
export interface RegistryMocks {
  reference: Mock;
  head: Mock;
}

/** Registry behaviours over the spec's mocks. */
export function reuseRegistry({ reference, head }: RegistryMocks) {
  /** A registry where run tags resolve and a source tag resolves only when held. */
  function registryWith(tags: Map<string, string>): void {
    reference.mockImplementation(async (_repo, _runner, ref) => ref);
    head.mockImplementation(async (url: string) => {
      const tag = String(url).split("/manifests/")[1]!;
      if (!tag.startsWith("kore-src-")) {
        return { status: 200, digest };
      }
      const found = tags.get(tag);
      return found
        ? { status: 200, digest: found }
        : { status: 404, digest: "" };
    });
  }

  /** Runs once to publish the source tag, then returns a registry that holds it. */
  async function published(repository: Repository, runner = fakeRunner()) {
    registryWith(new Map());
    await buildAndSignLocalImage(repository, runner.runner, "reference", entry);
    const [tag] = pushedSourceTags(runner.calls);
    expect(tag).toMatch(/^kore-src-[0-9a-f]{16}$/);
    registryWith(new Map([[tag!, digest]]));
    return tag!;
  }

  return { registryWith, published };
}
