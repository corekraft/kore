import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  findRoot,
  loadRepository,
  platformArgocdDeliveryFlag,
  type Component,
  type Repository,
} from "../../src/config/index.js";
import { withFlags } from "../platform-config-delivery-project-support.js";
import {
  renderedResources,
  resourcesOf,
  type Resource,
} from "../platform-config-delivery-resources-support.js";

const run = promisify(execFile);

/** The Next proof flags a live run turns on beside platform-argocd-delivery. */
export const proofFlags = [
  "platform-dns",
  "platform-shared-gateway",
  "platform-hostname-ownership",
  "platform-portal",
] as const;

/** One set of flags to render under: local as it is, or every flag off, plus the flags turned on. */
export interface FlagSet {
  label: string;
  base: "local" | "off";
  flags: readonly string[];
}

export const flagSets: readonly FlagSet[] = [
  { label: "every flag off", base: "off", flags: [] },
  { label: "local as it is", base: "local", flags: [] },
  ...proofFlags.map((flag): FlagSet => ({
    label: `${flag} on`,
    base: "local",
    flags: [flag],
  })),
  { label: "all proof flags together", base: "local", flags: proofFlags },
];

/** The local repository under a flag set, Argo CD delivery on. */
export async function repositoryFor(set: FlagSet): Promise<Repository> {
  const base =
    set.base === "off" ? await withFlags(false) : await loadRepository("local");
  return {
    ...base,
    environment: {
      ...base.environment,
      features: {
        ...base.environment.features,
        [platformArgocdDeliveryFlag]: true,
        ...Object.fromEntries(set.flags.map((flag) => [flag, true])),
      },
    },
  };
}

export function componentOf(repository: Repository, name: string): Component {
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

/** What an error says: a failed process's stderr, else its message, on one line. */
export function message(error: unknown): string {
  const stderr = (error as { stderr?: unknown }).stderr;
  let text = error instanceof Error ? error.message : String(error);
  if (typeof stderr === "string" && stderr.trim() !== "") {
    text = stderr;
  }
  return text.trim().replaceAll(/\s*\n\s*/g, " ");
}
