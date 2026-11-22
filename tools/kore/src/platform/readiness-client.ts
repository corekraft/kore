import type { Runner } from "../runtime/index.js";
import { pollUntil } from "./readiness-poll.js";

// Docs: docs/decisions/0113-run-a-keycloak-for-the-platform-organization-s-operators.md

/** The Backstage client the platform-backstage chart declares (ADR 0113, issue 1730). */
const CLIENT = "client.openidclient.keycloak.m.crossplane.io/backstage";
const NOT_FOUND = /NotFound|not found/i;
const NOT_DECLARED =
  "client backstage does not exist in namespace backstage; the platform-backstage chart declares it while platform-portal is on";
/** Prints `ready` only when the Ready condition is True, so the probe reads one token. */
const READY_TEMPLATE =
  '{{range .status.conditions}}{{if and (eq .type "Ready") (eq .status "True")}}ready{{end}}{{end}}';

/** What the check reads from: the runner and the kubectl scope of the component. */
export interface ClientContext {
  runner: Runner;
  base: string[];
}

/** A readiness check: the condition it proves and a bounded evaluation. */
export interface ClientCheck {
  condition: string;
  run: (timeout: string) => Promise<void>;
}

/**
 * Proves the Backstage client is Ready, which the Crossplane Keycloak provider
 * reports once the client exists in the platform realm. Each poll names the
 * reason it is not ready, so a missing realm or a missing Secret ends the wait
 * with that reason, not a bare timeout. Undefined for any other resource.
 */
export function clientCheck(
  context: ClientContext,
  resource: string,
): ClientCheck | undefined {
  if (resource !== CLIENT) {
    return undefined;
  }
  return {
    condition: "Ready, with the client registered in the platform realm",
    run: (timeout) => pollUntil(timeout, () => notReadyReason(context)),
  };
}

async function readOrDeclared(
  { runner, base }: ClientContext,
  output: string,
): Promise<string | undefined> {
  try {
    const result = await runner.run(
      "kubectl",
      [...base, "get", CLIENT, "--output", output],
      { capture: true },
    );
    return result.stdout.trim();
  } catch (error) {
    if (error instanceof Error && NOT_FOUND.test(error.message)) {
      return undefined;
    }
    throw error;
  }
}

async function notReadyReason(
  context: ClientContext,
): Promise<string | undefined> {
  const ready = await readOrDeclared(context, `go-template=${READY_TEMPLATE}`);
  if (ready === undefined) {
    return NOT_DECLARED;
  }
  if (ready === "ready") {
    return undefined;
  }
  const message = readyMessage((await readOrDeclared(context, "json")) ?? "{}");
  if (message === undefined) {
    return "client backstage has no Ready condition yet";
  }
  return `client backstage is not Ready: ${message || "no reason given"}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * The message of the Ready condition in a JSON Client, or undefined when it has
 * none. The reply is read as unknown and each field narrowed, so a reply of
 * another shape reads as having no Ready condition.
 */
function readyMessage(json: string): string | undefined {
  const item: unknown = JSON.parse(json);
  const status = isRecord(item) ? item["status"] : undefined;
  const conditions = isRecord(status) ? status["conditions"] : undefined;
  if (!Array.isArray(conditions)) {
    return undefined;
  }
  const ready: unknown = conditions.find(
    (candidate: unknown) =>
      isRecord(candidate) && candidate["type"] === "Ready",
  );
  if (!isRecord(ready)) {
    return undefined;
  }
  return typeof ready["message"] === "string" ? ready["message"] : "";
}
