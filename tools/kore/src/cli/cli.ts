#!/usr/bin/env node
// Docs: infra/plans/2-implementation.md#public-command-surface
import { appDown, appStatus, appUp } from "../app/index.js";
import {
  clusterDestroy,
  clusterStatus,
  clusterStop,
  clusterUp,
} from "../cluster/index.js";
import { loadRepository, orderedComponents } from "../config/index.js";
import { doctor, doctorFailed } from "../diagnostics/index.js";
import {
  boolFlag,
  parseArgs,
  requireEnvironment,
  stringFlag,
} from "./flags.js";
import {
  readJournal,
  summarizeOperations,
  withEnvironmentLock,
  withJournal,
} from "../runtime/index.js";
import type { Runner } from "../runtime/index.js";
import {
  bootstrapControllers,
  platformDestroy,
  platformRender,
  platformStatus,
  platformStop,
  platformUp,
} from "../platform/index.js";
import { ProcessRunner } from "../runtime/index.js";
import { syncLocalSecrets, installLocalTrust } from "../security/index.js";
import {
  startLocalTunnel,
  stopLocalTunnel,
  tunnelStatus,
} from "../tunnel/index.js";
import { validatePortability } from "../diagnostics/index.js";
import { localDown, localUp } from "../local/index.js";

const usage = `Kore local platform orchestration

Usage:
  kore doctor [--environment local] [--json]
  kore validate [--environment local] [--json]
  kore cluster up|stop|destroy --environment <name> [--yes] [--purge-data]
  kore cluster status [--environment <name>] [--json]
  kore platform bootstrap|up|stop|destroy --environment <name> [--yes] [--purge-data]
  kore platform status|render [--environment <name>] [--output <directory>] [--json]
  kore app up|down <name> --environment <name>
  kore app status <name> [--environment <name>] [--json]
  kore local up|down --environment local [--prune [--purge-data]]
  kore tunnel start|stop --environment local
  kore tunnel status [--environment local] [--json]
  kore secrets sync --environment local
  kore trust install --environment local
  kore journal [--environment <name>] [--limit <n>] [--json]

Every mutation requires --environment and is recorded in
.kore/state/journal/<environment>.jsonl. Status, doctor, validate, render, and
journal are read-only and default to local.`;

/** The actions of each command that mutate an environment. */
const MUTATIONS: Partial<Record<string, readonly string[]>> = {
  cluster: ["up", "stop", "destroy"],
  platform: ["bootstrap", "up", "stop", "destroy"],
  app: ["up", "down"],
  local: ["up", "down"],
  tunnel: ["start", "stop"],
  secrets: ["sync"],
  trust: ["install"],
};

