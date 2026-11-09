import assert from "node:assert/strict";
import { describe, test } from "vitest";
import { loadRepository, orderedComponents } from "../config/index.js";
import { CommandError, type Runner, type RunResult } from "../runtime/index.js";
import { reconcileComponent } from "./reconcile.js";
import { healthyClusterOutput } from "./resilience-fixtures.js";

// Docs: docs/decisions/0004-fail-closed-application-admission-gate.md
// Offline proof that a reconciliation interrupted at any component converges on
// the next run with no manual cluster patching (Step 14, "recoverable failures
// converge"). The fake cluster fails one Helm upgrade once; the rerun must
// finish every component without uninstalling a release that was deployed.

const repository = await loadRepository("local");
const ordered = orderedComponents(repository.catalog);

/** A healthy cluster whose first Helm upgrade of one release fails transiently. */
class FlakyCluster implements Runner {
  calls: string[] = [];
  private failed = false;
  constructor(private readonly flaky: string) {}
  async run(command: string, args: readonly string[]): Promise<RunResult> {
    this.calls.push(`${command} ${args.join(" ")}`);
    if (command === "helm" && args[0] === "upgrade") {
      if (args.includes(this.flaky) && !this.failed) {
        this.failed = true;
        throw new CommandError(command, args, {
          stdout: "",
          stderr: "Error: Kubernetes cluster unreachable",
          code: 1,
        });
      }
      return { stdout: "", stderr: "", code: 0 };
    }
    if (command === "helm" && args[0] === "history") {
      return {
        stdout: JSON.stringify([{ revision: 1, status: "deployed" }]),
        stderr: "",
        code: 0,
      };
    }
    return { stdout: healthyClusterOutput(args), stderr: "", code: 0 };
  }
}

async function reconcileAll(runner: Runner): Promise<void> {
  for (const component of ordered) {
    await reconcileComponent(repository, runner, component);
  }
}

describe.each(ordered.filter(({ kind }) => kind !== "manifest"))(
  "an interruption at $name",
  (component) => {
    test("stops at the failing component and names it", async () => {
      const cluster = new FlakyCluster(component.name);

      await assert.rejects(
        reconcileAll(cluster),
        new RegExp(`component ${component.name} failed`),
      );
    });

    test("converges on the rerun without removing a deployed release", async () => {
      const cluster = new FlakyCluster(component.name);
      await assert.rejects(reconcileAll(cluster));

      await reconcileAll(cluster);

      assert.deepEqual(
        cluster.calls.filter((call) => /^helm uninstall|\bdelete\b/.test(call)),
        [],
      );
      const upgrades = cluster.calls.filter(
        (call) =>
          call.startsWith("helm upgrade") && call.includes(component.name),
      );
      assert.ok(upgrades.length >= 2, "the failed release is upgraded again");
    });
  },
);
