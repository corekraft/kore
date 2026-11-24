import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "vitest";
import { helmTemplateArgs } from "../../src/platform/index.js";
import { withAbsoluteChart } from "../../src/testing/index.js";
import { loadRepository } from "../../src/config/index.js";

import {
  composition,
  documents,
  mapping,
  ofKind,
  render,
  renderStep,
  root,
  stepTemplate,
  suborg,
  suborgOn,
} from "./suborg-render-support.js";

test("with suborg-tenancy off the platform-apis render equals the checked-in golden (main plus the additive Service XRD sizing fields)", async () => {
  const repository = await loadRepository("local");
  const component = repository.catalog.components.find(
    (c) => c.name === "kore-platform-apis",
  )!;
  const rendered = execFileSync(
    "helm",
    withAbsoluteChart(
      repository,
      component,
      helmTemplateArgs(repository, component),
    ),
    { cwd: repository.root, encoding: "utf8" },
  );
  assert.equal(
    rendered,
    await readFile(
      join(root, "tools/kore/src/platform/fixtures/platform-apis.local.yaml"),
      "utf8",
    ),
  );
  assert.doesNotMatch(
    rendered,
    /compose-suborg-namespace/,
    "with suborg-tenancy off no suborg namespace step is rendered",
  );
  assert.equal(
    render("--set", "features.suborg-tenancy=false"),
    render(),
    "an explicit false renders exactly as an absent flag",
  );
});

test("with suborg-tenancy absent the Organization composition has no suborg namespace step", () => {
  const organization = composition(render(), "organization-local");
  assert.doesNotMatch(organization, /compose-suborg-namespace/);
});

test("with suborg-tenancy on the Organization composition has one step that composes the suborg's namespace", () => {
  const organization = composition(
    render(...suborgOn(false)),
    "organization-local",
  );
  assert.match(organization, /- step: compose-suborg-namespace/);
  assert.match(organization, /- step: mark-ready/);
});

test("with suborg-tenancy on a suborg renders exactly its namespace, ResourceQuota and LimitRange, and nothing else", async () => {
  const step = stepTemplate(
    composition(render(...suborgOn(false)), "organization-local"),
    "compose-suborg-namespace",
  );
  const rendered = await renderStep(step, suborg);
  assert.deepEqual(
    documents(rendered).map((document) => /^kind: (\w+)$/m.exec(document)?.[1]),
    ["Namespace", "ResourceQuota", "LimitRange"],
  );
});

test("the suborg namespace is named exactly like the suborg and carries the labels ADR 0165 lists", async () => {
  const step = stepTemplate(
    composition(render(...suborgOn(false)), "organization-local"),
    "compose-suborg-namespace",
  );
  const rendered = await renderStep(step, suborg);
  const namespace = ofKind(rendered, "Namespace")!;
  assert.match(namespace, /^metadata:\n  name: api$/m);
  assert.deepEqual(mapping(namespace, "labels"), {
    "platform.kore.dev/tenant": "platform",
    "platform.kore.dev/organization": "api",
    "pod-security.kubernetes.io/enforce": "restricted",
    "istio.io/dataplane-mode": "ambient",
    "policy.sigstore.dev/include": "true",
  });
});

test("the shared-gateway label is set on the suborg namespace only while platform-shared-gateway is on", async () => {
  const on = await renderStep(
    stepTemplate(
      composition(render(...suborgOn(true)), "organization-local"),
      "compose-suborg-namespace",
    ),
    suborg,
  );
  assert.equal(
    mapping(ofKind(on, "Namespace")!, "labels")[
      "platform.kore.dev/shared-gateway"
    ],
    "true",
  );
  const off = await renderStep(
    stepTemplate(
      composition(render(...suborgOn(false)), "organization-local"),
      "compose-suborg-namespace",
    ),
    suborg,
  );
  assert.equal(
    mapping(ofKind(off, "Namespace")!, "labels")[
      "platform.kore.dev/shared-gateway"
    ],
    undefined,
  );
});

test("the suborg's ResourceQuota and LimitRange are derived from its quota, with no default", async () => {
  const step = stepTemplate(
    composition(render(...suborgOn(false)), "organization-local"),
    "compose-suborg-namespace",
  );
  const rendered = await renderStep(step, suborg);
  const quota = ofKind(rendered, "ResourceQuota")!;
  assert.match(quota, /^  namespace: api$/m);
  assert.deepEqual(mapping(quota, "hard"), {
    "requests.cpu": "4",
    "requests.memory": "8Gi",
    pods: "20",
    "requests.storage": "100Gi",
  });
  const limits = ofKind(rendered, "LimitRange")!;
  assert.match(limits, /^  namespace: api$/m);
  assert.match(limits, /type: Container/);
  assert.match(limits, /type: PersistentVolumeClaim/);
  assert.doesNotMatch(limits, /default/);
  assert.match(limits, /^\s+cpu: "4"$/m);
  assert.match(limits, /^\s+memory: "8Gi"$/m);
  assert.match(limits, /^\s+storage: "100Gi"$/m);
});

test("a composite with no parent, the platform tenant root, renders no namespace", async () => {
  const step = stepTemplate(
    composition(render(...suborgOn(false)), "organization-local"),
    "compose-suborg-namespace",
  );
  const rendered = await renderStep(step, {
    metadata: { name: "platform" },
    spec: { tenant: "platform" },
  });
  assert.equal(ofKind(rendered, "Namespace"), undefined);
});

test("with suborg-tenancy on the Service composition creates no namespace, and still reports the default host", () => {
  const service = composition(render(...suborgOn(false)), "service-local");
  assert.doesNotMatch(service, /kind: Namespace/);
  assert.match(service, /defaultHost:/);
});

test("with suborg-tenancy off the Service composition still creates one namespace per environment", () => {
  const service = composition(render(), "service-local");
  assert.match(service, /kind: Namespace/);
});
