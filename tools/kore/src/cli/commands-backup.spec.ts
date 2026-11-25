// Docs: docs/decisions/0155-retained-databases-are-backed-up-by-a-scheduled-age-encrypted-dump-and-restored-only-from-the-controller.md
import { beforeEach, expect, test, vi } from "vitest";
import {
  backupJobPolicy,
  pruneBackups,
  s3ObjectAdmin,
} from "../cluster/index.js";
import { terminalConfirm } from "../resolver/index.js";
import { backupCommand } from "./commands-backup.js";
import type { ActionHandler } from "./context.js";
import { mutateAction } from "./context.js";
import { fakeContext, fakeRepository, sharedRunner } from "./cli-support.js";
import { print } from "./output.js";

vi.mock("../cluster/index.js");
vi.mock("../resolver/index.js");
vi.mock("./context.js");
vi.mock("./output.js");

const declared = {
  target: {
    endpoint: "https://s3.example.com",
    bucket: "backups",
    region: "eu-west-1",
    pathStyle: true,
    kind: "interim",
    credentials: { secret: "backup-write" },
  },
  retention: { daily: 14 },
  schedule: "02:00",
};
const repository = fakeRepository({
  name: "vps",
  provider: "managed",
  backup: declared,
});
const READ = { accessKeyId: "AK-READ", secretAccessKey: "SK-READ" };

/** The action table the last mutation was given. */
function actionsOf(): Record<string, ActionHandler> {
  return vi.mocked(mutateAction).mock.calls.at(-1)![1];
}

beforeEach(() => {
  vi.resetAllMocks();
  delete process.env["KUBERNETES_SERVICE_HOST"];
  vi.mocked(mutateAction).mockResolvedValue(0);
  vi.mocked(terminalConfirm).mockReturnValue(undefined);
  vi.mocked(pruneBackups).mockResolvedValue({
    status: "nothing-to-prune",
    bucket: "backups",
    deleted: [],
  });
});

test("backup prune is a mutation of the environment, and prints what the prune removed", async () => {
  const confirm = vi.fn(async () => true);
  vi.mocked(terminalConfirm).mockReturnValue(confirm);
  vi.mocked(pruneBackups).mockResolvedValue({
    status: "pruned",
    bucket: "backups",
    deleted: ["vps/golden-path/pg-main/app/2026-11-01T02-00-00Z.sql.age"],
  });
  const context = fakeContext({
    command: "backup",
    action: "prune",
    repository,
    json: true,
  });

  expect(await backupCommand(context)).toBe(0);
  expect(mutateAction).toHaveBeenCalledWith(context, expect.any(Object));
  await actionsOf().prune!(context, sharedRunner);

  expect(terminalConfirm).toHaveBeenCalledWith(Boolean(process.stdin.isTTY));
  expect(pruneBackups).toHaveBeenCalledWith(repository, {
    runner: sharedRunner,
    admin: expect.any(Function),
    confirm,
    inCluster: false,
  });
  expect(print).toHaveBeenCalledWith(
    {
      status: "pruned",
      bucket: "backups",
      deleted: ["vps/golden-path/pg-main/app/2026-11-01T02-00-00Z.sql.age"],
    },
    true,
  );
});

test("the prune's admin is built against the declared target, for whichever credential the prune passes", async () => {
  vi.mocked(s3ObjectAdmin).mockReturnValue({
    list: async () => [],
    remove: async () => undefined,
  });
  const context = fakeContext({
    command: "backup",
    action: "prune",
    repository,
  });
  await backupCommand(context);
  await actionsOf().prune!(context, sharedRunner);

  const { admin } = vi.mocked(pruneBackups).mock.calls[0]![1];
  admin(READ);
  expect(s3ObjectAdmin).toHaveBeenCalledWith({
    target: declared.target,
    credentials: READ,
  });
});

test("inside a pod the prune is told so, and refuses to run", async () => {
  process.env["KUBERNETES_SERVICE_HOST"] = "10.43.0.1";
  const context = fakeContext({
    command: "backup",
    action: "prune",
    repository,
  });
  await backupCommand(context);
  await actionsOf().prune!(context, sharedRunner);
  expect(vi.mocked(pruneBackups).mock.calls[0]![1].inCluster).toBe(true);
});

test("a backup command on an environment with no backup.target refuses before anything runs, naming the overlay fix", async () => {
  const undeclared = fakeRepository({ name: "vps", provider: "managed" });
  const context = fakeContext({
    command: "backup",
    action: "prune",
    repository: undeclared,
  });
  await expect(backupCommand(context)).rejects.toThrow(
    new Error(
      "no backup.target is declared for vps; declare backup.target in the vps overlay (ADR 0155)",
    ),
  );
  expect(mutateAction).not.toHaveBeenCalled();
  expect(pruneBackups).not.toHaveBeenCalled();
});

test("backup policy prints the job's write-only policy for the declared bucket, and mutates nothing", async () => {
  const policy = { Version: "2012-10-17", Statement: [] } as const;
  vi.mocked(backupJobPolicy).mockReturnValue(policy);
  const context = fakeContext({
    command: "backup",
    action: "policy",
    repository,
    json: true,
  });

  expect(await backupCommand(context)).toBe(0);

  expect(backupJobPolicy).toHaveBeenCalledWith("backups", "vps");
  expect(print).toHaveBeenCalledWith(policy, true);
  expect(mutateAction).not.toHaveBeenCalled();
  expect(pruneBackups).not.toHaveBeenCalled();
});
