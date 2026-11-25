import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "vitest";

import {
  composition,
  documents,
  ofKind,
  render,
  renderStep,
  root,
  stepTemplate,
  suborg,
  suborgOn,
} from "./suborg-render-support.js";

// Issue 1553 (ADR 0165): with suborg-tenancy and suborg-delivery-project on, the Organization
// composition makes one Argo CD AppProject per suborg, named after it, in the Argo CD
// namespace, admitting only the suborg's namespace, the Kore repository and no cluster-scoped
// kind. Off, the render is byte-identical to main.

const repoURL = "https://github.com/corekraft/kore.git";

/** suborg-tenancy and suborg-delivery-project on, with the Kore repository URL the chart takes. */
const deliveryOn: string[] = [
  ...suborgOn(false),
  "--set",
  "features.suborg-delivery-project=true",
  "--set-string",
  `suborgDelivery.repoURL=${repoURL}`,
];

/** The Organization composition's AppProject step, rendered for a suborg. */
async function suborgAppProject(
  resource: Record<string, unknown> = suborg,
): Promise<string> {
  const step = stepTemplate(
    composition(render(...deliveryOn), "organization-local"),
    "compose-suborg-appproject",
  );
  return renderStep(step, resource);
}

/** The AppProject documents in a rendered step. */
function appProjects(rendered: string): string[] {
  return documents(rendered).filter((document) =>
    /^kind: AppProject$/m.test(document),
  );
}

test("with suborg-delivery-project absent the Organization composition has no AppProject step", () => {
  assert.doesNotMatch(
    composition(render(...suborgOn(false)), "organization-local"),
    /compose-suborg-appproject/,
  );
});

test("with suborg-delivery-project off the render is byte-identical to the suborg-tenancy golden, the flag adds nothing", async () => {
  const rendered = render(
    ...suborgOn(false),
    "--set",
    "features.suborg-delivery-project=false",
  );
  assert.equal(
    rendered,
    await readFile(
      join(
        root,
        "tools/kore/src/platform/fixtures/platform-apis.suborg-tenancy-only.yaml",
      ),
      "utf8",
    ),
  );
  assert.equal(
    rendered,
    render(...suborgOn(false)),
    "an explicit false renders exactly as an absent flag",
  );
});

test("with both flags on the Organization composition has one step that composes each suborg's AppProject, before mark-ready", () => {
  const organization = composition(render(...deliveryOn), "organization-local");
  assert.match(organization, /- step: compose-suborg-appproject/);
  assert.ok(
    organization.indexOf("- step: compose-suborg-appproject") <
      organization.indexOf("- step: mark-ready"),
    "the AppProject step runs before the Organization is marked ready",
  );
});

test("each suborg gets exactly one AppProject, named after the suborg, in the Argo CD namespace", async () => {
  const projects = appProjects(await suborgAppProject());
  assert.equal(projects.length, 1, "one AppProject per suborg");
  const [project] = projects;
  assert.match(project!, /^apiVersion: argoproj\.io\/v1alpha1$/m);
  assert.match(project!, /^metadata:\n  name: api$/m, "named after the suborg");
  assert.match(project!, /^  namespace: argocd$/m, "in the Argo CD namespace");
});

test("the AppProject is owned by the composition, as a composed resource of its pipeline step", async () => {
  const [project] = appProjects(await suborgAppProject());
  assert.match(
    project!,
    /gotemplating\.fn\.crossplane\.io\/composition-resource-name: appproject$/m,
  );
});

test("the AppProject's only destination is the suborg's namespace on the cluster it runs in", async () => {
  const [project] = appProjects(await suborgAppProject());
  assert.match(
    project!,
    /^  destinations:\n    - server: https:\/\/kubernetes\.default\.svc\n      namespace: api$/m,
    "exactly one destination, the suborg namespace",
  );
  assert.equal(
    [...project!.matchAll(/^\s+- server: /gm)].length,
    1,
    "the destination list has one entry",
  );
});

test("the AppProject's only source is the Kore repository URL the chart is passed", async () => {
  const [project] = appProjects(await suborgAppProject());
  assert.match(
    project!,
    new RegExp(
      `^  sourceRepos:\\n    - "${repoURL.replace(/[./]/g, "\\$&")}"$`,
      "m",
    ),
    "exactly one source, the Kore repository",
  );
});

test("the AppProject allows no cluster-scoped kind: its cluster resource allow-list is empty", async () => {
  const [project] = appProjects(await suborgAppProject());
  assert.match(
    project!,
    /^  clusterResourceWhitelist: \[\]$/m,
    "an empty allow-list, so no cluster-scoped kind deploys",
  );
  assert.doesNotMatch(project!, /group: /, "no kind is listed");
});

test("the platform tenant root, which has no parent, gets no AppProject", async () => {
  const rendered = await suborgAppProject({
    metadata: { name: "platform" },
    spec: { tenant: "platform" },
  });
  assert.equal(appProjects(rendered).length, 0);
});

test("with suborg-delivery-project on, the platform-apis render's other documents equal the render with it off, so existing platform projects render unchanged", () => {
  const withoutFlag = documents(render(...suborgOn(false))).filter(
    (document) => !/^kind: (Composition|AppProject)$/m.test(document),
  );
  const withFlag = documents(render(...deliveryOn)).filter(
    (document) => !/^kind: (Composition|AppProject)$/m.test(document),
  );
  assert.deepEqual(withFlag, withoutFlag);
});

test("with suborg-delivery-project on, the render carries exactly the AppProjects of the Argo CD delivery and no other change", () => {
  const rendered = render(...deliveryOn);
  assert.equal(
    ofKind(rendered, "AppProject"),
    undefined,
    "the chart renders no AppProject itself; the composition creates one per suborg at run time",
  );
});

test("with the flag on and no Kore repository URL passed, the chart refuses to render, naming the flag and the field to set", () => {
  assert.throws(
    () =>
      render(
        ...suborgOn(false),
        "--set",
        "features.suborg-delivery-project=true",
      ),
    (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      assert.match(
        message,
        /suborg-tenancy and suborg-delivery-project are on/,
      );
      assert.match(message, /suborgDelivery\.repoURL/);
      return true;
    },
  );
});
