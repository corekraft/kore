// The readiness of a foreign name's Certificate (ADR 0157, issue 1678): the Certificate is
// waited on by name, and when it does not become Ready the failure names the cause and the
// owner's fix, never only a timeout.
// Docs: docs/decisions/0157-a-name-under-another-domain-is-served-after-an-http-01-proof-and-certificates-come-from-acme.md
// Docs: docs/decisions/0160-vps-has-an-internal-gateway-on-the-tailnet-and-an-external-gateway-on-public-443.md

import {
  foreignCertificateName,
  type Component,
  type Repository,
} from "../config/index.js";
import type { Runner } from "../runtime/index.js";

/** The catalog component whose chart renders the foreign Certificates (infra/catalog/components.yaml). */
const platformCertificateComponent = "kore-local-tls";

/** The resource prefix every foreign name's Certificate takes (foreignCertificateName). */
export const foreignCertificatePrefix = "certificate/foreign-";

/** The ACME challenges, listed as one line each: the name they prove, then the reason cert-manager gives. */
const challengesPath = "challenges.acme.cert-manager.io";
const challengeLines = `jsonpath={range .items[*]}{.spec.dnsName}{"\\t"}{.status.reason}{"\\n"}{end}`;

const dnsCause = /no such host|NXDOMAIN|server misbehaving/i;
const unreachableCause =
  /connection refused|i\/o timeout|no route to host|dial tcp|connection reset/i;
const unservedCause = /wrong status code|invalid response|unexpected/i;

/** The Certificate resources a component waits on for its foreign names; none for another component. */
export function foreignCertificateResources(
  repository: Repository,
  component: Component,
): string[] {
  if (component.name !== platformCertificateComponent) {
    return [];
  }
  return (repository.foreignNames ?? []).map(
    (host) => `certificate/${foreignCertificateName(host)}`,
  );
}

/** The cause a challenge's reason names, read by the rules above; the fallback names the name. */
function causeOf(host: string, reason: string | undefined): string {
  if (reason === undefined) {
    return "no challenge exists yet, so its Certificate has not started";
  }
  if (dnsCause.test(reason)) {
    return `the public DNS of ${host} does not resolve to the platform`;
  }
  if (unreachableCause.test(reason)) {
    return `port 80 of the platform's external address cannot be reached for ${host}`;
  }
  if (unservedCause.test(reason)) {
    return `${host} reaches the platform but the challenge path is not served`;
  }
  return `the ACME challenge for ${host} did not pass`;
}

/**
 * The failure message of a foreign name that is not proven: the cause, the owner's fix
 * (an A record at the external address, ADR 0160) and, when cert-manager gave one, the
 * ACME reason verbatim.
 */
export function foreignCertificateMessage(
  host: string,
  reason: string | undefined,
): string {
  const fix = `Fix: at the DNS provider of ${host}, create an A record for ${host} that points at the platform's external address (ADR 0160), then run kore platform up again.`;
  const said = reason === undefined ? "" : ` ACME said: ${reason}`;
  return `foreign name ${host} is not proven: ${causeOf(host, reason)}. ${fix}${said}`;
}

/** The reason of the challenge that proves a host, from the listed lines, or undefined when none gives one. */
function reasonFor(listing: string, host: string): string | undefined {
  for (const line of listing.split("\n")) {
    const [dnsName, reason] = line.split("\t");
    if (dnsName === host && reason !== undefined && reason !== "") {
      return reason;
    }
  }
  return undefined;
}

/**
 * The message of a foreign Certificate that did not become Ready. The resource is matched
 * to its name in the records; its challenge, read in the namespace, gives the reason. A
 * resource no record claims is named as such, with the commands that find the record.
 */
export async function foreignCertificateFailure(
  runner: Runner,
  base: string[],
  resource: string,
  names: readonly string[],
): Promise<string> {
  const host = names.find(
    (name) => `certificate/${foreignCertificateName(name)}` === resource,
  );
  if (host === undefined) {
    return `${resource} is not proven: no service record claims a foreign name for it. Fix: run kore validate, then kore platform up again.`;
  }
  const { stdout } = await runner.run(
    "kubectl",
    [...base, "get", challengesPath, "--output", challengeLines],
    { capture: true },
  );
  return foreignCertificateMessage(host, reasonFor(stdout, host));
}
