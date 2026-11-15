// Catalog entities from the platform Organization and Service objects (ADR
// 0111). An Organization is a System, a Service is a Component of it. Kinds
// differ, so a Service and an Organization of the same name cannot collide;
// Service names are cluster-unique DNS labels (the XRD), so Component names
// cannot collide either. Names Backstage would reject are skipped.
import { OPERATORS_GROUP } from "./policy.js";

const NAME = /^[a-zA-Z0-9]([-_.a-zA-Z0-9]{0,61}[a-zA-Z0-9])?$/;
const API = "backstage.io/v1alpha1";

function valid(object) {
  return NAME.test(object?.metadata?.name ?? "");
}

function component(service, systems) {
  const name = service.metadata.name;
  const organization = service.spec?.organization;
  return {
    apiVersion: API,
    kind: "Component",
    metadata: {
      name,
      annotations: {
        "backstage.io/kubernetes-label-selector": `app.kubernetes.io/part-of=${name}`,
        "argocd/app-selector": `platform.kore.dev/service=${name}`,
      },
    },
    spec: {
      type: "service",
      lifecycle: "production",
      owner: OPERATORS_GROUP,
      ...(systems.has(organization) ? { system: organization } : {}),
    },
  };
}

export function entitiesFor({ organizations, services }) {
  const orgs = organizations.filter(valid);
  const systems = new Set(orgs.map((o) => o.metadata.name));
  return [
    {
      apiVersion: API,
      kind: "Group",
      metadata: { name: OPERATORS_GROUP.split("/")[1] },
      spec: { type: "team", children: [] },
    },
    ...orgs.map((o) => ({
      apiVersion: API,
      kind: "System",
      metadata: { name: o.metadata.name },
      spec: { owner: OPERATORS_GROUP },
    })),
    ...services.filter(valid).map((s) => component(s, systems)),
  ];
}
