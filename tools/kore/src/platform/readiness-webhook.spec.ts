// Docs: infra/plans/14-test-tiers.md#step-2-pilots
import { expect, test, vi } from "vitest";
import type { Runner } from "../runtime/index.js";
import { pollUntil } from "./readiness-poll.js";
import { WEBHOOK_CONFIGURATION, waitForWebhook } from "./readiness-webhook.js";

vi.mock("./readiness-poll.js");

const CONTEXT = "k3d-kore-local";
const WEBHOOK = "validatingwebhookconfiguration/demo-webhook";
const SERVICE_WEBHOOK = {
  name: "validate.demo.example",
  clientConfig: {
    caBundle: "Q0E=",
    service: { name: "demo-webhook", namespace: "demo-system" },
  },
};
const URL_WEBHOOK = {
  name: "external.demo.example",
  clientConfig: { url: "https://example.invalid/validate" },
};

type Probe = () => Promise<string | undefined>;
type Run = Runner["run"];

/** A typed runner: the configuration answers `get <resource>`, the slices answer `get endpointslices`. */
function fakeRunner(configuration: unknown, slices: unknown = { items: [] }) {
  const run = vi.fn<Run>(async (_command, args) => ({
    stdout: JSON.stringify(
      args.includes("endpointslices") ? slices : configuration,
    ),
    stderr: "",
    code: 0,
  }));
  return { runner: { run } as Runner, run };
}

/** The one endpoint slice of a Service, with each endpoint's ready condition. */
function endpoints(...ready: (boolean | undefined)[]) {
  return {
    items: [
      {
        endpoints: ready.map((value) => ({
          addresses: ["10.0.0.1"],
          conditions: value === undefined ? {} : { ready: value },
        })),
      },
    ],
  };
}

/** Hands waitForWebhook's probe back to the test, so the probe's own reason is what is asserted. */
async function probeFor(runner: Runner): Promise<Probe> {
  let captured: Probe | undefined;
  vi.mocked(pollUntil).mockImplementation(async (_timeout, probe) => {
    captured = probe;
  });
  await waitForWebhook(runner, CONTEXT, WEBHOOK, "3s");
  return captured!;
}

test("the webhook wait hands its bound and one probe to the shared poll", async () => {
  const { runner } = fakeRunner({ webhooks: [] });

  await probeFor(runner);

  expect(pollUntil).toHaveBeenCalledWith("3s", expect.any(Function));
  expect(vi.mocked(pollUntil).mock.calls).toHaveLength(1);
});

test("a configuration whose webhooks all call a URL is ready, and no Service is looked up", async () => {
  const { runner, run } = fakeRunner({ webhooks: [URL_WEBHOOK] });

  expect(await (await probeFor(runner))()).toBeUndefined();

  expect(run).toHaveBeenCalledTimes(1);
});

test("a webhook with no caBundle is not ready, and the reason names the webhook and the injection that is missing", async () => {
  const { runner } = fakeRunner({
    metadata: { annotations: {} },
    webhooks: [
      {
        ...SERVICE_WEBHOOK,
        clientConfig: { service: SERVICE_WEBHOOK.clientConfig.service },
      },
    ],
  });

  expect(await (await probeFor(runner))()).toBe(
    "webhook validate.demo.example has no caBundle yet; the owning controller has not injected it yet",
  );
});

test("a caBundle still missing names the cert-manager annotation that will inject it", async () => {
  const { runner } = fakeRunner({
    metadata: {
      annotations: { "cert-manager.io/inject-ca-from": "kore-system/demo-ca" },
    },
    webhooks: [
      {
        ...SERVICE_WEBHOOK,
        clientConfig: { service: SERVICE_WEBHOOK.clientConfig.service },
      },
    ],
  });

  expect(await (await probeFor(runner))()).toBe(
    "webhook validate.demo.example has no caBundle yet; cert-manager cainjector injects it from kore-system/demo-ca (cert-manager.io/inject-ca-from)",
  );
});

test("the secret-form injection annotation is named as well", async () => {
  const { runner } = fakeRunner({
    metadata: {
      annotations: {
        "cert-manager.io/inject-ca-from-secret": "kore-system/demo-secret",
      },
    },
    webhooks: [
      {
        ...SERVICE_WEBHOOK,
        clientConfig: { service: SERVICE_WEBHOOK.clientConfig.service },
      },
    ],
  });

  expect(await (await probeFor(runner))()).toBe(
    "webhook validate.demo.example has no caBundle yet; cert-manager cainjector injects it from kore-system/demo-secret (cert-manager.io/inject-ca-from-secret)",
  );
});

test("a webhook whose Service has no ready endpoint is not ready and names the Service", async () => {
  const { runner } = fakeRunner(
    { webhooks: [SERVICE_WEBHOOK] },
    endpoints(false),
  );

  expect(await (await probeFor(runner))()).toBe(
    "webhook validate.demo.example needs Service demo-system/demo-webhook, which has no ready endpoints",
  );
});

test("a Service with no EndpointSlices at all is not ready", async () => {
  const { runner } = fakeRunner({ webhooks: [SERVICE_WEBHOOK] }, { items: [] });

  expect(await (await probeFor(runner))()).toBe(
    "webhook validate.demo.example needs Service demo-system/demo-webhook, which has no ready endpoints",
  );
});

test("an endpoint with no ready condition counts as ready", async () => {
  const { runner } = fakeRunner(
    { webhooks: [SERVICE_WEBHOOK] },
    endpoints(undefined),
  );

  expect(await (await probeFor(runner))()).toBeUndefined();
});

test("one ready endpoint among not-ready ones makes the Service ready", async () => {
  const { runner } = fakeRunner(
    { webhooks: [SERVICE_WEBHOOK] },
    endpoints(false, true),
  );

  expect(await (await probeFor(runner))()).toBeUndefined();
});

test("a configuration with a CA bundle and a ready endpoint is ready", async () => {
  const { runner } = fakeRunner(
    { webhooks: [URL_WEBHOOK, SERVICE_WEBHOOK] },
    endpoints(true),
  );

  expect(await (await probeFor(runner))()).toBeUndefined();
});

test("the configuration is read cluster-wide in the named context, and the Service's endpoint slices in its own namespace", async () => {
  const { runner, run } = fakeRunner(
    { webhooks: [SERVICE_WEBHOOK] },
    endpoints(true),
  );

  await (
    await probeFor(runner)
  )();

  expect(run.mock.calls).toEqual([
    [
      "kubectl",
      ["--context", CONTEXT, "get", WEBHOOK, "--output", "json"],
      { capture: true },
    ],
    [
      "kubectl",
      [
        "--context",
        CONTEXT,
        "--namespace",
        "demo-system",
        "get",
        "endpointslices",
        "--selector",
        "kubernetes.io/service-name=demo-webhook",
        "--output",
        "json",
      ],
      { capture: true },
    ],
  ]);
});

test("the webhook configuration pattern matches validating and mutating configurations only", () => {
  expect(WEBHOOK_CONFIGURATION.test(WEBHOOK)).toBe(true);
  expect(
    WEBHOOK_CONFIGURATION.test("mutatingwebhookconfiguration/demo-webhook"),
  ).toBe(true);
  expect(
    WEBHOOK_CONFIGURATION.test("customresourcedefinition/fakes.example.io"),
  ).toBe(false);
});
