import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { beforeEach, expect, test, vi } from "vitest";
import { trustedSigners } from "../config/index.js";
import { environmentStatePath, type Runner } from "../runtime/index.js";
import { fakeRepository, typedRunner } from "./images.fixtures.js";
import {
  ensureLocalSigningPublicKey,
  swapLocalSigningKey,
  withLocalSigner,
} from "./local-signer.js";

vi.mock("node:fs/promises");
vi.mock("node:os");
vi.mock("node:path");
vi.mock("../config/index.js");
vi.mock("../runtime/index.js");

const kubeconfig = "KUBECONFIG";
const publicKey = Buffer.from("PUBLIC KEY").toString("base64");
const scratch = "/scratch";

/**
 * A stateful-enough cluster: the kubeconfig view, whether the private key
 * Secret exists, and the public key the cluster holds. Everything else is a
 * silent success.
 */
function cluster(options: { secretExists?: boolean } = {}) {
  return typedRunner((_command, args) => {
    if (args.includes("config")) {
      return kubeconfig;
    }
    if (args.includes("--output=name")) {
      return options.secretExists === false
        ? ""
        : "secret/kore-local-signing-key\n";
    }
    if (args.some((arg) => arg.startsWith("--output=jsonpath"))) {
      return publicKey;
    }
    return "";
  });
}

/** A label per runner call, so a test reads the order the commands ran in. */
function labels(calls: Parameters<Runner["run"]>[]): string[] {
  return calls.map(([command, args]) => {
    if (command === "cosign") {
      return "generate";
    }
    if (args.includes("apply")) {
      return "apply";
    }
    if (args.includes("delete")) {
      return "delete";
    }
    if (args.includes("config")) {
      return "config";
    }
    if (args.includes("--output=name")) {
      return "check";
    }
    return "read-public";
  });
}

beforeEach(() => {
  vi.mocked(join).mockImplementation((...parts: string[]) => parts.join("/"));
  vi.mocked(dirname).mockReturnValue("/state/local");
  vi.mocked(environmentStatePath).mockReturnValue(
    "/state/local/local-signing.pub",
  );
  vi.mocked(tmpdir).mockReturnValue("/tmp");
  vi.mocked(mkdtemp).mockResolvedValue(scratch);
  vi.mocked(access).mockRejectedValue(new Error("ENOENT"));
  vi.mocked(trustedSigners).mockReturnValue(["local-kore-key"]);
});

test("the public key is published as a single-entry Secret in the policy-controller namespace, through stdin", async () => {
  const { runner, run } = cluster();

  await ensureLocalSigningPublicKey(fakeRepository(), runner);

  const apply = run.mock.calls.find(([, args]) => args.includes("apply"));
  expect(apply?.[0]).toBe("kubectl");
  expect(apply?.[1]).toEqual([
    "--context",
    "k3d-kore-local",
    "apply",
    "--server-side",
    "--field-manager=kore-signing",
    "--force-conflicts",
    "--filename=-",
  ]);
  const secret = JSON.parse(apply?.[2]?.input ?? "{}");
  expect(secret.metadata.namespace).toBe("cosign-system");
  expect(secret.metadata.name).toBe("kore-local-signing-pub");
  expect(secret.metadata.labels["app.kubernetes.io/managed-by"]).toBe(
    "kore-signing",
  );
  expect(Object.keys(secret.data)).toEqual(["cosign.pub"]);
  expect(secret.data["cosign.pub"]).toBe(publicKey);
});

test("no private key material is read, streamed or written when publishing the public key", async () => {
  const { runner, run } = cluster();

  await ensureLocalSigningPublicKey(fakeRepository(), runner);

  for (const [, args, options] of run.mock.calls) {
    const text = [...args, options?.input ?? ""].join(" ");
    expect(text).not.toMatch(/cosign\.key|cosign\.password|-o yaml/);
    expect(args).not.toContain("--output=json");
  }
});

