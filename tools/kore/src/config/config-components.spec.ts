import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "vitest";
import {
  absolute,
  componentValues,
  componentVersion,
  expandVersions,
  loadRepository,
} from "./config.js";

test("component helpers resolve local and pinned versions and combine value files", async () => {
  const repository = await loadRepository("local");
  const component = repository.catalog.components[0]!;
  assert.equal(
    componentVersion(repository, { ...component, version: "local" }),
    undefined,
  );
  assert.equal(
    componentVersion(repository, {
      ...component,
      version: "istio",
    }),
    repository.versions.components.istio?.replace(/^v/, ""),
  );
  assert.equal(
    componentVersion(repository, { ...component, version: "missing-version" }),
    undefined,
  );
  assert.deepEqual(
    componentValues(
      {
        ...repository,
        environment: {
          ...repository.environment,
          componentValues: { [component.name]: ["environment.yaml"] },
        },
      },
      { ...component, values: ["base.yaml"] },
    ),
    ["base.yaml", "environment.yaml"],
  );
  assert.deepEqual(
    componentValues(repository, { ...component, values: [] }),
    [],
  );
  assert.equal(
    absolute(repository, "/tmp/external.yaml"),
    "/tmp/external.yaml",
  );
  assert.equal(
    absolute(repository, "relative.yaml"),
    join(repository.root, "relative.yaml"),
  );
  assert.equal(
    expandVersions(repository, "${istio} ${not-defined}"),
    `${repository.versions.components.istio?.replace(/^v/, "")} \${not-defined}`,
  );
});
