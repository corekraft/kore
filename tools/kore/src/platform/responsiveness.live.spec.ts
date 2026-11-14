import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import test from "node:test";
import { loadRepository } from "../config/index.js";
import { ProcessRunner, liveEnvironment } from "../runtime/index.js";
import {
  ResponsivenessProbe,
  evaluateResponsiveness,
  formatResponsivenessTable,
  type ResponsivenessSample,
} from "./responsiveness.js";

// Docs: infra/plans/14-test-tiers.md (#405)
// Live: needs a converged local k3d platform. Read-only on the cluster
// (`kubectl get --raw /readyz`); it runs the unit suite beside it at the
// shipped worker default (two; KORE_TEST_WORKERS is removed from the child's
// environment) and polls the API once a second. Fails if the API ever fails or
// the readyz p95 exceeds 2 s, and prints the table either way.
// Run with KORE_RUN_LIVE=1 (`npm run test:live:responsiveness`).

const live = {
  concurrency: false,
  skip:
    process.env.KORE_RUN_LIVE !== "1"
      ? "set KORE_RUN_LIVE=1 to opt into a live platform"
      : false,
  timeout: 30 * 60 * 1000,
};

test(
  "keeps the cluster API responsive while the unit suite runs at the default worker count",
  live,
  async () => {
    const repository = await loadRepository(liveEnvironment());
    const probe = new ResponsivenessProbe(
      new ProcessRunner(),
      repository.environment.kubeContext,
      { now: () => performance.now() },
    );
    const { KORE_TEST_WORKERS: _ignored, ...env } = process.env;
    const suite = spawn("npx", ["vitest", "run"], {
      env,
      stdio: ["ignore", "inherit", "inherit"],
    });
    let running = true;
    const exit = new Promise<number | null>((resolve) => {
      suite.on("close", (code) => {
        running = false;
        resolve(code);
      });
      suite.on("error", () => {
        running = false;
        resolve(null);
      });
    });

    const samples: ResponsivenessSample[] = [];
    const began = performance.now();
    while (running) {
      const second = Math.round((performance.now() - began) / 1000);
      samples.push(await probe.probe(second));
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    const code = await exit;

    const verdict = evaluateResponsiveness(samples);
    console.log(formatResponsivenessTable(samples, verdict));
    assert.equal(code, 0, "the unit suite itself failed; see its output above");
    assert.ok(verdict.pass, verdict.reasons.join("; "));
  },
);
