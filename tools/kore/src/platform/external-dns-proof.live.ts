// Docs: docs/decisions/0162-external-dns-publishes-route-records-for-the-external-gateway-behind-external-dns.md
// The pure half of the opt-in local proof of external-dns with the inmemory provider (issue #1617): the
// throwaway environment, the three test routes, the log check and the outcome arguments. It starts nothing.
import type { Environment } from "../config/index.js";

/**
 * The domain the proof runs under. The local overlay names kore.internal, but external-dns filters on the
 * platform domain, so the throwaway copy names this one and the test names sit under it (example names only).
 */
export const proofDomain = "example.com";

/**
 * The flags the throwaway copy turns on, each after the one it needs (flag-dependencies.ts): the external
 * Gateway needs service-listener-sets, and external-dns needs the external Gateway.
 */
export const proofFlags = [
  "service-listener-sets",
  "external-gateway",
  "external-dns",
] as const;

/** The namespace the test routes are created in: the external Gateway admits routes from its own namespace only. */
const routeNamespace = "kore-system";
const gatewayName = "kore-gateway-external";
const listener = "http";

/** The three names the proof routes through the external Gateway (ADR 0162). */
export const proofRoutes = {
  published: {
    name: "external-dns-proof-app",
    hostname: `app.${proofDomain}`,
  },
  outside: {
    name: "external-dns-proof-outside",
    hostname: "app.example.org",
  },
  internal: {
    name: "external-dns-proof-internal",
    hostname: `api.internal.${proofDomain}`,
  },
} as const;

/**
 * The throwaway copy's environment: the proof flags on and the proof domain in place of the overlay's, every
 * other field as given. It returns a new object and never changes the one it is given, so the tracked overlay
 * is never edited (the throwaway-overlay approach).
 */
export function throwawayEnvironment(environment: Environment): Environment {
  const features: Record<string, boolean> = { ...environment.features };
  for (const flag of proofFlags) {
    features[flag] = true;
  }
  return {
    ...environment,
    features,
    platform: { ...environment.platform, domain: proofDomain },
  };
}

/**
 * The three HTTPRoutes, as JSON (valid YAML, so kubectl applies it). Each is in kore-system with its parent the
 * external Gateway's http listener, and each names exactly one hostname. Each redirects to HTTPS, so no backend
 * is needed.
 */
export function proofRoutesManifest(): string {
  const items = Object.values(proofRoutes).map((route) => ({
    apiVersion: "gateway.networking.k8s.io/v1",
    kind: "HTTPRoute",
    metadata: {
      name: route.name,
      namespace: routeNamespace,
      labels: { "platform.kore.dev/proof": "external-dns" },
    },
    spec: {
      hostnames: [route.hostname],
      parentRefs: [
        {
          group: "gateway.networking.k8s.io",
          kind: "Gateway",
          name: gatewayName,
          namespace: routeNamespace,
          sectionName: listener,
        },
      ],
      rules: [
        {
          filters: [
            {
              type: "RequestRedirect",
              requestRedirect: { scheme: "https", statusCode: 301 },
            },
          ],
        },
      ],
    },
  }));
  return JSON.stringify({ apiVersion: "v1", kind: "List", items });
}

const ownerId = "kore-vps";

/** A log line as its words: quotes and backslashes separate words, so a quoted message splits like its text. */
function wordsOf(line: string): string[] {
  return line.replace(/["\\]/g, " ").split(/\s+/);
}

/** Whether the line holds one of the actions on the name as adjacent words, with the record type after it when given. */
function changesName(
  line: string,
  name: string,
  actions: readonly string[],
  type?: string,
): boolean {
  const words = wordsOf(line);
  return words.some(
    (word, index) =>
      actions.includes(word) &&
      words[index + 1] === name &&
      (type === undefined || words[index + 2] === type),
  );
}

/**
 * Checks external-dns's log of planned changes for the proof. The published name must have a planned A record
 * and an ownership TXT line with the owner id kore-vps (ADR 0162). The outside and internal names must have no
 * planned change at all, which is what the domain filter and the internal exclusion do by configuration. No
 * planned delete may appear, since the policy is upsert-only. It returns one problem per failed check, each
 * naming its name; an empty list is a pass.
 */
export function externalDnsLogProblems(log: string): string[] {
  const lines = log.split("\n");
  const problems: string[] = [];
  const { hostname } = proofRoutes.published;

  const planned = ["CREATE", "UPDATE"];
  const changeTo = (type: string, extra = "") =>
    lines.some(
      (line) =>
        changesName(line, hostname, planned, type) && line.includes(extra),
    );

  if (!changeTo("A")) {
    problems.push(
      `no planned A change for ${hostname}: external-dns's log holds no CREATE or UPDATE of ${hostname} A`,
    );
  }
  if (!changeTo("TXT", `external-dns/owner=${ownerId}`)) {
    problems.push(
      `no ownership TXT for ${hostname}: external-dns's log holds no TXT of ${hostname} with owner ${ownerId} (external-dns/owner=${ownerId})`,
    );
  }

  for (const route of [proofRoutes.outside, proofRoutes.internal]) {
    const changed = lines.some((line) =>
      changesName(line, route.hostname, [...planned, "DELETE"]),
    );
    if (changed) {
      problems.push(
        `external-dns planned a change to ${route.hostname}, which the domain filter or the internal exclusion must keep out`,
      );
    }
  }

  for (const line of lines) {
    const deleted = /\bDELETE\s+(\S+)/.exec(line);
    if (deleted) {
      problems.push(
        `external-dns planned a DELETE of ${deleted[1]}: the policy is upsert-only, so no delete may be planned (ADR 0162)`,
      );
    }
  }

  return problems;
}

const summary =
  "external-dns in local with the inmemory provider: app.example.com planned an A record and its ownership TXT (owner kore-vps); app.example.org and api.internal.example.com planned nothing; no delete was planned. The Cloudflare read-back is not covered here, and a record without an ownership TXT is not covered on the inmemory provider.";

/**
 * The harness outcome record for a green proof: a confirmed verification of external-dns in local from a live
 * run (ADR 0077). The evidence names the checkout and the logs read. Refuses an empty idea, and evidence that
 * is not one line or holds an HTML comment, since outcome record refuses those too.
 */
export function outcomeArgs(idea: string, evidence: string): string[] {
  if (idea.trim() === "") {
    throw new Error(
      "the outcome needs an idea: set KORE_EXTERNAL_DNS_IDEA to the idea's number or slug (harness idea list shows them)",
    );
  }
  if (/[\r\n]/.test(evidence) || evidence.includes("<!--")) {
    throw new Error(
      "the outcome's evidence must be one line with no HTML comment, since outcome record refuses it",
    );
  }
  return [
    "outcome",
    "record",
    "--idea",
    idea.trim(),
    "--kind",
    "verification",
    "--source",
    "live-run",
    "--result",
    "confirmed",
    "--flag",
    "external-dns",
    "--environment",
    "local",
    "--evidence",
    evidence,
    "--summary",
    summary,
  ];
}
