import { gatewayClassName, type Repository } from "../../src/config/index.js";
import { localPlatform } from "../local-platform-support.js";
import {
  admitted,
  appProject,
  argocdOwned,
  renderDelivery,
} from "../platform-config-delivery-project-support.js";
import { namespacedKinds } from "../platform-config-delivery-resources-support.js";
import {
  componentOf,
  deliveredApplications,
  message,
  renderDelivered,
  type FlagSet,
} from "./delivery-matrix-support.js";

// Each check returns the problems it found, every one naming the flag set, the
// chart and the resource, and the fix, so a red run says where to look.

const platform = await localPlatform();

/** The delivery chart's schema accepts every enabled component, and delivers exactly those. */
export async function schemaProblems(
  set: FlagSet,
  repository: Repository,
): Promise<string[]> {
  try {
    const { applications } = await renderDelivery(repository);
    const wanted = argocdOwned(repository);
    return [
      ...wanted
        .filter((name) => !applications.includes(name))
        .map(
          (name) =>
            `[${set.label}] kore-config-delivery renders no Application for ${name}; fix: hand it over in platform-config-delivery's templates`,
        ),
      ...applications
        .filter((name) => !wanted.includes(name))
        .map(
          (name) =>
            `[${set.label}] kore-config-delivery renders an Application for ${name}, which this flag set does not hand over`,
        ),
    ];
  } catch (error) {
    return [
      `[${set.label}] kore-config-delivery refused the composed values: ${message(error)}; fix: allow the component in infra/charts/platform-config-delivery/values.schema.json`,
    ];
  }
}

/** Every kind and namespace a delivered chart renders is admitted by the AppProject. */
export async function unadmitted(
  set: FlagSet,
  repository: Repository,
): Promise<string[]> {
  const { docs } = await renderDelivery(repository);
  const { clusterKinds, destinations } = admitted(appProject(docs));
  const refused: string[] = [];
  for (const application of deliveredApplications(docs)) {
    const component = componentOf(repository, application.name);
    const { resources } = await renderDelivered(repository, application);
    if (resources.length === 0) {
      refused.push(`[${set.label}] ${application.name} renders nothing`);
    }
    for (const resource of resources) {
      const kind = `${resource.group}/${resource.kind}`;
      const space = resource.namespace ?? component.namespace;
      if (!namespacedKinds.has(kind) && !clusterKinds.includes(kind)) {
        refused.push(
          `[${set.label}] ${application.name} renders ${kind}, which the AppProject's clusterResourceWhitelist does not admit; fix: add it to infra/charts/platform-config-delivery/templates/project.yaml`,
        );
      } else if (namespacedKinds.has(kind) && !destinations.includes(space)) {
        refused.push(
          `[${set.label}] ${application.name} renders ${kind} in namespace ${space}, which is not an AppProject destination; fix: add the namespace to the namespaces of the chart lock composition`,
        );
      }
    }
  }
  return refused;
}

const unrendered = /^.*(?:<no value>|hostname: ""|hostname: '').*$/gm;

/** A value the Application hands a chart that is empty, or that a template left unrendered. */
function emptyValues(
  set: FlagSet,
  chart: string,
  text: string,
  parameters: Record<string, string>,
): string[] {
  return [
    ...Object.entries(parameters)
      .filter(([, value]) => value.trim() === "")
      .map(
        ([key]) =>
          `[${set.label}] ${chart} gets an empty ${key} from its Application; fix: derive it in kore's chart delivery values`,
      ),
    ...[...text.matchAll(unrendered)].map(
      (m) =>
        `[${set.label}] ${chart} renders an empty value (${m[0].trim()}); fix: pass the value the template requires through its Application`,
    ),
  ];
}

/** Every delivered chart renders from its Application's values and parameters alone, with the derived values non-empty. */
export async function valueProblems(
  set: FlagSet,
  repository: Repository,
): Promise<string[]> {
  const { docs } = await renderDelivery(repository);
  const problems: string[] = [];
  const wanted: Record<string, Record<string, string>> = {
    "kore-platform-config": {
      "gateway.className": gatewayClassName(repository.environment),
      "gateway.hostname": platform.domain,
      "gateway.platformHostname": `*.platform.${platform.domain}`,
    },
    "kore-local-tls": { "gateway.hostname": platform.domain },
  };
  for (const application of deliveredApplications(docs)) {
    const expected = wanted[application.name];
    if (
      expected !== undefined &&
      JSON.stringify(application.parameters) !== JSON.stringify(expected)
    ) {
      problems.push(
        `[${set.label}] ${application.name}'s Application carries ${JSON.stringify(application.parameters)}, expected ${JSON.stringify(expected)}; fix: derive them in chartDeliveryValues and pass them in applications.yaml`,
      );
    }
    try {
      const { text } = await renderDelivered(repository, application);
      problems.push(
        ...emptyValues(set, application.name, text, application.parameters),
      );
    } catch (error) {
      problems.push(
        `[${set.label}] ${application.name} does not render from its Application's values: ${message(error)}; fix: pass the value it requires through the Application's values or parameters`,
      );
    }
  }
  return problems;
}
