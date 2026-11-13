import type { Repository } from "../config/index.js";
import { withEnvironmentLock, withJournal } from "../runtime/index.js";
import type { Runner } from "../runtime/index.js";
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

export function createMutate(scope: MutationScope): Mutate {
  const { command, action, mutations, repository, runner } = scope;
  const environment = scope.environmentName;
  return async (label, work) => {
    // Reject an unknown action before the lock, so it never reaches the journal.
    if (!mutations.includes(action ?? "")) {
      throw new Error(`unknown ${command} action: ${action ?? ""}`);
    }
    return await withEnvironmentLock(
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
    );
  };
}
