export interface CrdVersion {
  name: string;
  served: boolean;
  storage: boolean;
  schema?: { openAPIV3Schema?: unknown };
}

export interface Crd {
  metadata: { name: string };
  spec: {
    group: string;
    versions: CrdVersion[];
    conversion?: {
      strategy?: string;
      webhook?: {
        clientConfig?: { service?: unknown; url?: string };
        conversionReviewVersions?: string[];
      };
    };
  };
}

function storageVersion(crd: Crd): CrdVersion | undefined {
  return crd.spec.versions.find((version) => version.storage);
}

function stable(value: unknown): string {
  return JSON.stringify(value, (_key, inner: unknown) =>
    inner !== null && typeof inner === "object" && !Array.isArray(inner)
      ? Object.fromEntries(
          Object.entries(inner as Record<string, unknown>).sort(([a], [b]) =>
            a.localeCompare(b),
          ),
        )
      : inner,
  );
}

function webhookProblems(crd: Crd): string[] {
  const name = crd.metadata.name;
  const webhook = crd.spec.conversion?.webhook;
  const problems: string[] = [];
  if (!webhook?.clientConfig?.service && !webhook?.clientConfig?.url) {
    problems.push(
      `${name}: webhook conversion has no clientConfig service or url`,
    );
  }
  if ((webhook?.conversionReviewVersions ?? []).length === 0) {
    problems.push(
      `${name}: webhook conversion declares no conversionReviewVersions`,
    );
  }
  return problems;
}

function conversionProblems(before: Crd, after: Crd): string[] {
  const name = after.metadata.name;
  const strategy = after.spec.conversion?.strategy ?? "None";
  const problems = strategy === "Webhook" ? webhookProblems(after) : [];
  const from = storageVersion(before);
  const to = storageVersion(after);
  if (!from || !to || from.name === to.name) {
    return problems;
  }
  if (
    strategy !== "Webhook" &&
    stable(from.schema?.openAPIV3Schema) !== stable(to.schema?.openAPIV3Schema)
  ) {
    problems.push(
      `${name}: storage version moves from ${from.name} to ${to.name} with conversion None, but the schemas differ; add a conversion webhook or keep one storage version`,
    );
  }
  return problems;
}

/**
 * Problems an upgrade from the CRDs of the old chart to the new chart's CRDs
 * would cause before any controller runs: removed CRDs, a dropped stored
 * version, an unsafe storage-version move, or a malformed conversion webhook.
 */
export function crdUpgradeProblems(before: Crd[], after: Crd[]): string[] {
  const next = new Map(after.map((crd) => [crd.metadata.name, crd]));
  const problems: string[] = [];
  for (const old of before) {
    const name = old.metadata.name;
    const updated = next.get(name);
    if (!updated) {
      problems.push(
        `${name}: CRD removed; deleting it deletes every custom resource of that kind`,
      );
      continue;
    }
    const stored = storageVersion(old);
    if (stored && !updated.spec.versions.some((v) => v.name === stored.name)) {
      problems.push(
        `${name}: stored version ${stored.name} is no longer defined; objects stored at it become unreadable`,
      );
      continue;
    }
    problems.push(...conversionProblems(old, updated));
  }
  for (const crd of after) {
    if (!before.some((old) => old.metadata.name === crd.metadata.name)) {
      if (crd.spec.conversion?.strategy === "Webhook") {
        problems.push(...webhookProblems(crd));
      }
    }
  }
  return problems;
}

/**
 * Problems rolling the controller back to the old chart would cause after the
 * new CRDs are applied: an old CRD that cannot read the version the new one
 * now stores objects at.
 */
export function crdRollbackProblems(before: Crd[], after: Crd[]): string[] {
  const old = new Map(before.map((crd) => [crd.metadata.name, crd]));
  const problems: string[] = [];
  for (const crd of after) {
    const previous = old.get(crd.metadata.name);
    const stored = storageVersion(crd);
    if (!previous || !stored) {
      continue;
    }
    if (!previous.spec.versions.some((v) => v.name === stored.name)) {
      problems.push(
        `${crd.metadata.name}: rollback cannot read version ${stored.name}; objects stored at it are unreadable after the old chart's CRD is restored`,
      );
    }
  }
  return problems;
}
