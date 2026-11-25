// Docs: docs/decisions/0155-retained-databases-are-backed-up-by-a-scheduled-age-encrypted-dump-and-restored-only-from-the-controller.md
// The controller's backup commands. prune deletes past-retention backups behind a
// terminal consent; policy prints the job's write-only policy, read only.
import {
  backupJobPolicy,
  pruneBackups,
  s3ObjectAdmin,
} from "../cluster/index.js";
import { terminalConfirm } from "../resolver/index.js";
import { mutateAction } from "./context.js";
import type { CommandContext } from "./context.js";
import { print } from "./output.js";

export async function backupCommand(context: CommandContext): Promise<number> {
  const { repository, json } = context;
  const declared = repository.environment.backup;
  if (declared === undefined) {
    throw new Error(
      `no backup.target is declared for ${repository.environment.name}; declare it in the overlay (ADR 0155)`,
    );
  }
  if (context.action === "policy") {
    print(
      backupJobPolicy(declared.target.bucket, repository.environment.name),
      json,
    );
    return 0;
  }
  return await mutateAction(context, {
    prune: async (_context, runner) => {
      print(
        await pruneBackups(repository, {
          runner,
          admin: (credentials) =>
            s3ObjectAdmin({ target: declared.target, credentials }),
          confirm: terminalConfirm(Boolean(process.stdin.isTTY)),
          // A Kubernetes job or pod sets this variable; the prune never runs there.
          inCluster: process.env["KUBERNETES_SERVICE_HOST"] !== undefined,
        }),
        json,
      );
    },
  });
}