test("the key pair is generated only when the cluster holds no private key, and before the public Secret is applied", async () => {
  const { runner, run } = cluster({ secretExists: false });

  await ensureLocalSigningPublicKey(fakeRepository(), runner);

  expect(labels(run.mock.calls)).toEqual([
    "config",
    "check",
    "generate",
    "read-public",
    "apply",
  ]);
  expect(run).toHaveBeenCalledWith(
    "cosign",
    ["generate-key-pair", "k8s://kore-system/kore-local-signing-key"],
    expect.objectContaining({
      capture: false,
      kubeconfig,
      cwd: scratch,
      env: expect.objectContaining({ COSIGN_PASSWORD: "" }),
    }),
  );
});

test("an existing private key is reused, so cosign generates nothing", async () => {
  const { runner, run } = cluster({ secretExists: true });

  await ensureLocalSigningPublicKey(fakeRepository(), runner);

  expect(labels(run.mock.calls)).not.toContain("generate");
});

test("the temporary cosign directory is removed even when publishing the Secret fails", async () => {
  const { runner, run } = cluster();
  run.mockImplementation(async (_command, args) => {
    if (args.includes("apply")) {
      throw new Error("apply refused");
    }
    return { stdout: "", stderr: "", code: 0 };
  });

  await expect(
    ensureLocalSigningPublicKey(fakeRepository(), runner),
  ).rejects.toThrow("apply refused");

  expect(rm).toHaveBeenCalledWith(scratch, { force: true, recursive: true });
});

test("the signer publishes the public key under the environment's state directory and hands out its key reference, kubeconfig and environment", async () => {
  const { runner } = cluster();
  const action = vi.fn(async () => "signed");

  const result = await withLocalSigner(fakeRepository(), runner, action);

  expect(result).toBe("signed");
  expect(environmentStatePath).toHaveBeenCalledWith(
    "/repo",
    "local",
    "local-signing.pub",
  );
  expect(mkdir).toHaveBeenCalledWith("/state/local", { recursive: true });
  expect(writeFile).toHaveBeenCalledWith(
    "/state/local/local-signing.pub",
    "PUBLIC KEY",
  );
  expect(action).toHaveBeenCalledWith({
    key: "k8s://kore-system/kore-local-signing-key",
    publicKey: "/state/local/local-signing.pub",
    env: expect.objectContaining({ COSIGN_PASSWORD: "" }),
    kubeconfig,
  });
});

test("a legacy local signing key left on disk is named on stderr and never used", async () => {
  vi.mocked(access).mockResolvedValue(undefined);
  const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
  const { runner } = cluster();

  await ensureLocalSigningPublicKey(fakeRepository(), runner);

  expect(stderr).toHaveBeenCalledWith(
    expect.stringContaining(
      "legacy local signing key under /repo/.kore/keys/local is no longer used and can be deleted",
    ),
  );
});

test("a key swap without --yes refuses and touches the cluster in no way", async () => {
  const { runner, run } = cluster();

  await expect(
    swapLocalSigningKey(fakeRepository(), runner, { yes: false }),
  ).rejects.toThrow(/swapping the local signing key .* requires --yes/);

  expect(run).not.toHaveBeenCalled();
});

test("a managed environment refuses a key swap, because it never trusts the local key", async () => {
  vi.mocked(trustedSigners).mockReturnValue(["release@kore.dev"]);
  const { runner, run } = cluster();

  await expect(
    swapLocalSigningKey(fakeRepository({ name: "managed-example" }), runner, {
      yes: true,
    }),
  ).rejects.toThrow(
    /environment managed-example does not trust the local signing key/,
  );

  expect(run).not.toHaveBeenCalled();
});

test("a key swap deletes the old private key first, generates a new pair, and applies the public Secret last", async () => {
  const { runner, run } = cluster({ secretExists: false });

  await swapLocalSigningKey(fakeRepository(), runner, { yes: true });

  expect(labels(run.mock.calls)).toEqual([
    "delete",
    "config",
    "check",
    "generate",
    "read-public",
    "apply",
  ]);
  expect(run.mock.calls[0]?.[1]).toEqual([
    "--context",
    "k3d-kore-local",
    "--namespace",
    "kore-system",
    "delete",
    "secret",
    "kore-local-signing-key",
    "--ignore-not-found",
  ]);
});
