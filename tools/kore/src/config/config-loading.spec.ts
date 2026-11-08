import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";
import { loadRepository, validateRepository } from "./config.js";

test("malformed environment fails with useful schema errors", async () => {
  const root = await mkdtemp(join(tmpdir(), "kore-test-"));
  await mkdir(join(root, "infra/catalog"), { recursive: true });
  await mkdir(join(root, "infra/environments/bad"), { recursive: true });
  await writeFile(
    join(root, "infra/catalog/versions.yaml"),
    `{"tools":{},"kubernetes":"1.35.1","components":{},"images":{}}`,
  );
  await writeFile(join(root, "infra/catalog/seeds.yaml"), `{"seeds":[]}`);
  await writeFile(
    join(root, "infra/catalog/components.yaml"),
    `{"components":[]}`,
  );
  await writeFile(
    join(root, "infra/environments/bad/environment.yaml"),
    `{"name":"BAD","provider":"invalid","cluster":{"cpus":1,"memoryMB":1}}`,
  );
  await assert.rejects(
    loadRepository("bad", root),
    /environment.name is invalid/,
  );
});

test("missing catalog sections fail as schema errors instead of TypeError", async () => {
  const root = await mkdtemp(join(tmpdir(), "kore-schema-"));
  await mkdir(join(root, "infra/catalog"), { recursive: true });
  await mkdir(join(root, "infra/environments/local"), { recursive: true });
  await writeFile(join(root, "infra/catalog/versions.yaml"), `{}`);
  await writeFile(join(root, "infra/catalog/seeds.yaml"), `{"seeds":[]}`);
  await writeFile(join(root, "infra/catalog/components.yaml"), `{}`);
  await writeFile(
    join(root, "infra/environments/local/environment.yaml"),
    `{}`,
  );
  await assert.rejects(
    loadRepository("local", root),
    /schema|kubernetes|environment/i,
  );
});

test("environment overlays reject unknown component names", async () => {
  const repository = await loadRepository("local");
  await assert.rejects(
    validateRepository({
      ...repository,
      environment: {
        ...repository.environment,
        componentValues: {
          unknown: ["infra/observability/collector/values.yaml"],
        },
      },
    }),
    /unknown environment component values.*unknown/i,
  );
});
