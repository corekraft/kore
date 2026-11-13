import type { Repository } from "../config/index.js";
import { withEnvironmentLock, withJournal } from "../runtime/index.js";
import type { Runner } from "../runtime/index.js";
import { withHostLease } from "../runtime/host-lease.js";
import { hostRoot, lockScope } from "../runtime/host-locks.js";
import type { Mutate } from "./context.js";

interface MutationScope {
  command: string;
  action: string | undefined;
  mutations: readonly string[];
  environmentName: string;
  repository: Repository;
  runner: Runner;
}

/** Ten minutes: long enough for a live `kore local up` already running to finish. */
const DEFAULT_LOCK_WAIT_MS = 10 * 60 * 1000;

/** How long a mutation waits for the cluster's lock before it is refused naming the holder. */
function lockWaitMs(): number {
  return Number(process.env.KORE_LOCK_WAIT_MS ?? DEFAULT_LOCK_WAIT_MS);
}

export function createMutate(scope: MutationScope): Mutate {
  const { command, action, mutations, repository, runner } = scope;
  const environment = scope.environmentName;
  return async (label, work) => {
    // Reject an unknown action before the lock, so it never reaches the journal.
    if (!mutations.includes(action ?? "")) {
      throw new Error(`unknown ${command} action: ${action ?? ""}`);
    }
    const waitMs = lockWaitMs();
    const locked = async () =>
      await withEnvironmentLock(
        hostRoot(),
        lockScope(repository.environment),
        async () =>
          await withJournal(
            {
              root: repository.root,
              environment,
              command: label,
              context: repository.environment.kubeContext,
            },
            runner,
            work,
          ),
        { waitMs },
      );
    // A live run is exclusive on the host (the lease), then on its cluster.
    return command === "local" && action === "up"
      ? await withHostLease(locked, { waitMs })
      : await locked();
  };
}
