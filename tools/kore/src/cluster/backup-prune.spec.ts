import { beforeEach, expect, test, vi } from "vitest";
import { featureEnabled } from "../config/index.js";
import type { Repository } from "../config/index.js";
import type { Runner } from "../runtime/index.js";
import { credentialFromDocument } from "./backup-credentials.js";
import { pruneBackups, type PruneOptions } from "./backup-prune.js";
import { prunableBackups } from "./backup-retention.js";
import type { ObjectAdmin } from "./backup-s3-admin.js";
import type { S3Credentials } from "./backup-s3.js";

vi.mock("../config/index.js", () => ({ featureEnabled: vi.fn() }));
vi.mock("./backup-retention.js", () => ({
  DAILY_RETENTION: 14,
  prunableBackups: vi.fn(),
}));
vi.mock("./backup-credentials.js", () => ({
  credentialFromDocument: vi.fn(),
}));
vi.mock("./export-manifest.js", () => ({ MANIFEST_SUFFIX: ".manifest.json" }));

const READ: S3Credentials = { accessKeyId: "AK-READ", secretAccessKey: "SK-R" };
const DELETE: S3Credentials = {
  accessKeyId: "AK-DELETE",
  secretAccessKey: "SK-D",
};
const OLD = "vps/golden-path/pg-main/app/2026-11-01T02-00-00Z.sql.age";
const OLDER = "vps/golden-path/pg-main/app/2026-10-31T02-00-00Z.sql.age";
const LISTING = [
  OLD,
  OLDER,
  "vps/golden-path/pg-main/app/2026-11-20T02-00-00Z.sql.age",
];

function repository(): Repository {
  return {
    root: "/repo",
    environment: {
      name: "vps",
      provider: "managed",
      kubeContext: "kore-vps",
      backup: {
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
      },
    },
  } as unknown as Repository;
}

/** Records every call in order, so a test can assert what happened before what. */
function world(
  options: {
    decryptFails?: boolean;
    failOn?: string;
    listFailure?: string;
  } = {},
) {
  const log: string[] = [];
  const run = vi.fn<Runner["run"]>(async (_command, args) => {
    const path = args.at(-1) ?? "";
    log.push(`sops:${path}`);
    if (options.decryptFails === true) {
      throw new Error("no identity matched");
    }
    return { stdout: `{"path":"${path}"}`, stderr: "", code: 0 };
  });
  const admin = vi.fn((credentials: S3Credentials): ObjectAdmin => ({
    list: async (prefix) => {
      log.push(`list:${credentials.accessKeyId}:${prefix}`);
      if (options.listFailure !== undefined) {
        throw new Error(options.listFailure);
      }
      return LISTING;
    },
    remove: async (key) => {
      log.push(`remove:${credentials.accessKeyId}:${key}`);
      if (options.failOn === key) {
        throw new Error(`removing ${key} from backups failed with HTTP 500`);
      }
    },
  }));
  const confirm = vi.fn(async (_question: string) => {
    log.push("confirm");
    return true;
  });
  const deps: PruneOptions = {
    runner: { run } as unknown as Runner,
    admin,
    confirm,
    inCluster: false,
  };
  return { deps, run, admin, confirm, log };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(featureEnabled).mockReturnValue(true);
  vi.mocked(prunableBackups).mockReturnValue([OLDER]);
  vi.mocked(credentialFromDocument).mockImplementation((_text, name) => ({
    namespace: undefined,
    credentials: name.endsWith("-read") ? READ : DELETE,
  }));
});

test("prune refuses while database-backups is off, and reads no credential and touches no target", async () => {
  vi.mocked(featureEnabled).mockReturnValue(false);
  const { deps, run, admin } = world();
  await expect(pruneBackups(repository(), deps)).rejects.toThrow(
    "database-backups is off in vps",
  );
  expect(run).not.toHaveBeenCalled();
  expect(admin).not.toHaveBeenCalled();
});

test("prune refuses inside a job or a pod, before any credential is read", async () => {
  const { deps, run } = world();
  await expect(
    pruneBackups(repository(), { ...deps, inCluster: true }),
  ).rejects.toThrow("backup prune never runs from a job or a pod");
  expect(run).not.toHaveBeenCalled();
});

test("prune refuses when there is no terminal to ask consent on, before any credential is read", async () => {
  const { deps, run } = world();
  await expect(
    pruneBackups(repository(), { ...deps, confirm: undefined }),
  ).rejects.toThrow("backup prune needs a terminal to ask for consent");
  expect(run).not.toHaveBeenCalled();
});

