import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { beforeEach, expect, test, vi } from "vitest";
import { featureEnabled } from "../config/index.js";
import type { Repository } from "../config/index.js";
import { credentialFromDocument } from "../cluster/index.js";
import { withSecretsRedacted } from "../images/index.js";
import type { Runner, RunResult } from "../runtime/index.js";
import { applyBackupCredential } from "./backup-credentials.js";
import { errno } from "./security-support.js";

vi.mock("node:fs/promises");
vi.mock("../config/index.js", () => ({ featureEnabled: vi.fn() }));
vi.mock("../cluster/index.js", () => ({ credentialFromDocument: vi.fn() }));
vi.mock("../images/index.js", () => ({
  withSecretsRedacted: vi.fn(async (_secrets, operation) => await operation()),
}));

const DOCUMENT = "/repo/infra/environments/vps/secrets/backup-write.enc.yaml";
const ENCRYPTED = Buffer.from("ciphertext-of-the-write-document");
const ACCESS_KEY = "AKIA-WRITE-ONLY";
const SECRET_KEY = "write-only-secret-value";
const CHECKSUM = createHash("sha256").update(ENCRYPTED).digest("hex");

const vps = (): Repository =>
  ({
    root: "/repo",
    environment: {
      name: "vps",
      provider: "managed",
      kubeContext: "kore-vps",
      backup: {
        target: { credentials: { secret: "backup-write" } },
      },
    },
  }) as unknown as Repository;

/** A runner whose sops answers with the decrypted JSON, and whose kubectl succeeds. */
function runner(decrypted: string | Error) {
  const run = vi.fn<Runner["run"]>(async (command): Promise<RunResult> => {
    if (command === "sops") {
      if (decrypted instanceof Error) {
        throw decrypted;
      }
      return { stdout: decrypted, stderr: "", code: 0 };
    }
    return { stdout: "", stderr: "", code: 0 };
  });
  return { runner: { run } as unknown as Runner, run };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(featureEnabled).mockReturnValue(true);
  vi.mocked(readFile).mockResolvedValue(ENCRYPTED);
  vi.mocked(credentialFromDocument).mockReturnValue({
    namespace: "kore-backup",
    credentials: { accessKeyId: ACCESS_KEY, secretAccessKey: SECRET_KEY },
  });
  vi.mocked(withSecretsRedacted).mockImplementation(
    async (_secrets, operation) => await operation(),
  );
});

test("with database-backups off, nothing is read, decrypted or applied", async () => {
  vi.mocked(featureEnabled).mockReturnValue(false);
  const { runner: fake, run } = runner("{}");
  expect(await applyBackupCredential(vps(), fake)).toBeUndefined();
  expect(readFile).not.toHaveBeenCalled();
  expect(run).not.toHaveBeenCalled();
});

test("the write-only credential is decrypted from its sops document and applied in the configured context, with the values on stdin only", async () => {
  const { runner: fake, run } = runner("{}");
  expect(await applyBackupCredential(vps(), fake)).toEqual({
    secret: "backup-write",
    namespace: "kore-backup",
  });
  expect(run.mock.calls[0]).toEqual([
    "sops",
    ["--decrypt", "--output-type", "json", DOCUMENT],
    { capture: true },
  ]);
  const [command, args, options] = run.mock.calls[1]!;
  expect([command, args]).toEqual([
    "kubectl",
    [
      "--context",
      "kore-vps",
      "--namespace",
      "kore-backup",
      "apply",
      "--server-side",
      "--field-manager=kore-backup",
      "--filename=-",
    ],
  ]);
  expect(JSON.parse(options!.input!)).toEqual({
    apiVersion: "v1",
    kind: "Secret",
    metadata: {
      name: "backup-write",
      namespace: "kore-backup",
      annotations: { "platform.kore.dev/document-sha256": CHECKSUM },
    },
    type: "Opaque",
    stringData: {
      AWS_ACCESS_KEY_ID: ACCESS_KEY,
      AWS_SECRET_ACCESS_KEY: SECRET_KEY,
    },
  });
  expect(JSON.stringify(args)).not.toContain(SECRET_KEY);
  expect(JSON.stringify(args)).not.toContain(ACCESS_KEY);
});

test("the plaintext credential is redacted while kubectl runs and is never written to disk", async () => {
  const { runner: fake } = runner("{}");
  await applyBackupCredential(vps(), fake);
  expect(withSecretsRedacted).toHaveBeenCalledWith(
    [ACCESS_KEY, SECRET_KEY],
    expect.any(Function),
  );
  expect(writeFile).not.toHaveBeenCalled();
});

test("a missing document refuses before the cluster is touched, naming the document and the fix", async () => {
  vi.mocked(readFile).mockRejectedValue(errno("ENOENT"));
  const { runner: fake, run } = runner("{}");
  await expect(applyBackupCredential(vps(), fake)).rejects.toThrow(
    new Error(
      `no credential document at ${DOCUMENT}; create it with sops as a Secret named backup-write, with stringData.AWS_ACCESS_KEY_ID and stringData.AWS_SECRET_ACCESS_KEY, then rerun kore secrets backup`,
    ),
  );
  expect(run).not.toHaveBeenCalled();
});

test("a document sops cannot decrypt refuses before the cluster is touched, naming the age identity fix", async () => {
  const { runner: fake, run } = runner(new Error("no identity matched"));
  await expect(applyBackupCredential(vps(), fake)).rejects.toThrow(
    new Error(
      `could not decrypt ${DOCUMENT}: no identity matched; check that SOPS_AGE_KEY_FILE holds this environment's age identity, then rerun kore secrets backup`,
    ),
  );
  expect(run.mock.calls.map(([command]) => command)).toEqual(["sops"]);
});

test("a document that names no namespace is refused, since the Secret has nowhere to live", async () => {
  vi.mocked(credentialFromDocument).mockReturnValue({
    namespace: undefined,
    credentials: { accessKeyId: ACCESS_KEY, secretAccessKey: SECRET_KEY },
  });
  const { runner: fake, run } = runner("{}");
  await expect(applyBackupCredential(vps(), fake)).rejects.toThrow(
    new Error(
      `${DOCUMENT} names no namespace; set metadata.namespace with sops, then rerun kore secrets backup`,
    ),
  );
  expect(run.mock.calls.map(([command]) => command)).toEqual(["sops"]);
});

test("an environment with no backup.target is refused before anything is read, naming the overlay fix", async () => {
  const undeclared = {
    root: "/repo",
    environment: { name: "vps", provider: "managed", kubeContext: "kore-vps" },
  } as unknown as Repository;
  const { runner: fake, run } = runner("{}");
  await expect(applyBackupCredential(undeclared, fake)).rejects.toThrow(
    new Error(
      "no backup.target is declared for vps; declare backup.target in the vps overlay before applying its credential (ADR 0155)",
    ),
  );
  expect(readFile).not.toHaveBeenCalled();
  expect(run).not.toHaveBeenCalled();
});
