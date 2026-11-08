import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { promisify } from "node:util";
import { test } from "vitest";
import { loadRepository } from "../config/index.js";
import {
  classifySmokeLogs,
  dockerRunArgs,
  smokeTargets,
} from "./container-smoke.js";
import { renderChart, yamlDocuments } from "./upstream-support.js";

const run = promisify(execFile);
const uptimeMs = 5_000;

// Opt-in: it needs docker and pulls images. Run with
// `npm run test:container-smoke` when adding or changing a kore-owned chart.
test.runIf(process.env["KORE_CHECK_CONTAINER_SMOKE"] === "1")(
  "every container in a kore-owned local chart stays up and logs no bind or fatal error",
  async () => {
    const repository = await loadRepository("local");
    const charts = repository.catalog.components!.filter(
      (component) => component.kind === "local-chart",
    );
    const failures: string[] = [];
    for (const component of charts) {
      const targets = smokeTargets(
        await yamlDocuments(await renderChart(repository, component)),
      );
      for (const target of targets) {
        const label = `${component.name}/${target.container}`;
        if (target.skip) {
          console.log(`container smoke: skipped ${label}: ${target.skip}`);
          continue;
        }
        const name = `kore-smoke-${process.pid}-${component.name}-${target.container}`;
        try {
          await run("docker", dockerRunArgs(target, name));
          await sleep(uptimeMs);
          const { stdout: running } = await run("docker", [
            "inspect",
            "--format",
            "{{.State.Running}}",
            name,
          ]).catch(() => ({ stdout: "false" }));
          const logs = await run("docker", ["logs", name]).then(
            ({ stdout, stderr }) => `${stdout}\n${stderr}`,
            () => "",
          );
          if (running.trim() !== "true") {
            failures.push(`${label}: exited before ${uptimeMs}ms`);
          }
          failures.push(
            ...classifySmokeLogs(logs).map((problem) => `${label}: ${problem}`),
          );
        } finally {
          await run("docker", ["rm", "-f", name]).catch(() => undefined);
        }
      }
    }
    assert.deepEqual(failures, []);
  },
  600_000,
);
