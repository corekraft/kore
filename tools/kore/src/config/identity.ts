// Docs: docs/decisions/0007-workload-identity-and-layered-authorization.md
// Istio derives a workload's identity from where it runs and which
// ServiceAccount it uses: spiffe://<trust-domain>/ns/<namespace>/sa/<account>.
// AuthorizationPolicy principals write the same identity without the scheme.

export interface WorkloadPrincipal {
  trustDomain: string;
  namespace: string;
  serviceAccount: string;
}

const label = "[a-z0-9]([-a-z0-9]*[a-z0-9])?";
const principal = new RegExp(
  `^(?:spiffe://)?([a-z0-9]([-a-z0-9.]*[a-z0-9])?)/ns/(${label})/sa/(${label})$`,
);

export const spiffeId = (
  trustDomain: string,
  namespace: string,
  serviceAccount: string,
): string =>
  `spiffe://${spiffePrincipal(trustDomain, namespace, serviceAccount)}`;

export const spiffePrincipal = (
  trustDomain: string,
  namespace: string,
  serviceAccount: string,
): string => `${trustDomain}/ns/${namespace}/sa/${serviceAccount}`;

/** The parts of a principal, or undefined for anything else (wildcards included). */
export function parsePrincipal(value: string): WorkloadPrincipal | undefined {
  const match = principal.exec(value);
  const [, trustDomain, , namespace, , serviceAccount] = match ?? [];
  return trustDomain && namespace && serviceAccount
    ? { trustDomain, namespace, serviceAccount }
    : undefined;
}
