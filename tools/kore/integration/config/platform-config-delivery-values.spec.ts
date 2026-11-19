import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "vitest";
import { findRoot } from "../../src/config/index.js";
import {
  failure,
  handedOver,
  render,
} from "./platform-config-delivery-chart-support.js";

// Docs: docs/decisions/0043-platform-configuration-through-argo-cd.md (environment values)

type Gateway = {
  hostname?: string;
  port?: number;
  service?: { type?: string; nodePort?: number };
};
type Values = { gateway?: Gateway; features?: Record<string, boolean> };

/** The values an Application hands its chart, read back from the rendered `valuesObject` line. */
function valuesObject(doc: string): Values | undefined {
  const line = /^ {6}valuesObject: (.+)$/m.exec(doc)?.[1];
  return line === undefined ? undefined : JSON.parse(line);
}

const overlayFile = async () =>
  readFile(
    join(
      await findRoot(),
      "infra/environments/local/values/platform-config.yaml",
    ),
    "utf8",
  );

async function platformConfig(texts: string[]): Promise<Values | undefined> {
  const docs = (
    await render(
      "--set-json",
      `releaseValues=${JSON.stringify({ "kore-platform-config": texts })}`,
    )
  ).filter((d) => /^kind: Application$/m.test(d));
  const others = docs.filter(
    (d) => !/^ {2}name: kore-platform-config$/m.test(d),
  );
  assert.equal(others.length, handedOver.length - 1);
  for (const other of others) {
    assert.equal(valuesObject(other), undefined);
  }
  return valuesObject(
    docs.find((d) => /^ {2}name: kore-platform-config$/m.test(d))!,
  );
}

test("the rendered kore-platform-config Application carries the overlay's gateway values, NodePort 30443 on port 8443, so Argo CD renders the Gateway the Helm path does", async () => {
  const values = await platformConfig([await overlayFile()]);
  assert.equal(values?.gateway?.service?.type, "NodePort");
  assert.equal(values?.gateway?.service?.nodePort, 30443);
  assert.equal(values?.gateway?.port, 8443);
  assert.equal(values?.gateway?.hostname, "kore.local");
});

test("a release's values files merge in the order given, a later file overriding an earlier one key by key, as Helm's own --values does", async () => {
  const values = await platformConfig([
    await overlayFile(),
    '{"gateway": {"port": 9443}, "features": {"agentgateway-mesh-enrollment": true}}',
  ]);
  assert.equal(values?.gateway?.port, 9443);
  assert.equal(values?.gateway?.service?.nodePort, 30443);
  assert.deepEqual(values?.features, { "agentgateway-mesh-enrollment": true });
});

test("a values file that is not valid YAML fails the render, naming the release, rather than delivering an Application without its values", async () => {
  const message = await failure(platformConfig(["gateway: [unclosed"]));
  assert.match(message, /kore-platform-config/);
});
