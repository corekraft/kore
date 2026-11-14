// Typed fixtures shared by the config domain's unit specs. A support file is
// not a unit, so it needs no spec of its own (ADR 0098). Each factory takes the
// fields a test sets and fills the rest with a sound default, so a spec never
// builds a fixture with a double cast.
import type {
  ApprovedImageManifest,
  Catalog,
  Component,
  Environment,
  Repository,
  Seed,
  SeedEvidence,
  SeedManifest,
  Versions,
} from "./types.js";

/** A helm component with a sound default; the test sets the fields it reads. */
export function fakeComponent(fields: Partial<Component> = {}): Component {
  return {
    name: "kore-registry",
    phase: "core",
    kind: "helm",
    namespace: "kore-system",
    timeout: "5m",
    version: "istio",
    chart: "infra/charts/registry",
    readiness: [{ kind: "deployment", name: "registry" }],
    dependencies: [],
    ...fields,
  } as Component;
}

/** A local k3d environment with a sound default. */
export function fakeEnvironment(
  fields: Partial<Environment> = {},
): Environment {
  return {
    name: "local",
    provider: "k3d",
    kubeContext: "k3d-kore-local",
    ...fields,
  } as Environment;
}

/** Pinned versions with a sound default kubernetes version. */
export function fakeVersions(
  components: Record<string, string> = {},
  images: Record<string, string> = {},
): Versions {
  return { tools: {}, kubernetes: "1.31.0", components, images };
}

/**
 * A value a validator must reject. The types cannot describe a malformed input,
 * so this is the one place a test casts one, and only for that purpose.
 */
export function malformed<T>(value: unknown): T {
  return value as T;
}

export function fakeEvidence(fields: Partial<SeedEvidence> = {}): SeedEvidence {
  return {
    method: "pulled and scanned",
    source: "upstream registry",
    checked: "2026-01-15",
    provenance: { signed: false },
    ...fields,
  } as SeedEvidence;
}

/** A seed with a sound default; the test sets the field it checks. */
export function fakeSeed(fields: Partial<Seed> = {}): Seed {
  return {
    image: `docker.io/library/registry:2@sha256:${"a".repeat(64)}`,
    catalogImage: "registry",
    component: "kore-registry",
    reason: "bootstrap: the mirror cannot verify itself",
    evidence: fakeEvidence(),
    ...fields,
  } as Seed;
}

export function fakeCatalog(components: Component[] = []): Catalog {
  return { components } as Catalog;
}

export function fakeSeeds(seeds: unknown = []): SeedManifest {
  return { seeds } as SeedManifest;
}

export function fakeApproved(images: unknown = []): ApprovedImageManifest {
  return { images } as ApprovedImageManifest;
}

/** A repository that passes every rule that reads only its own fields. */
export function fakeRepository(fields: Partial<Repository> = {}): Repository {
  return {
    root: "/repo",
    versions: fakeVersions(),
    seeds: fakeSeeds(),
    readiness: { version: 1, requirements: [] },
    approved: fakeApproved(),
    catalog: fakeCatalog(),
    environment: fakeEnvironment(),
    ...fields,
  } as Repository;
}
