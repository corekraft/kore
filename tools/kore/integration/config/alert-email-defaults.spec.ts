import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "vitest";
import { findRoot, loadRepository } from "../../src/config/index.js";

// Docs: docs/decisions/0114-give-the-platform-organization-default-dashboards-notify-only-alerts-and-default-retention.md

const emailLike = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z0-9.-]+/;
const configFile = /\.(ya?ml|json)$/;

async function filesUnder(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) =>
      entry.isDirectory()
        ? await filesUnder(join(directory, entry.name))
        : [join(directory, entry.name)],
    ),
  );
  return nested.flat();
}

test("no overlay sets an alert address, because the repository is public and the operator supplies it from outside git", async () => {
  const root = await findRoot();
  const entries = await readdir(join(root, "infra/environments"), {
    withFileTypes: true,
  });
  const names = entries
    .filter((entry) => entry.isDirectory() && entry.name !== "common")
    .map((entry) => entry.name);
  assert.ok(names.length > 0, "at least one overlay");
  for (const name of names) {
    const { environment } = await loadRepository(name);
    assert.equal(
      environment.alertEmail?.addresses,
      undefined,
      `${name} must leave alertEmail.addresses unset`,
    );
  }
});

test("no overlay file, Grafana value or chart default holds an email address", async () => {
  const root = await findRoot();
  const overlays = await filesUnder(join(root, "infra/environments"));
  const files = [
    ...overlays.filter(
      (file) => configFile.test(file) && !file.includes("secrets"),
    ),
    ...(await filesUnder(join(root, "infra/charts/service-observability"))),
    ...(await filesUnder(join(root, "infra/observability/config"))),
  ];
  for (const file of files) {
    const match = emailLike.exec(await readFile(file, "utf8"));
    assert.equal(match, null, `${file} contains an email address`);
  }
});
