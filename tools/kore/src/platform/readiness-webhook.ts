import type { Runner } from "../runtime/index.js";
import { pollUntil } from "./readiness-poll.js";

/** `validatingwebhookconfiguration/<name>` or `mutatingwebhookconfiguration/<name>`. */
export const WEBHOOK_CONFIGURATION =
  /^(validating|mutating)webhookconfiguration\//;

interface ServiceReference {
  name: string;
  namespace: string;
}

interface Webhook {
  name: string;
  clientConfig?: { caBundle?: string; service?: ServiceReference };
}

interface Configuration {
  metadata?: { annotations?: Record<string, string> };
  webhooks?: Webhook[];
}

interface EndpointSlices {
  items?: { endpoints?: { conditions?: { ready?: boolean } }[] }[];
}

/** Names the controller that injects a caBundle, from the configuration's annotations. */
function injector(annotations: Record<string, string> = {}): string {
  for (const key of [
    "cert-manager.io/inject-ca-from",
    "cert-manager.io/inject-ca-from-secret",
  ]) {
    if (annotations[key]) {
      return `cert-manager cainjector injects it from ${annotations[key]} (${key})`;
    }
  }
  return "the owning controller has not injected it yet";
}

async function getJson<T>(
  runner: Runner,
  context: string,
  namespace: string | undefined,
  args: string[],
): Promise<T> {
  const result = await runner.run(
    "kubectl",
    [
      "--context",
      context,
      ...(namespace ? ["--namespace", namespace] : []),
      "get",
      ...args,
      "--output",
      "json",
    ],
    { capture: true },
  );
  return JSON.parse(result.stdout) as T;
}

async function hasReadyEndpoint(
  runner: Runner,
  context: string,
  { name, namespace }: ServiceReference,
): Promise<boolean> {
  const slices = await getJson<EndpointSlices>(runner, context, namespace, [
    "endpointslices",
    "--selector",
    `kubernetes.io/service-name=${name}`,
  ]);
  return (slices.items ?? []).some(({ endpoints = [] }) =>
    endpoints.some(({ conditions }) => conditions?.ready !== false),
  );
}

/** Returns why the configuration is not ready, or undefined when it is. */
async function notReady(
  runner: Runner,
  context: string,
  resource: string,
): Promise<string | undefined> {
  const configuration = await getJson<Configuration>(
    runner,
    context,
    undefined,
    [resource],
  );
  for (const { name, clientConfig } of configuration.webhooks ?? []) {
    const service = clientConfig?.service;
    if (!service) {
      continue;
    }
    if (!clientConfig.caBundle) {
      return `webhook ${name} has no caBundle yet; ${injector(configuration.metadata?.annotations)}`;
    }
    if (!(await hasReadyEndpoint(runner, context, service))) {
      return `webhook ${name} needs Service ${service.namespace}/${service.name}, which has no ready endpoints`;
    }
  }
  return undefined;
}

/**
 * Waits until the webhook configuration exists, every Service-backed webhook
 * carries a caBundle, and each referenced Service has a ready endpoint.
 */
export async function waitForWebhook(
  runner: Runner,
  context: string,
  resource: string,
  timeout: string,
): Promise<void> {
  await pollUntil(timeout, () => notReady(runner, context, resource));
}
