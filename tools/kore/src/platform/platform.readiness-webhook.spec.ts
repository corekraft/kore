import assert from "node:assert/strict";
import { test } from "vitest";
import { loadRepository } from "../config/index.js";
import type { Runner } from "../runtime/index.js";
import { reconcileComponent } from "./reconcile.js";
import { platformStatus } from "./status.js";

const WEBHOOK = "validatingwebhookconfiguration/demo-webhook";

interface WebhookOptions {
  caBundle?: string;
  annotations?: Record<string, string>;
}

function webhookJson(options: WebhookOptions = {}): string {
  return JSON.stringify({
    metadata: { name: "demo-webhook", annotations: options.annotations ?? {} },
    webhooks: [
      {
        name: "validate.demo.example",
        clientConfig: {
          caBundle: options.caBundle ?? "Q0E=",
          service: { name: "demo-webhook", namespace: "demo-system" },
        },
      },
      {
        name: "external.demo.example",
        clientConfig: { url: "https://example.invalid/validate" },
      },
    ],
  });
}

function slices(...ready: (boolean | undefined)[]): string {
  return JSON.stringify({
    items: [
      {
        endpoints: ready.map((value) => ({
          addresses: ["10.0.0.1"],
          conditions: value === undefined ? {} : { ready: value },
        })),
      },
    ],
  });
}

const deployed = JSON.stringify({ info: { status: "deployed" } });

function cluster(
  webhook: () => string,
  endpointSlices: () => string,
): { runner: Runner; kubectl: string[] } {
  const kubectl: string[] = [];
  const runner: Runner = {
    async run(command, args) {
      if (command === "helm") {
        return { stdout: deployed, stderr: "", code: 0 };
      }
      const text = args.join(" ");
      kubectl.push(text);
      if (text.includes("webhookconfiguration")) {
        return { stdout: webhook(), stderr: "", code: 0 };
      }
      if (text.includes("endpointslices")) {
        return { stdout: endpointSlices(), stderr: "", code: 0 };
      }
      return { stdout: "", stderr: "", code: 0 };
    },
  };
  return { runner, kubectl };
}

async function setup() {
  const repository = await loadRepository("local");
  const found = repository.catalog.components.find(
    ({ kind }) => kind === "helm",
  )!;
  const component = {
    ...found,
    readiness: [WEBHOOK],
    ownsCRDs: [],
    dependencies: [],
    timeout: "1s",
  };
  repository.catalog.components = [component];
  return { repository, component };
}

test("a webhook configuration is ready when its CA bundle is injected and its Service has a ready endpoint", async () => {
  const { repository, component } = await setup();
  const { runner, kubectl } = cluster(
    () => webhookJson(),
    () => slices(true),
  );

  await reconcileComponent(repository, runner, component);

  const slice = kubectl.find((text) => text.includes("endpointslices"));
  assert.match(slice ?? "", /--namespace demo-system/);
  assert.match(slice ?? "", /kubernetes\.io\/service-name=demo-webhook/);
  assert.deepEqual(
    kubectl.filter((text) =>
      /\b(apply|create|delete|patch|replace)\b/.test(text),
    ),
    [],
  );
});

test("a webhook without a CA bundle fails naming the webhook and the injecting controller", async () => {
  const { repository, component } = await setup();
  const { runner } = cluster(
    () =>
      webhookJson({
        caBundle: "",
        annotations: {
          "cert-manager.io/inject-ca-from": "demo-system/demo-serving-cert",
        },
      }),
    () => slices(true),
  );

  await assert.rejects(
    reconcileComponent(repository, runner, component),
    /validatingwebhookconfiguration\/demo-webhook .*validate\.demo\.example.*no caBundle.*cert-manager cainjector.*demo-system\/demo-serving-cert/s,
  );
});

test("a webhook without a CA bundle or injection annotation still names the webhook", async () => {
  const { repository, component } = await setup();
  const { runner } = cluster(
    () => webhookJson({ caBundle: "" }),
    () => slices(true),
  );

  await assert.rejects(
    reconcileComponent(repository, runner, component),
    /validate\.demo\.example.*no caBundle.*owning controller/s,
  );
});

test("a webhook whose Service has no ready endpoints fails naming the Service", async () => {
  const { repository, component } = await setup();
  const { runner } = cluster(
    () => webhookJson(),
    () => slices(false),
  );

  await assert.rejects(
    reconcileComponent(repository, runner, component),
    /validate\.demo\.example.*Service demo-system\/demo-webhook, which has no ready endpoints/s,
  );
});

test("a webhook Service with no EndpointSlices at all is not ready", async () => {
  const { repository, component } = await setup();
  const { runner } = cluster(
    () => webhookJson(),
    () => JSON.stringify({ items: [] }),
  );

  await assert.rejects(
    reconcileComponent(repository, runner, component),
    /Service demo-system\/demo-webhook, which has no ready endpoints/,
  );
});

test("a webhook configuration that does not exist yet is awaited until it appears", async () => {
  const { repository, component } = await setup();
  let reads = 0;
  const { runner } = cluster(
    () => {
      reads += 1;
      if (reads < 2) {
        throw new Error(
          'Error from server (NotFound): validatingwebhookconfigurations "demo-webhook" not found',
        );
      }
      return webhookJson();
    },
    () => slices(true),
  );

  await reconcileComponent(repository, runner, component);

  assert.equal(reads, 2);
});

test("a webhook configuration that never appears fails as not found", async () => {
  const { repository, component } = await setup();
  const { runner } = cluster(
    () => {
      throw new Error(
        'validatingwebhookconfigurations "demo-webhook" not found',
      );
    },
    () => slices(true),
  );

  await assert.rejects(
    reconcileComponent(repository, runner, component),
    /validatingwebhookconfiguration\/demo-webhook not ready .*not found/s,
  );
});

test("a mutating webhook configuration is checked the same way", async () => {
  const { repository, component } = await setup();
  const { runner, kubectl } = cluster(
    () => webhookJson(),
    () => slices(true),
  );
  const mutating = "mutatingwebhookconfiguration/demo-webhook";

  await reconcileComponent(repository, runner, {
    ...component,
    readiness: [mutating],
  });

  assert.ok(kubectl.some((text) => text.includes(mutating)));
});

test("an endpoint that does not state readiness is treated as ready", async () => {
  const { repository, component } = await setup();
  const { runner } = cluster(
    () => webhookJson(),
    () => slices(undefined),
  );

  await reconcileComponent(repository, runner, component);
});

test("status reports a webhook missing its CA bundle as degraded, naming the webhook, within a bound", async () => {
  const { repository } = await setup();
  const { runner } = cluster(
    () => webhookJson({ caBundle: "" }),
    () => slices(true),
  );

  const [status] = await platformStatus(repository, runner);

  assert.equal(status?.status, "degraded");
  assert.match(status!.detail, /validatingwebhookconfiguration\/demo-webhook/);
  assert.match(status!.detail, /validate\.demo\.example.*no caBundle/s);
});
