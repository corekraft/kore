import { createHash } from "node:crypto";
import { flowMetricNames } from "../flow/index.js";
import {
  RETRO_EFFORT,
  RETRO_MODEL,
  RetroFiling,
  RetroFilingCli,
  RetroLaunch,
  retroFlagOn,
  type FilingResult,
  type HarnessCli,
} from "../orchestrator/index.js";
import type { CliDeps } from "../runtime/index.js";

const HASH_LENGTH = 8;

const noun = (n: number) => `${n} idea${n === 1 ? "" : "s"}`;

function said(name: string, result: FilingResult): string {
  if (result.status === "flag-off") {
    return `Retro ${name} filed nothing: the automatic-retro flag is off.\n`;
  }
  if (result.status === "refused") {
    return `Retro ${name} filed nothing: ${result.error}\n`;
  }
  return `Retro ${name} filed ${noun(result.filed)} (${result.existing} already filed, ${result.dropped} dropped by the cap).\n`;
}

/**
 * The between-work hook of `orchestrate tick --idea <n> --loop` with the tick flag off: starts a retro when one is due,
 * then collects its pane and files the proposals through the idea domain. A
 * refused batch is reported on stderr and never fails the run.
 */
export function retroHook(
  deps: CliDeps,
  root: string,
  harness: HarnessCli,
): () => Promise<void> {
  const launch = new RetroLaunch({
    flagOn: () => retroFlagOn(deps.fs, root),
    due: () => harness.retroDue(),
    record: (reason) => harness.retroRecord(reason),
    spawn: (pane) => harness.spawnRetro(pane),
  });
  const cli = new RetroFilingCli(deps.runner, root, () =>
    deps.clock.now().toISOString(),
  );
  const filing = new RetroFiling({
    flagOn: () => retroFlagOn(deps.fs, root),
    metricNames: () => Promise.resolve(flowMetricNames()),
    hash: (text) =>
      createHash("sha256").update(text).digest("hex").slice(0, HASH_LENGTH),
    file: (slug, proposal) => cli.file(slug, proposal),
    recordFiled: (number, key) => cli.recordFiled(number, key),
    recordDropped: (trigger, count) => cli.recordDropped(trigger, count),
  });
  return async () => {
    const started = await launch.run();
    if (started.status !== "launched") {
      return;
    }
    deps.stderr(
      `Started retro pane ${started.name} (${started.reason}) on ${RETRO_MODEL} at ${RETRO_EFFORT} effort.\n`,
    );
    const pane = await harness.collect(started.name);
    await harness.close(started.name);
    if (pane.outcome !== "done") {
      deps.stderr(
        `Retro pane ${started.name} ended blocked; nothing was filed.\n`,
      );
      return;
    }
    deps.stderr(said(started.name, await filing.run(started.name, pane.text)));
  };
}
