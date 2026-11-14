import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "vitest";
import { findRoot } from "../config/index.js";
import { decisionLogArguments } from "./identity-live.js";

// Docs: docs/decisions/0066-opa-receives-peer-identity-via-xfcc.md
const read = async (path: string): Promise<string> =>
  readFile(join(await findRoot(), path), "utf8");

test("the protected route's CUSTOM policy names an extension provider the mesh defines, and the provider fails closed", async () => {
  const mesh = await read("infra/environments/common/values/istiod.yaml");
  const workload = await read(
    "apps/reference/charts/workload/templates/workloads.yaml",
  );
  const provider =
    /action: CUSTOM\s*\n\s*provider:\s*\{\s*name:\s*([\w-]+)/.exec(
      workload,
    )?.[1];
  assert.ok(provider, "the protected route needs a CUSTOM policy provider");
  const block = new RegExp(
    `- name: ${provider}\\n\\s+envoyExtAuthzGrpc:\\n([\\s\\S]*?)(?:\\n\\s*\\n|\\n\\s+- name:|\\nimage:)`,
  ).exec(mesh)?.[1];
  assert.ok(block, `mesh config must define extension provider ${provider}`);
  assert.match(
    block,
    /failOpen:\s*false/,
    "an unreachable authorizer must deny",
  );
  assert.match(block, /port:\s*9191/);
});

test("the waypoint that fronts the CUSTOM policy forwards peer identity and the policy targets the service behind it", async () => {
  const workload = await read(
    "apps/reference/charts/workload/templates/workloads.yaml",
  );
  assert.match(workload, /name: reference-api-waypoint/);
  assert.match(
    workload,
    /ambient\.istio\.io\/xfcc-include-client-identity:\s*"true"/,
  );
  assert.match(
    workload,
    /kind: AuthorizationPolicy\nmetadata: \{name: api-opa-protected\}\nspec:\n\s+targetRefs:\n\s+- group: ""\n\s+kind: Service\n\s+name: reference-api\n\s+action: CUSTOM/,
  );
});

test("decision logs are read from every authorizer replica, not whichever pod kubectl picks", () => {
  const args = decisionLogArguments("opa-system");
  assert.deepEqual(args.slice(0, 2), ["--namespace", "opa-system"]);
  assert.ok(args.includes("--selector=app.kubernetes.io/name=opa-authorizer"));
  assert.ok(args.some((a) => a.startsWith("--max-log-requests=")));
  assert.ok(!args.includes("deployment/opa-authorizer"));
});
