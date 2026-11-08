import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { test } from "vitest";
import { approvedImageList, loadRepository } from "../config/index.js";
import { helmTemplateArgs, withAbsoluteChart } from "../platform/helm.js";
import { renderedImages, unapprovedImages } from "./rendered-images.js";

const run = promisify(execFile);

// Images a chart hard-codes and cannot take a digest for. Each is inert in this
// platform; the test fails if one disappears so the entry is removed with it.
const knownGaps: Record<string, string> = {
  "istiod: busybox:1.28":
    "Istio's grpc-agent injection template (proxyless gRPC) hard-codes this init container; no pod here opts into that template, and the chart exposes no value for it.",
};

// Opt-in: it pulls every pinned chart, and fast tests run offline
// (AGENTS.md). Run with `npm run test:upstream-charts` when bumping a chart.
test.runIf(process.env["KORE_CHECK_UPSTREAM_CHARTS"] === "1")(
  "every image a rendered chart can run is pinned by digest and in the approved list",
  async () => {
    // A chart bump that adds an image, or moves one to a new digest, fails
    // here until infra/catalog/approved-images.yaml records it (ADR 0033).
    const repository = await loadRepository("local");
    const approved = approvedImageList(repository).map((entry) => entry.image);
    const charts = repository.catalog.components.filter(
      (component) =>
        component.kind === "helm" || component.kind === "local-chart",
    );
    const problems = (
      await Promise.all(
        charts.map(async (component) => {
          const { stdout } = await run(
            "helm",
            withAbsoluteChart(
              repository,
              component,
              helmTemplateArgs(repository, component),
            ),
            { maxBuffer: 256 * 1024 * 1024 },
          );
          return unapprovedImages(renderedImages(stdout), approved).map(
            (problem) => `${component.name}: ${problem}`,
          );
        }),
      )
    ).flat();
    const gaps = Object.keys(knownGaps);
    const gapped = (problem: string): boolean =>
      gaps.some((gap) => problem.startsWith(gap));
    assert.deepEqual(
      problems.filter((problem) => !gapped(problem)),
      [],
    );
    assert.deepEqual(
      gaps.filter((gap) => !problems.some((p) => p.startsWith(gap))),
      [],
      "a known gap no longer renders; remove it from knownGaps",
    );
  },
  300_000,
);
