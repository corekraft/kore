// Helpers for the opt-in upstream-chart specs; they need helm and yq.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { absolute, type Component, type Repository } from "../config/index.js";
import {
  envOption,
  helmEnv,
  helmTemplateArgs,
  withAbsoluteChart,
} from "./helm.js";

const run = promisify(execFile);
const maxBuffer = 256 * 1024 * 1024;

const schedulingKeys = [
  "affinity",
  "strategy",
  "deploymentStrategy",
  "updateStrategy",
];

function withoutScheduling(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(withoutScheduling);
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !schedulingKeys.includes(key))
        .map(([key, child]) => [key, withoutScheduling(child)]),
    );
  }
  return value;
}

/**
 * Renders a chart as kore does, with the environment's values. With
 * `beforeSchedulingOverrides` the environment's values lose their scheduling
 * keys (affinity and rollout strategy), which renders the release that was
 * running before those overrides: the one a later overlay upgrades.
 */
export async function renderChart(
  repository: Repository,
  component: Component,
  beforeSchedulingOverrides = false,
): Promise<string> {
  if (beforeSchedulingOverrides) {
    const directory = await mkdtemp(join(tmpdir(), "kore-baseline-"));
    try {
      const overlays = repository.environment.componentValues?.[component.name];
      const stripped = await Promise.all(
        (overlays ?? []).map(async (overlay, index) => {
          const [parsed] = await yamlDocuments(
            await readFile(absolute(repository, overlay), "utf8"),
          );
          const path = join(directory, `${index}.json`);
          await writeFile(path, JSON.stringify(withoutScheduling(parsed)));
          return path;
        }),
      );
      return await renderChart(
        {
          ...repository,
          environment: {
            ...repository.environment,
            componentValues: {
              ...repository.environment.componentValues,
              [component.name]: stripped,
            },
          },
        },
        component,
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
  const { stdout } = await run(
    "helm",
    withAbsoluteChart(
      repository,
      component,
      helmTemplateArgs(repository, component),
    ),
    { maxBuffer, ...envOption(helmEnv(repository, component)) },
  );
  return stdout;
}

/** Parses multi-document YAML with the pinned yq: one JSON document per line. */
export async function yamlDocuments(yaml: string): Promise<unknown[]> {
  const json = await new Promise<string>((resolve, reject) => {
    const child = execFile(
      "yq",
      ["-o=json", "-I=0", "."],
      { maxBuffer },
      (error, out) => (error ? reject(error) : resolve(out)),
    );
    child.stdin!.end(yaml);
  });
  return json
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as unknown);
}
