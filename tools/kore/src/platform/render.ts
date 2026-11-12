import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  absolute,
  orderedComponents,
  type Component,
  type Repository,
} from "../config/index.js";
import type { Runner } from "../runtime/index.js";
import { redactManifest } from "./render-redaction.js";
import {
  envOption,
  helmEnv,
  helmTemplateArgs,
  manifestSource,
  withAbsoluteChart,
} from "./helm.js";

async function validateManifest(
  repository: Repository,
  runner: Runner,
  component: Component,
): Promise<void> {
  await runner.run(
    "kubectl",
    [
      "apply",
      "--dry-run=client",
      "--validate=false",
      "--recursive",
      "--filename",
      manifestSource(repository, component),
    ],
    { capture: true, cwd: repository.root },
  );
}

async function renderChart(
  repository: Repository,
  runner: Runner,
  component: Component,
  target: string | undefined,
): Promise<void> {
  const result = await runner.run(
    "helm",
    withAbsoluteChart(
      repository,
      component,
      helmTemplateArgs(repository, component),
    ),
    {
      capture: true,
      cwd: repository.root,
      ...envOption(helmEnv(repository, component)),
    },
  );
  if (target) {
    await writeFile(
      join(target, `${component.name}.yaml`),
      redactManifest(result.stdout),
      {
        mode: 0o600,
      },
    );
  }
  await runner.run(
    "kubectl",
    ["apply", "--dry-run=client", "--validate=false", "--filename", "-"],
    { capture: true, input: result.stdout },
  );
}

export async function platformRender(
  repository: Repository,
  runner: Runner,
  outputDirectory?: string,
): Promise<void> {
  const target = outputDirectory
    ? absolute(repository, outputDirectory)
    : undefined;
  if (target) {
    await mkdir(target, { recursive: true });
  }
  for (const component of orderedComponents(repository.catalog)) {
    if (component.kind === "manifest") {
      await validateManifest(repository, runner, component);
    } else {
      await renderChart(repository, runner, component, target);
    }
  }
}
