import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { test } from "vitest";
import {
  checkCrdOwnership,
  loadRepository,
  renderedCrdNames,
  type CrdOwnership,
} from "../config/index.js";
import {
  envOption,
  helmEnv,
  helmTemplateArgs,
  withAbsoluteChart,
} from "./helm.js";

const run = promisify(execFile);

// Crossplane's chart renders no CRDs: its init container installs the
// CompositeResourceDefinition CRD at startup. The catalog still owns it, and
// kore waits for it to be Established.
const installedByController: Record<string, string[]> = {
  crossplane: ["compositeresourcedefinitions.apiextensions.crossplane.io"],
};

// Opt-in: it pulls every pinned chart, and fast tests run offline
// (AGENTS.md). Run with `npm run test:upstream-charts` when bumping a chart.
test.runIf(process.env["KORE_CHECK_UPSTREAM_CHARTS"] === "1")(
  "every CRD a pinned helm chart installs is declared by exactly one catalog owner",
  async () => {
    const repository = await loadRepository("local");
    const helm = repository.catalog.components!.filter(
      (component) => component.kind === "helm",
    );
    const owned: CrdOwnership[] = await Promise.all(
      helm.map(async (component) => {
        const { stdout } = await run(
          "helm",
          withAbsoluteChart(
            repository,
            component,
            helmTemplateArgs(repository, component),
          ),
          {
            maxBuffer: 256 * 1024 * 1024,
            ...envOption(helmEnv(repository, component)),
          },
        );
        return {
          name: component.name,
          rendered: [
            ...renderedCrdNames(stdout),
            ...(installedByController[component.name] ?? []),
          ],
          declared: component.ownsCRDs,
        };
      }),
    );
    // Manifest and local-chart owners are checked offline; they only
    // contribute declarations that a helm chart must not also install.
    const others = repository.catalog
      .components!.filter((component) => component.kind !== "helm")
      .map((c) => ({
        name: c.name,
        rendered: c.ownsCRDs,
        declared: c.ownsCRDs,
      }));
    assert.deepEqual(checkCrdOwnership([...owned, ...others]), []);
  },
  300_000,
);
