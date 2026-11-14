// Docs: docs/decisions/0009-encrypted-secrets-through-external-secrets.md
import { chmod, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { assertExpectedCluster } from "../cluster/index.js";
import { isLocalProvider } from "../config/index.js";
import { environmentStatePath } from "../runtime/index.js";
import { syncLocalSecrets } from "./secrets.js";
import {
  CONTEXT,
  NAMESPACE,
  NOW,
  OTHER_TOKEN,
  ROTATION_ID,
  SECRETS_DIR,
  STATE_DIR,
  TOKEN,
  TOKEN_PATH,
  cluster,
  errno,
  fakeRunner,
  referenceSecret,
  repository,
  sourceApplies,
} from "./secrets-support.js";

vi.mock("node:fs/promises");
vi.mock("node:crypto");
vi.mock("node:path");
vi.mock("../cluster/index.js");
vi.mock("../config/index.js");
vi.mock("../runtime/index.js");

const NAMESPACE_MANIFEST = `apiVersion: v1\nkind: Namespace\nmetadata:\n  name: ${NAMESPACE}\n  labels:\n    platform.kore.dev/secret-source: "true"\n`;

/** kubectl apply into the source namespace, the way a secret is streamed. */
const applyInSource = (input: string) => [
  "kubectl",
  [
    "--context",
    CONTEXT,
    "--namespace",
    NAMESPACE,
    "apply",
    "--server-side",
    "--field-manager=kore-secrets",
    "--filename",
    "-",
  ],
  { capture: true, input },
];

/** kubectl apply with no namespace, as the source namespace itself is applied. */
const applyCluster = (input: string) => [
  "kubectl",
  [
    "--context",
    CONTEXT,
    "apply",
    "--server-side",
    "--field-manager=kore-secrets",
    "--filename",
    "-",
  ],
  { capture: true, input },
];

const decrypt = (file: string) => [
  "sops",
  ["--decrypt", `${SECRETS_DIR}/${file}`],
  { capture: true },
];

const decrypted = (file: string) => `decrypted:${SECRETS_DIR}/${file}`;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(NOW));
  vi.mocked(join).mockImplementation((...parts: string[]) => parts.join("/"));
  vi.mocked(dirname).mockReturnValue(STATE_DIR);
  vi.mocked(randomBytes).mockImplementation(((size: number) =>
    Buffer.alloc(size, size === 32 ? 0xab : 0x01)) as typeof randomBytes);
  vi.mocked(environmentStatePath).mockReturnValue(TOKEN_PATH);
  vi.mocked(isLocalProvider).mockReturnValue(true);
  vi.mocked(assertExpectedCluster).mockResolvedValue(undefined);
  vi.mocked(readdir).mockResolvedValue([]);
  vi.mocked(readFile).mockRejectedValue(errno("ENOENT"));
});

afterEach(() => {
  vi.useRealTimers();
});

test("a sync refuses to rotate without consent before any command runs or the token changes", async () => {
  const { runner, run } = fakeRunner();
  await expect(
    syncLocalSecrets(repository, runner, { rotate: true }),
  ).rejects.toThrow(
    new Error(
      "rotating the reference API token replaces the cluster's token; rerun with --rotate --yes, then run kore local up to restart the consumers",
    ),
  );
  expect(run).not.toHaveBeenCalled();
  expect(writeFile).not.toHaveBeenCalled();
});

test("a sync refuses a managed environment before any command runs", async () => {
  vi.mocked(isLocalProvider).mockReturnValue(false);
  const { runner, run } = fakeRunner();
  await expect(syncLocalSecrets(repository, runner)).rejects.toThrow(
    new Error(
      "local SOPS synchronization is only valid for a local k3d environment",
    ),
  );
  expect(assertExpectedCluster).not.toHaveBeenCalled();
  expect(run).not.toHaveBeenCalled();
});

test("a sync against an unexpected cluster stops before any secret is applied", async () => {
  vi.mocked(assertExpectedCluster).mockRejectedValue(
    new Error("wrong cluster"),
  );
  const { runner, run } = fakeRunner(cluster());
  await expect(syncLocalSecrets(repository, runner)).rejects.toThrow(
    new Error("wrong cluster"),
  );
  expect(run).not.toHaveBeenCalled();
  expect(writeFile).not.toHaveBeenCalled();
});

test("a sync applies the source namespace, the reference token source, each encrypted secret in name order, then re-syncs the ExternalSecret", async () => {
  vi.mocked(readdir).mockResolvedValue([
    "b.enc.yaml",
    "notes.txt",
    "a.enc.yaml",
  ] as never);
  const { runner, run } = fakeRunner(cluster({ externalSecret: true }));
  await syncLocalSecrets(repository, runner);
  expect(run.mock.calls).toEqual([
    applyCluster(NAMESPACE_MANIFEST),
    [
      "kubectl",
      [
        "--context",
        CONTEXT,
        "--namespace",
        NAMESPACE,
        "get",
        "secret",
        "reference-app",
        "--ignore-not-found",
        "--output",
        "name",
      ],
      { capture: true },
    ],
    applyInSource(`${JSON.stringify(referenceSecret(TOKEN, ROTATION_ID))}\n`),
    decrypt("a.enc.yaml"),
    applyInSource(decrypted("a.enc.yaml")),
    decrypt("b.enc.yaml"),
    applyInSource(decrypted("b.enc.yaml")),
    [
      "kubectl",
      [
        "--context",
        CONTEXT,
        "--namespace",
        "reference",
        "get",
        "externalsecret",
        "reference-app",
        "--ignore-not-found",
        "-o",
        "name",
      ],
      { capture: true },
    ],
    [
      "kubectl",
      [
        "--context",
        CONTEXT,
        "--namespace",
        "reference",
        "annotate",
        "externalsecret",
        "reference-app",
        `force-sync=${Date.parse(NOW)}`,
        "--overwrite",
      ],
      { capture: true },
    ],
  ]);
});

