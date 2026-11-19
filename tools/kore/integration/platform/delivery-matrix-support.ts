import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  findRoot,
  type Component,
  type Repository,
} from "../../src/config/index.js";
import {
  admitted,
  appProject,
  renderDelivery,
  withFlags,
} from "../platform-config-delivery-project-support.js";
import {
  namespacedKinds,
  renderedResources,
  resourcesOf,
  type Resource,
} from "../platform-config-delivery-resources-support.js";

const run = promisify(execFile);

/** The flags whose components kore hands to Argo CD only while they are on. */
export const matrixFlags = [
  "platform-dns",
  "platform-shared-gateway",
  "platform-hostname-ownership",
] as const;

/** The local repository with every flag off but `on`, Argo CD delivery staying on. */
export async function withOnly(on: string | undefined): Promise<Repository> {
  const off = await withFlags(false);
  return {
    ...off,
    environment: {
      ...off.environment,
      features: {
        ...off.environment.features,
        ...(on === undefined ? {} : { [on]: true }),
      },
    },
  };
}

function componentOf(repository: Repository, name: string): Component {
  const component = repository.catalog.components.find((c) => c.name === name);
  if (component === undefined) {
    throw new Error(`${name} is not in the component catalog`);
  }
  return component;
}

/** What Argo CD is told to render for one release: its merged values and the parameters laid over them. */
export interface DeliveredApplication {
  name: string;
  values: unknown;
  parameters: Record<string, string>;
}

/** Reads each Application the delivery chart rendered, as Argo CD reads it. */
export function deliveredApplications(docs: string[]): DeliveredApplication[] {
  return docs
    .filter((doc) => /^kind: Application$/m.test(doc))
    .map((doc) => {
      const values = /^ {6}valuesObject: (.+)$/m.exec(doc)?.[1];
      return {
        name: /^ {2}name: (.+)$/m.exec(doc)![1]!,
        values: values === undefined ? {} : JSON.parse(values),
        parameters: Object.fromEntries(
          [...doc.matchAll(/- name: "(.+)"\n\s+value: "(.*)"/g)].map((m) => [
            m[1]!,
            m[2]!,
          ]),
        ),
      };
    });
}

export interface Delivered {
  resources: Resource[];
  /** The rendered manifests; empty for a plain manifest directory. */
  text: string;
}

/**
 * Renders a delivered release from the repository the way its Application tells
 * Argo CD to: the chart with the Application's values, the Application's
 * parameters over them, and nothing else, so a value the Application does not
 * carry is a value the render lacks.
 */
export async function renderDelivered(
  repository: Repository,
  application: DeliveredApplication,
): Promise<Delivered> {
  const component = componentOf(repository, application.name);
  if (!component.chart) {
    return {
      resources: await renderedResources(repository, application.name),
      text: "",
    };
  }
  const file = join(
    await mkdtemp(join(tmpdir(), "kore-delivery-matrix-")),
    "values.json",
  );
  await writeFile(file, JSON.stringify(application.values));
  const { stdout } = await run("helm", [
    "template",
    application.name,
    join(await findRoot(), component.chart),
    "--namespace",
    component.namespace,
    "--values",
    file,
    ...Object.entries(application.parameters).flatMap(([key, value]) => [
      "--set-string",
      `${key}=${value}`,
    ]),
  ]);
  return { resources: resourcesOf(stdout), text: stdout };
}

/** Every kind or namespace a delivered release renders that the AppProject does not admit. */
export async function unadmitted(repository: Repository): Promise<string[]> {
  const { docs } = await renderDelivery(repository);
  const { clusterKinds, destinations } = admitted(appProject(docs));
  const refused: string[] = [];
  for (const application of deliveredApplications(docs)) {
    const component = componentOf(repository, application.name);
    const { resources } = await renderDelivered(repository, application);
    if (resources.length === 0) {
      refused.push(`${application.name}: renders nothing`);
    }
    for (const resource of resources) {
      const kind = `${resource.group}/${resource.kind}`;
      const space = resource.namespace ?? component.namespace;
      if (!namespacedKinds.has(kind) && !clusterKinds.includes(kind)) {
        refused.push(`${application.name}: ${kind} is not whitelisted`);
      } else if (namespacedKinds.has(kind) && !destinations.includes(space)) {
        refused.push(
          `${application.name}: ${kind} in ${space} is not a destination`,
        );
      }
    }
  }
  return refused;
}
