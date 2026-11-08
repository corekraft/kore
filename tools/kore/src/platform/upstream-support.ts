// Helpers for the opt-in upstream-chart specs; they need helm and yq.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Component, Repository } from "../config/index.js";
import { helmTemplateArgs, withAbsoluteChart } from "./helm.js";

const run = promisify(execFile);
const maxBuffer = 256 * 1024 * 1024;

/** Renders a chart as kore does, with the environment's values. */
export async function renderChart(
  repository: Repository,
  component: Component,
): Promise<string> {
  const { stdout } = await run(
    "helm",
    withAbsoluteChart(
      repository,
      component,
      helmTemplateArgs(repository, component),
    ),
    { maxBuffer },
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