function print(value: unknown, json: boolean): void {
  if (json) {
    process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
  } else if (Array.isArray(value)) {
    for (const item of value) {
      console.log(
        typeof item === "object"
          ? Object.values(item as Record<string, unknown>).join("\t")
          : String(item),
      );
    }
  } else if (typeof value === "object") {
    for (const [key, item] of Object.entries(
      value as Record<string, unknown>,
    )) {
      console.log(
        `${key}: ${typeof item === "string" ? item : JSON.stringify(item)}`,
      );
    }
  } else {
    console.log(String(value));
  }
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  const command = argv[0],
    action = argv[1];
  if (!command || command === "help" || command === "--help") {
    console.log(usage);
    return 0;
  }
  const offset = ["doctor", "validate", "journal"].includes(command) ? 1 : 2;
  const parsed = parseArgs(argv.slice(offset));
  const mutations = MUTATIONS[command];
  // Every secrets and trust action mutates, so each one needs --environment.
  const mutating =
    mutations !== undefined &&
    (mutations.includes(action ?? "") ||
      command === "secrets" ||
      command === "trust");
  const environmentName = mutating
    ? requireEnvironment(parsed)
    : (stringFlag(parsed, "environment") ?? "local");
  const repository = await loadRepository(environmentName);
  const runner = new ProcessRunner();
  const json = boolFlag(parsed, "json");
  const mutate = async (
    label: string,
    work: (runner: Runner) => Promise<number>,
  ): Promise<number> => {
    // Reject an unknown action before the lock, so it never reaches the journal.
    if (!mutations?.includes(action ?? "")) {
      throw new Error(`unknown ${command} action: ${action ?? ""}`);
    }
    return await withEnvironmentLock(
      repository.root,
      environmentName,
      async () =>
        await withJournal(
          {
            root: repository.root,
            environment: environmentName,
            command: label,
            context: repository.environment.kubeContext,
          },
          runner,
          work,
        ),
    );
  };
  if (command === "validate") {
    const order = orderedComponents(repository.catalog).map(
      (component) => component.name,
    );
    const portability = await validatePortability(repository);
    print(
      {
        environment: repository.environment.name,
        components: order.length,
        order,
        applications: portability.applications,
        status: "valid",
      },
      json,
    );
    return 0;
  }
  if (command === "doctor") {
    const checks = await doctor(repository, runner);
    print(checks, json);
    return doctorFailed(checks) ? 1 : 0;
  }
  if (command === "journal") {
    const limitText = stringFlag(parsed, "limit");
    const limit = limitText === undefined ? 20 : Number(limitText);
    if (!Number.isInteger(limit) || limit < 1) {
      throw new Error("--limit must be a positive integer");
    }
    const operations = summarizeOperations(
      await readJournal(repository.root, environmentName),
    );
    const recent = operations.slice(-limit);
    const interrupted = recent.filter(
      (operation) => operation.outcome === "interrupted",
    ).length;
    if (json) {
      print(
        { environment: environmentName, operations: recent, interrupted },
        true,
      );
    } else {
      for (const operation of recent) {
        console.log(
          [
            operation.ts,
            operation.outcome === "interrupted"
              ? "INTERRUPTED"
              : operation.outcome,
            operation.command,
            operation.error ?? "",
          ].join("\t"),
        );
      }
      if (interrupted > 0) {
        console.log(
          `${interrupted} interrupted operation(s): rerun the command, it is idempotent.`,
        );
      }
    }
    return 0;
  }
  if (command === "cluster") {
    if (action === "status") {
      print(await clusterStatus(repository, runner), json);
      return 0;
    }
    return await mutate(`cluster ${action}`, async (runner) => {
      if (action === "up") {
        await clusterUp(repository, runner);
      } else if (action === "stop") {
        await clusterStop(repository, runner);
      } else if (action === "destroy") {
        await clusterDestroy(repository, runner, {
          yes: boolFlag(parsed, "yes"),
          purgeData: boolFlag(parsed, "purge-data"),
        });
      }
      return 0;
    });
  }
  if (command === "platform") {
    if (action === "status") {
      print(await platformStatus(repository, runner), json);
      return 0;
    }
    if (action === "render") {
      await platformRender(repository, runner, stringFlag(parsed, "output"));
      print(
        {
          status: "valid",
          output: stringFlag(parsed, "output") ?? "stdout discarded",
        },
        json,
      );
      return 0;
    }
    return await mutate(`platform ${action}`, async (runner) => {
      if (action === "bootstrap") {
        await bootstrapControllers(repository, runner);
      } else if (action === "up") {
        await platformUp(repository, runner);
      } else if (action === "stop") {
        await platformStop(repository, runner);
      } else if (action === "destroy") {
        await platformDestroy(repository, runner, {
          yes: boolFlag(parsed, "yes"),
          purgeData: boolFlag(parsed, "purge-data"),
        });
      }
      return 0;
    });
  }
  if (command === "app") {
    const name = parsed.positional[0];
    if (!name) {
      throw new Error("application name is required");
    }
    if (action === "status") {
      print(await appStatus(repository, runner, name), json);
      return 0;
    }
    return await mutate(`app ${action} ${name}`, async (runner) => {
      if (action === "up") {
        await appUp(repository, runner, name);
      } else if (action === "down") {
        await appDown(repository, runner, name);
      }
      return 0;
    });
  }
  if (command === "local") {
    return await mutate(`local ${action}`, async (runner) => {
      if (action === "up") {
        await localUp(repository, runner);
      } else if (action === "down") {
        await localDown(repository, runner, {
          prune: boolFlag(parsed, "prune"),
          purgeData: boolFlag(parsed, "purge-data"),
        });
      }
      return 0;
    });
  }
  if (command === "tunnel") {
    if (action === "status") {
      print(await tunnelStatus(repository), json);
      return 0;
    }
    return await mutate(`tunnel ${action}`, async (runner) => {
      if (action === "start") {
        print(await startLocalTunnel(repository, runner), json);
      } else if (action === "stop") {
        await stopLocalTunnel(repository, runner);
        print({ status: "stopped" }, json);
      }
      return 0;
    });
  }
  if (command === "secrets") {
    return await mutate(`secrets ${action}`, async (runner) => {
      const count = await syncLocalSecrets(repository, runner);
      print({ status: "synced", files: count }, json);
      return 0;
    });
  }
  if (command === "trust") {
    return await mutate(`trust ${action}`, async (runner) => {
      await installLocalTrust(repository, runner);
      print(
        { status: "installed", issuer: repository.environment.gateway.name },
        json,
      );
      return 0;
    });
  }
  throw new Error(`unknown command: ${command}\n\n${usage}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error(
        `error: ${error instanceof Error ? error.message : String(error)}`,
      );
      process.exitCode = 1;
    });
}