test("the listing uses the controller's read credential and the deletes its delete credential, each from a controller document, never the box's write document", async () => {
  const { deps, run, log } = world();
  await pruneBackups(repository(), deps);
  expect(run.mock.calls.map(([, args]) => args.at(-1))).toEqual([
    "/repo/infra/environments/vps/controller-secrets/backup-write-read.enc.yaml",
    "/repo/infra/environments/vps/controller-secrets/backup-write-delete.enc.yaml",
  ]);
  expect(log.filter((entry) => entry.startsWith("list:"))).toEqual([
    "list:AK-READ:vps/",
  ]);
  expect(log.filter((entry) => entry.startsWith("remove:"))).toEqual([
    `remove:AK-DELETE:${OLDER}.manifest.json`,
    `remove:AK-DELETE:${OLDER}`,
  ]);
});

test("only the backups retention selects are removed, each manifest before its object, and only after consent", async () => {
  const { deps, log, confirm } = world();
  const report = await pruneBackups(repository(), deps);
  expect(prunableBackups).toHaveBeenCalledWith(LISTING);
  expect(confirm).toHaveBeenCalledWith(
    "Delete 1 backup object(s) from backups at https://s3.example.com, keeping the newest 14 per database? Type y to delete: ",
  );
  // The delete credential is decrypted only once consent is given, never before.
  expect(log).toEqual([
    "sops:/repo/infra/environments/vps/controller-secrets/backup-write-read.enc.yaml",
    "list:AK-READ:vps/",
    "confirm",
    "sops:/repo/infra/environments/vps/controller-secrets/backup-write-delete.enc.yaml",
    `remove:AK-DELETE:${OLDER}.manifest.json`,
    `remove:AK-DELETE:${OLDER}`,
  ]);
  expect(report).toEqual({
    status: "pruned",
    bucket: "backups",
    deleted: [OLDER],
  });
});

test("a refused consent deletes nothing and says so", async () => {
  const { deps, confirm, log } = world();
  confirm.mockResolvedValueOnce(false);
  await expect(pruneBackups(repository(), deps)).rejects.toThrow(
    "backup prune was not confirmed; nothing was deleted",
  );
  expect(log.some((entry) => entry.startsWith("remove:"))).toBe(false);
});

test("when retention selects nothing, no consent is asked and nothing is removed", async () => {
  vi.mocked(prunableBackups).mockReturnValue([]);
  const { deps, confirm, admin } = world();
  expect(await pruneBackups(repository(), deps)).toEqual({
    status: "nothing-to-prune",
    bucket: "backups",
    deleted: [],
  });
  expect(confirm).not.toHaveBeenCalled();
  expect(admin).toHaveBeenCalledTimes(1);
});

test("a controller document that cannot be decrypted stops the run before the target is touched", async () => {
  const { deps, admin } = world({ decryptFails: true });
  await expect(pruneBackups(repository(), deps)).rejects.toThrow(
    "could not decrypt /repo/infra/environments/vps/controller-secrets/backup-write-read.enc.yaml: no identity matched",
  );
  expect(admin).not.toHaveBeenCalled();
});

test("a listing that fails stops the run before consent, names the fix and the rerun, and reads no delete credential", async () => {
  const { deps, confirm, run, log } = world({
    listFailure:
      "listing vps/ from backups failed with HTTP 403: AccessDenied; check that the read credential may list backups/vps/ and the endpoint is right",
  });
  const failure = await pruneBackups(repository(), deps).catch(
    (error: unknown) => error,
  );
  expect((failure as Error).message).toBe(
    "listing vps/ from backups failed with HTTP 403: AccessDenied; check that the read credential may list backups/vps/ and the endpoint is right; then rerun kore backup prune --environment vps",
  );
  expect(confirm).not.toHaveBeenCalled();
  expect(run).toHaveBeenCalledTimes(1);
  expect(log.some((entry) => entry.startsWith("remove:"))).toBe(false);
});

test("a removal that fails stops the run, names how far it got, and says a rerun finishes it", async () => {
  vi.mocked(prunableBackups).mockReturnValue([OLDER, OLD]);
  const { deps } = world({ failOn: OLD });
  await expect(pruneBackups(repository(), deps)).rejects.toThrow(
    `removing ${OLD} from backups failed with HTTP 500; 1 of 2 backups were pruned before this; rerun kore backup prune --environment vps to finish`,
  );
});
