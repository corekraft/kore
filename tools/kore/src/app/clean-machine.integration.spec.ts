import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { findRoot } from "../config/config.js";
import { loadRepository } from "../config/index.js";
import { assertReferenceSmoke } from "../platform/platform.reference-smoke.integration.spec.js";
import { ProcessRunner } from "../runtime/index.js";
import {
  assertThrowawayProfile,
  cleanMachineProfile,
  stageThrowawayCheckout,
} from "./clean-machine.js";

// Docs: infra/plans/2-implementation.md#step-13-complete-lifecycle-orchestration
// Live and doubly opt-in (`npm run test:integration:clean-machine`): it needs
// KORE_RUN_INTEGRATION=1 (set by the script) and KORE_RUN_CLEAN_MACHINE=1,
// because it builds a complete platform in a Minikube profile of its own
// (kore-clean-machine) and deletes that profile at the end. It never touches
// kore-local: it runs the documented kore commands from a staged copy of the
// tracked files (KORE_ROOT), whose local environment names the throwaway
// profile and context, so the journal, locks and .kore/state of the real
// checkout stay untouched. It reads no Secret value.
//
// The throwaway platform binds the same host ports as kore-local's tunnel
// (registry 30500, gateway 8443), so run it with kore-local stopped or its
// tunnel down.

const environment = "local";
const cli = fileURLToPath(new URL("../cli/cli.js", import.meta.url));

test(
  "a clean machine reaches a verified reference application and is destroyed",
  {
    concurrency: false,
    timeout: 90 * 60 * 1000,
    skip:
      process.env.KORE_RUN_INTEGRATION !== "1" ||
      process.env.KORE_RUN_CLEAN_MACHINE !== "1"
        ? "set KORE_RUN_INTEGRATION=1 and KORE_RUN_CLEAN_MACHINE=1 to create and destroy the throwaway profile kore-clean-machine"
        : false,
  },
  async (t) => {
    assertThrowawayProfile(cleanMachineProfile);
    const runner = new ProcessRunner();
    const staged = join(
      await mkdtemp(join(tmpdir(), "kore-clean-machine-")),
      "checkout",
    );
    t.after(async () => {
      // Delete only the throwaway profile, whatever happened above.
      await runner
        .run("minikube", ["delete", "--profile", cleanMachineProfile], {
          capture: true,
        })
        .catch(() => undefined);
      await rm(join(staged, ".."), { recursive: true, force: true });
    });
    await stageThrowawayCheckout(
      await findRoot(),
      staged,
      cleanMachineProfile,
      runner,
    );

    const kore = async (...args: string[]): Promise<string> =>
      (
        await runner.run("node", [cli, ...args, "--environment", environment], {
          capture: true,
          cwd: staged,
          env: { ...process.env, KORE_ROOT: staged },
        })
      ).stdout;

    const repository = await loadRepository(environment, staged);
    assert.equal(repository.environment.cluster.profile, cleanMachineProfile);
    assert.equal(repository.environment.kubeContext, cleanMachineProfile);

    await kore("doctor");
    await kore("validate");
    await kore("local", "up");

    const platform = await kore("platform", "status", "--json");
    assert.doesNotMatch(
      platform,
      /"status": "(missing|degraded)"/,
      "every platform component is ready and the gate is open",
    );

    const app = await kore("app", "status", "reference", "--json");
    for (const field of [
      '"digest"',
      '"signer"',
      '"registry"',
      '"namespaceImageEnforcement": "enrolled"',
      '"matchesLock": true',
    ]) {
      assert.ok(app.includes(field), `app status reports ${field}`);
    }

    await assertReferenceSmoke(repository, runner);

    // Idempotency: a second up on the converged platform succeeds.
    await kore("local", "up");

    // Destroy through kore, with the data it would retain explicitly purged
    // (the throwaway profile holds nothing worth exporting).
    await kore("local", "down", "--prune", "--purge-data");
    const profiles = (
      await runner.run("minikube", ["profile", "list", "--output", "json"], {
        capture: true,
      })
    ).stdout;
    assert.ok(
      !profiles.includes(`"Name":"${cleanMachineProfile}"`),
      "the throwaway profile is gone",
    );
  },
);
