import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { test } from "vitest";
import { approvedImageList, loadRepository } from "../../src/config/index.js";
import type { Repository } from "../../src/config/index.js";
import {
  envOption,
  helmEnv,
  helmTemplateArgs,
  withAbsoluteChart,
} from "../../src/platform/index.js";
import { renderedImages, unapprovedImages } from "../../src/testing/index.js";

// Docs: docs/decisions/0114-give-the-platform-organization-default-dashboards-notify-only-alerts-and-default-retention.md

const run = promisify(execFile);
const sidecarImage =
  "quay.io/kiwigrid/k8s-sidecar:2.5.0@sha256:a6b3f707f883108376514489a94d6629109a327b2978e1d826cd104c4ca436df";

async function renderGrafana(
  repository: Repository,
  portal: boolean,
): Promise<string> {
  const flagged: Repository = {
    ...repository,
    environment: {
      ...repository.environment,
      features: {
        ...repository.environment.features,
        "platform-portal": portal,
      },
    },
  };
  const component = flagged.catalog.components.find(
    (c) => c.name === "grafana",
  )!;
  const { stdout } = await run(
    "helm",
    withAbsoluteChart(flagged, component, helmTemplateArgs(flagged, component)),
    { maxBuffer: 64 * 1024 * 1024, ...envOption(helmEnv(flagged, component)) },
  );
  return stdout;
}

const documents = (rendered: string): string[] =>
  rendered.split(/^---$/m).filter((part) => /^kind:|\nkind:/m.test(part));

const kindsOf = (rendered: string): string[] =>
  documents(rendered)
    .map((d) => /^kind: (\S+)/m.exec(d)?.[1] ?? "")
    .sort();

// Opt-in: it pulls the pinned Grafana chart, and fast tests run offline
// (AGENTS.md). Run with `npm run test:upstream-charts` when bumping Grafana.
const upstream = process.env["KORE_CHECK_UPSTREAM_CHARTS"] === "1";

test.runIf(upstream)(
  "with platform-portal off Grafana renders no dashboard sidecar and reads no ConfigMap by label",
  async () => {
    const repository = await loadRepository("local");
    assert.notEqual(repository.environment.features?.["platform-portal"], true);
    const rendered = await renderGrafana(repository, false);
    assert.equal(rendered.includes("k8s-sidecar"), false);
    assert.equal(rendered.includes("grafana_dashboard"), false);
    assert.equal(rendered.includes("grafana-sc-dashboard"), false);
    assert.match(rendered, /name: kore-grafana-dashboards/);
  },
  120_000,
);

test.runIf(upstream)(
  "with platform-portal on Grafana loads dashboards from the ConfigMaps labelled grafana_dashboard=1 in observability, by the pinned sidecar, and the rest of the release is as before",
  async () => {
    const repository = await loadRepository("local");
    const off = await renderGrafana(repository, false);
    const on = await renderGrafana(repository, true);

    const container =
      /- name: grafana-sc-dashboard\n([\s\S]*?)\n {8}- name: grafana\n/.exec(
        on,
      )?.[0];
    assert.ok(container, "a grafana-sc-dashboard container in the pod");
    assert.match(container, new RegExp(`image: "${sidecarImage}"`));
    for (const [name, value] of [
      ["LABEL", "grafana_dashboard"],
      ["LABEL_VALUE", "1"],
      ["RESOURCE", "configmap"],
      ["NAMESPACE", "observability"],
    ]) {
      assert.match(
        container,
        new RegExp(`- name: ${name}\\n\\s+value: "${value}"`),
        `${name}=${value}`,
      );
    }

    // The sidecar's reads are namespaced: a Role in observability, no ClusterRole.
    const role = documents(on).find((d) => /^kind: Role$/m.test(d));
    assert.ok(role, "a namespaced Role");
    assert.match(role, /resources: \["configmaps", "secrets"\]/);
    assert.equal(/^kind: ClusterRole/m.test(on), false);

    // The release gains the sidecar's provider ConfigMap and loses its empty
    // ClusterRole and binding; every other object stays.
    const expected = [...kindsOf(off), "ConfigMap"]
      .filter((k) => k !== "ClusterRole" && k !== "ClusterRoleBinding")
      .sort();
    assert.deepEqual(kindsOf(on), expected);
    assert.match(on, /name: kore-grafana-dashboards/);
  },
  120_000,
);

test.runIf(upstream)(
  "the dashboard sidecar image is in the approved list, in local by its upstream reference and in managed-example from the mirror",
  async () => {
    const local = await loadRepository("local");
    const approved = approvedImageList(local).map((entry) => entry.image);
    assert.ok(approved.includes(sidecarImage), "approved-images lists it");
    assert.deepEqual(
      unapprovedImages(
        renderedImages(await renderGrafana(local, true)),
        approved,
      ),
      [],
    );

    const managed = await loadRepository("managed-example");
    const mirror = managed.environment.platformMirror;
    assert.ok(mirror, "managed-example declares platformMirror");
    const digest = sidecarImage.split("@")[1];
    const rendered = renderedImages(
      await renderGrafana(
        {
          ...managed,
          environment: {
            ...managed.environment,
            componentValues: {
              ...managed.environment.componentValues,
              grafana: [
                ...(local.environment.componentValues?.["grafana"] ?? []),
                ...(managed.environment.componentValues?.["grafana"] ?? []),
              ],
            },
          },
        },
        true,
      ),
    );
    assert.ok(
      rendered.some((image) => image.startsWith(`${mirror}/grafana-sidecar`)),
      "the sidecar is pulled from the mirror",
    );
    assert.deepEqual(
      unapprovedImages(rendered, [
        `${mirror}/grafana-sidecar@${digest}`,
        ...approvedImageList(managed).map(
          (entry) => `${mirror}/${entry.name}@${entry.image.split("@")[1]}`,
        ),
      ]),
      [],
    );
  },
  120_000,
);
