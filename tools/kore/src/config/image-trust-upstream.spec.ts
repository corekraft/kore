import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { test } from "vitest";
import { findRoot, loadRepository } from "./config.js";

const run = promisify(execFile);

async function renderUpstream(): Promise<string> {
  const root = await findRoot();
  const repository = await loadRepository("local");
  const { stdout } = await run("helm", [
    "template",
    "kore-image-policy",
    join(root, "infra/charts/image-policy"),
    "--set-string",
    "platform.registry.address=registry.example:5000",
    "--set-json",
    `trust=${JSON.stringify(repository.imageTrustValues?.["trust"])}`,
  ]);
  return (
    stdout
      .split(/^---$/m)
      .find((d) => d.includes("name: kore-upstream-images")) ?? ""
  );
}

// Opt-in: it pulls the pinned chart from its repository, and fast tests run
// offline (AGENTS.md). Run with `npm run test:upstream-charts` when bumping a
// controller chart.
test.runIf(process.env["KORE_CHECK_UPSTREAM_CHARTS"] === "1")(
  "the upstream static pass names the repository of the pinned CloudNativePG operator image",
  async () => {
    // Every instance and initdb pod runs the operator image as its
    // bootstrap-controller init container, so a chart bump that moves the
    // repository would deny the database under enforce (ADR 0032).
    const repository = await loadRepository("local");
    const component = repository.catalog.components!.find(
      (c) => c.name === "cloudnative-pg",
    )!;
    const version = repository.versions.components["cloudnative-pg"];
    const { stdout } = await run(
      "helm",
      [
        "template",
        "cnpg",
        component.chart!,
        "--repo",
        component.repository!,
        "--version",
        version!,
      ],
      { maxBuffer: 64 * 1024 * 1024 },
    );
    const operator = /name: OPERATOR_IMAGE_NAME\s+value: "?([^"\s]+)"?/.exec(
      stdout,
    )?.[1];
    assert.ok(operator, "chart renders OPERATOR_IMAGE_NAME");
    const repo = operator.replace(/[:@].*$/, "");
    const upstream = await renderUpstream();
    assert.ok(
      upstream.includes(`glob: "${repo}**"`),
      `kore-upstream-images must contain "${repo}**"`,
    );
  },
  60_000,
);
