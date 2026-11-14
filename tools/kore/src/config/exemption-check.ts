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
  /** Namespaces the ADR 0032 static-pass image policy covers. */
  staticPassNamespaces(): Promise<string[]>;
  /** Gate constraint names the admission-gate role lets bootstrap write (ADR 0054). */
  gateWriters(): Promise<string[]>;
}

/** The ClusterImagePolicy whose static pass skips signature checks (ADR 0032). */
const staticPassPolicy = "kore-upstream-images";

const listFile = "gatekeeper-exemptions.yaml";

/**
 * Checks that every Gatekeeper exemption is listed with its owning component
 * and an accepted ADR, and that no application namespace is exempt. It returns
 * findings; the caller decides whether they warn or fail (`exemptionCheck`).
 */
export class ExemptionCheck {
  constructor(private readonly source: ExemptionSource) {}

  async findings(components: Component[]): Promise<string[]> {
    const [constraints, listed, applications, staticPass, gateWriters] =
      await Promise.all([
        this.source.constraints(),
        this.source.listed(),
        this.source.applicationNamespaces(),
        this.source.staticPassNamespaces(),
        this.source.gateWriters(),
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
    findings.push(
      ...this.staticPassFindings(staticPass, applications, listed, used),
      ...this.gateWriterFindings(gateWriters, listed, used),
    );
    for (const entry of listed) {
      if (
        !used.has(`${entry.name}/${entry.namespace}`) &&
        !used.has(entry.name)
      ) {
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

  private staticPassFindings(
    namespaces: string[],
    applications: string[],
    listed: ListedExemption[],
    used: Set<string>,
  ): string[] {
    const findings: string[] = [];
    for (const namespace of namespaces) {
      used.add(`${staticPassPolicy}/${namespace}`);
      if (applications.includes(namespace)) {
        findings.push(
          `exemption: ${staticPassPolicy} passes images in application namespace ${namespace}; remove it from staticPassNamespaces, since applications are never exempt`,
        );
      }
      if (
        !listed.some(
          (e) => e.name === staticPassPolicy && e.namespace === namespace,
        )
      ) {
        findings.push(
          `exemption: ${staticPassPolicy} passes images in namespace ${namespace}, which ${listFile} does not list; add an entry with its component and accepted ADR, or remove the namespace from staticPassNamespaces`,
        );
      }
    }
    return findings;
  }

  private gateWriterFindings(
    writers: string[],
    listed: ListedExemption[],
    used: Set<string>,
  ): string[] {
    const findings: string[] = [];
    for (const writer of writers) {
      used.add(writer);
      if (!listed.some((e) => e.name === writer)) {
        findings.push(
          `exemption: ${writer} is written by bootstrap automation, which ${listFile} does not list; add an entry with its component and accepted ADR`,
        );
      }
    }
    return findings;
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