test("a sync reports how many encrypted secret files it applied", async () => {
  vi.mocked(readdir).mockResolvedValue(["a.enc.yaml", "b.enc.yaml"] as never);
  const { runner } = fakeRunner(cluster());
  expect(await syncLocalSecrets(repository, runner)).toBe(2);
});

test("decrypted secrets reach the cluster only through kubectl stdin, so the only file written is the token", async () => {
  vi.mocked(readdir).mockResolvedValue(["a.enc.yaml"] as never);
  const { runner } = fakeRunner(cluster());
  await syncLocalSecrets(repository, runner);
  expect(writeFile).toHaveBeenCalledTimes(1);
  expect(writeFile).toHaveBeenCalledWith(TOKEN_PATH, `${TOKEN}\n`, {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
  });
});

test("a checkout never rewrites a token source that already exists in the cluster, whatever its local token holds", async () => {
  vi.mocked(readFile).mockResolvedValue(`${OTHER_TOKEN}\n`);
  const { runner, run } = fakeRunner(cluster({ sourceExists: true }));
  await syncLocalSecrets(repository, runner);
  expect(sourceApplies(run)).toEqual([]);
  expect(writeFile).not.toHaveBeenCalled();
});

test("creating the source writes a new private token and records a rotation id that is not the token", async () => {
  const { runner, run } = fakeRunner(cluster());
  await syncLocalSecrets(repository, runner);
  expect(mkdir).toHaveBeenCalledWith(STATE_DIR, {
    recursive: true,
    mode: 0o700,
  });
  expect(writeFile).toHaveBeenCalledWith(TOKEN_PATH, `${TOKEN}\n`, {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
  });
  expect(chmod).toHaveBeenCalledWith(TOKEN_PATH, 0o600);
  expect(sourceApplies(run)).toEqual([referenceSecret(TOKEN, ROTATION_ID)]);
});

test("a sync without rotation reuses the persisted local token and never generates a new one", async () => {
  vi.mocked(readFile).mockResolvedValue(`${TOKEN}\n`);
  const { runner, run } = fakeRunner(cluster());
  await syncLocalSecrets(repository, runner);
  expect(writeFile).not.toHaveBeenCalled();
  expect(randomBytes).not.toHaveBeenCalledWith(32);
  expect(sourceApplies(run)).toEqual([referenceSecret(TOKEN, ROTATION_ID)]);
});

test("a corrupted persisted token is refused with the file to remove, and no secret is applied", async () => {
  vi.mocked(readFile).mockResolvedValue("not-secret\n");
  const { runner, run } = fakeRunner(cluster());
  await expect(syncLocalSecrets(repository, runner)).rejects.toThrow(
    new Error(
      `local API token at ${TOKEN_PATH} is invalid; remove it to generate a new token`,
    ),
  );
  expect(sourceApplies(run)).toEqual([]);
  expect(writeFile).not.toHaveBeenCalled();
});

test("rotation with consent replaces the cluster token source with a new token and rotation id, without reading the old token", async () => {
  const { runner, run } = fakeRunner(cluster({ sourceExists: true }));
  await syncLocalSecrets(repository, runner, { rotate: true, yes: true });
  expect(readFile).not.toHaveBeenCalled();
  expect(writeFile).toHaveBeenCalledWith(TOKEN_PATH, `${TOKEN}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  expect(chmod).toHaveBeenCalledWith(TOKEN_PATH, 0o600);
  expect(sourceApplies(run)).toEqual([referenceSecret(TOKEN, ROTATION_ID)]);
});

test("an existing ExternalSecret is re-synced at once with a fresh force-sync annotation", async () => {
  const { runner, run } = fakeRunner(cluster({ externalSecret: true }));
  await syncLocalSecrets(repository, runner);
  expect(run).toHaveBeenCalledWith(
    "kubectl",
    [
      "--context",
      CONTEXT,
      "--namespace",
      "reference",
      "annotate",
      "externalsecret",
      "reference-app",
      `force-sync=${Date.parse(NOW)}`,
      "--overwrite",
    ],
    { capture: true },
  );
});

test("a sync does not annotate when no reference ExternalSecret exists", async () => {
  const { runner, run } = fakeRunner(cluster({ externalSecret: false }));
  await syncLocalSecrets(repository, runner);
  expect(run.mock.calls.some(([, args]) => args.includes("annotate"))).toBe(
    false,
  );
});
