// Docs: docs/decisions/0066-opa-receives-peer-identity-via-xfcc.md (exemption by name)
import type { Component } from "./types.js";

/** The marker for a namespace Kubernetes ships; no catalog component owns it. */
export const clusterProvided = "cluster-provided";

/** One entry of `infra/catalog/gatekeeper-exemptions.yaml`. */
export interface ListedExemption {
  kind: string;
  name: string;
  namespace: string;
  component: string;
  adr: number;
  reason: string;
}

/** A constraint and the namespaces it exempts. */
export interface ConstraintExemptions {
  kind: string;
  name: string;
  exemptNamespaces: string[];
}

/** Where the check reads the repository from; the only side effects it has. */
export interface ExemptionSource {
  constraints(): Promise<ConstraintExemptions[]>;
  listed(): Promise<ListedExemption[]>;
  /** The ADR's status, or undefined when no such ADR exists. */
  adrStatus(adr: number): Promise<string | undefined>;
  applicationNamespaces(): Promise<string[]>;
}

const listFile = "gatekeeper-exemptions.yaml";

/**
 * Checks that every Gatekeeper exemption is listed with its owning component
 * and an accepted ADR, and that no application namespace is exempt. It returns
 * findings; the caller decides whether they warn or fail (`exemptionCheck`).
 */
export class ExemptionCheck {
  constructor(private readonly source: ExemptionSource) {}

  async findings(components: Component[]): Promise<string[]> {
    const [constraints, listed, applications] = await Promise.all([
      this.source.constraints(),
      this.source.listed(),
      this.source.applicationNamespaces(),
    ]);
    const findings: string[] = [];
    const used = new Set<string>();
    for (const { name, exemptNamespaces } of constraints) {
      for (const namespace of exemptNamespaces) {
        used.add(`${name}/${namespace}`);
        if (applications.includes(namespace)) {
          findings.push(
            `exemption: ${name} exempts application namespace ${namespace}; remove it from exemptNamespaces, since applications are never exempt`,
          );
        }
        if (!listed.some((e) => e.name === name && e.namespace === namespace)) {
          findings.push(
            `exemption: ${name} exempts namespace ${namespace}, which ${listFile} does not list; add an entry with its component and accepted ADR, or remove the namespace from exemptNamespaces`,
          );
        }
      }
    }
    for (const entry of listed) {
      if (!used.has(`${entry.name}/${entry.namespace}`)) {
        findings.push(
          `exemption: ${entry.name} namespace ${entry.namespace} is listed but no constraint exempts it; remove the entry from ${listFile}`,
        );
        continue;
      }
      findings.push(
        ...this.componentFindings(entry, components),
        ...(await this.adrFindings(entry)),
      );
    }
    return [...new Set(findings)];
  }

  private componentFindings(
    { name, namespace, component }: ListedExemption,
    components: Component[],
  ): string[] {
    if (component === clusterProvided) {
      return [];
    }
    const owner = components.find((c) => c.name === component);
    if (!owner) {
      return [
        `exemption: ${name} namespace ${namespace} names component ${component}, which is not in the catalog; name the owning component or use ${clusterProvided}`,
      ];
    }
    if (owner.namespace !== namespace) {
      return [
        `exemption: ${name} namespace ${namespace} is not the namespace of component ${component} (${owner.namespace}); name the component that owns ${namespace} or use ${clusterProvided}`,
      ];
    }
    return [];
  }

  private async adrFindings({
    name,
    namespace,
    adr,
  }: ListedExemption): Promise<string[]> {
    const status = await this.source.adrStatus(adr);
    if (status === "accepted") {
      return [];
    }
    return [
      `exemption: ${name} namespace ${namespace} cites ADR ${String(adr).padStart(4, "0")}, which is ${status ?? "missing"}; cite an accepted ADR or remove the exemption`,
    ];
  }
}
