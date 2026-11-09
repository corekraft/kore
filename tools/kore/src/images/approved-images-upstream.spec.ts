import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import { test } from "vitest";
import { approvedImageList, loadRepository } from "../config/index.js";
import type { Repository } from "../config/index.js";
import {
  envOption,
  helmEnv,
  helmTemplateArgs,
  withAbsoluteChart,
} from "../platform/helm.js";
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
    await assertRendersApproved(repository, approved);
  },
  300_000,
);

// A managed environment must run only the mirror's copies: the same digests,
// under ghcr.io/corekraft/kore/mirror/<name> (ADR 0044). The approved list is
// rewritten to those references, so an image still pulled from upstream, or a
// mirror image at another digest, fails.
test.runIf(process.env["KORE_CHECK_UPSTREAM_CHARTS"] === "1")(
  "managed-example renders only mirror images, each by its approved digest",
  async () => {
    const repository = await loadRepository("managed-example");
    const mirror = repository.environment.platformMirror;
    assert.ok(mirror, "managed-example declares platformMirror");
    const approved = approvedImageList(repository).map(
      (entry) => `${mirror}/${entry.name}@${entry.image.split("@")[1]}`,
    );
    await assertRendersApproved(
      repository,
      approved,
      await borrowedLocalValues(repository),
    );
  },
  300_000,
);

// managed-example carries no storage or sizing for the observability charts
// (their environment values belong to a later step), and some charts refuse to
// render without them. Those components borrow the local environment's overlay,
// appended before nothing that sets an image, only so the chart renders.
async function borrowedLocalValues(
  managed: Repository,
): Promise<Record<string, string[]>> {
  const local = await loadRepository("local");
  const mirrorOnly = (files: string[] = []): boolean =>
    files.every((file) => file.includes("/values/mirror/"));
  return Object.fromEntries(
    Object.entries(local.environment.componentValues ?? {}).filter(
      ([name]) =>
        ["loki", "tempo", "prometheus", "grafana"].includes(name) &&
        mirrorOnly(managed.environment.componentValues?.[name]),
    ),
  );
}

async function assertRendersApproved(
  repository: Repository,
  approved: string[],
  borrowed: Record<string, string[]> = {},
): Promise<void> {
  {
    const charts = repository.catalog.components.filter(
      (component) =>
        component.kind === "helm" || component.kind === "local-chart",
    );
    const problems = (
      await Promise.all(
        charts.map(async (component) => {
          const { stdout } = await run(
            "helm",
            withAbsoluteChart(repository, component, [
              ...helmTemplateArgs(repository, component),
              ...(borrowed[component.name] ?? []).flatMap((file) => [
                "--values",
                join(repository.root, file),
              ]),
            ]),
            {
              maxBuffer: 256 * 1024 * 1024,
              ...envOption(helmEnv(repository, component)),
            },
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
  }
}
