// Docs: infra/plans/14-test-tiers.md#step-2-pilots
import { access, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, expect, test, vi } from "vitest";
import { assertExpectedCluster } from "../cluster/index.js";
import { isLocalProvider } from "../config/index.js";
import { CommandError } from "../runtime/index.js";
import { errno, fakeRepository, fakeRunner } from "./security-support.js";
import {
  installLocalTrust,
  issuerManifest,
  removeLocalTrustArtifacts,
} from "./trust.js";

vi.mock("node:fs/promises");
vi.mock("node:os");
vi.mock("node:path");
vi.mock("../cluster/index.js");
vi.mock("../config/index.js");

const caRoot = "/ca/root";
const certificate = "/ca/root/rootCA.pem";
const key = "/ca/root/rootCA-key.pem";
const applyArgs = [
  "--context",
  "k3d-kore-local",
  "apply",
  "--server-side",
  "--field-manager=kore-trust",
  "--filename",
  "-",
];
const gatewayNamespace =
  "apiVersion: v1\nkind: Namespace\nmetadata:\n  name: kore-system\n  labels:\n    app.kubernetes.io/managed-by: Helm\n  annotations:\n    meta.helm.sh/release-name: kore-platform-config\n    meta.helm.sh/release-namespace: kore-system\n";
const certManagerNamespace =
  "apiVersion: v1\nkind: Namespace\nmetadata:\n  name: cert-manager\n";

const repository = fakeRepository();

/** mkcert reports the CA root; kubectl prints the CA secret it builds. */
function trustReply(command: string, args: readonly string[]): string {
  if (command === "mkcert" && args[0] === "-CAROOT") {
    return `${caRoot}\n`;
  }
  return args.includes("create") ? "SECRET-YAML" : "";
}

/** Only the listed CA files exist; every other path is missing. */
function caFiles(...present: string[]): void {
  vi.mocked(access).mockImplementation(async (path) => {
    if (!present.includes(String(path))) {
      throw errno("ENOENT");
    }
  });
}

beforeEach(() => {
  vi.mocked(join).mockImplementation((...parts: string[]) => parts.join("/"));
  vi.mocked(tmpdir).mockReturnValue("/tmp");
  vi.mocked(isLocalProvider).mockReturnValue(true);
  vi.mocked(assertExpectedCluster).mockResolvedValue();
  caFiles();
});

test("the CA issuer manifest names the CA secret and embeds no private key material", () => {
  expect(issuerManifest("kore-local-ca", "kore-local-ca-key-pair")).toBe(
    "apiVersion: cert-manager.io/v1\nkind: ClusterIssuer\nmetadata:\n  name: kore-local-ca\nspec:\n  ca:\n    secretName: kore-local-ca-key-pair\n",
  );
});

test("local trust hands the gateway namespace to Helm ownership and creates cert-manager unowned", async () => {
  const { runner, run } = fakeRunner(trustReply);
  await installLocalTrust(repository, runner, { platform: "linux" });
  expect(run.mock.calls.slice(0, 2)).toEqual([
    ["kubectl", applyArgs, { capture: true, input: gatewayNamespace }],
    ["kubectl", applyArgs, { capture: true, input: certManagerNamespace }],
  ]);
});

test("local trust applies its manifests in order: namespaces, CA secret, issuer, then waits for the issuer to be ready", async () => {
  caFiles(certificate, key);
  const { runner, run } = fakeRunner(trustReply);
  await installLocalTrust(repository, runner, { platform: "darwin" });
  expect(assertExpectedCluster).toHaveBeenCalledWith(repository, runner);
  expect(run.mock.calls).toEqual([
    ["kubectl", applyArgs, { capture: true, input: gatewayNamespace }],
    ["kubectl", applyArgs, { capture: true, input: certManagerNamespace }],
    ["mkcert", ["-CAROOT"], { capture: true }],
    ["security", ["verify-cert", "-c", certificate], { capture: true }],
    [
      "kubectl",
      [
        "--context",
        "k3d-kore-local",
        "--namespace",
        "cert-manager",
        "create",
        "secret",
        "tls",
        "kore-local-ca-key-pair",
        "--cert",
        certificate,
        "--key",
        key,
        "--dry-run=client",
        "--output",
        "yaml",
      ],
      { capture: true },
    ],
    ["kubectl", applyArgs, { capture: true, input: "SECRET-YAML" }],
    [
      "kubectl",
      applyArgs,
      {
        capture: true,
        input: issuerManifest("kore-local-ca", "kore-local-ca-key-pair"),
      },
    ],
    [
      "kubectl",
      [
        "--context",
        "k3d-kore-local",
        "wait",
        "--for=condition=Ready",
        "clusterissuer/kore-local-ca",
        "--timeout=2m",
      ],
      { capture: false },
    ],
  ]);
});

test("mkcert -install is skipped when the CA files exist and macOS already trusts the root", async () => {
  caFiles(certificate, key);
  const { runner, run } = fakeRunner(trustReply);
  await installLocalTrust(repository, runner, { platform: "darwin" });
  expect(
    run.mock.calls.map(([command, args]) => [command, args[0]]),
  ).not.toContainEqual(["mkcert", "-install"]);
});

test("mkcert -install still runs when the macOS trust check reports the root untrusted", async () => {
  caFiles(certificate, key);
  const { runner, run } = fakeRunner(trustReply);
  run.mockImplementation(async (command, args) => {
    if (command === "security") {
      throw new CommandError(command, args, {
        stdout: "",
        stderr: "not trusted",
        code: 1,
      });
    }
    return { stdout: trustReply(command, args), stderr: "", code: 0 };
  });
  await installLocalTrust(repository, runner, { platform: "darwin" });
  expect(run).toHaveBeenCalledWith("mkcert", ["-install"], { capture: false });
});

test("mkcert -install still runs without asking macOS when the CA key is missing", async () => {
  caFiles(certificate);
  const { runner, run } = fakeRunner(trustReply);
  await installLocalTrust(repository, runner, { platform: "darwin" });
  expect(run).toHaveBeenCalledWith("mkcert", ["-install"], { capture: false });
  expect(run.mock.calls.map(([command]) => command)).not.toContain("security");
});

test("mkcert -install always runs, and the macOS check never runs, on a host without that check", async () => {
  caFiles(certificate, key);
  const { runner, run } = fakeRunner(trustReply);
  await installLocalTrust(repository, runner, { platform: "linux" });
  expect(run).toHaveBeenCalledWith("mkcert", ["-install"], { capture: false });
  expect(run.mock.calls.map(([command]) => command)).not.toContain("security");
  expect(access).not.toHaveBeenCalled();
});

test("a missing security binary is rethrown rather than treated as an untrusted root", async () => {
  caFiles(certificate, key);
  const spawnError = errno("ENOENT");
  const { runner, run } = fakeRunner(trustReply);
  run.mockImplementation(async (command, args) => {
    if (command === "security") {
      throw spawnError;
    }
    return { stdout: trustReply(command, args), stderr: "", code: 0 };
  });
  await expect(
    installLocalTrust(repository, runner, { platform: "darwin" }),
  ).rejects.toBe(spawnError);
  expect(
    run.mock.calls.map(([command, args]) => [command, args[0]]),
  ).not.toContainEqual(["mkcert", "-install"]);
});

test("an unreadable CA certificate is rethrown rather than treated as an untrusted root", async () => {
  const denied = errno("EACCES");
  vi.mocked(access).mockImplementation(async (path) => {
    if (String(path) === certificate) {
      throw denied;
    }
  });
  const { runner, run } = fakeRunner(trustReply);
  await expect(
    installLocalTrust(repository, runner, { platform: "darwin" }),
  ).rejects.toBe(denied);
  expect(
    run.mock.calls.map(([command, args]) => [command, args[0]]),
  ).not.toContainEqual(["mkcert", "-install"]);
});

test("local trust fails closed when mkcert reports no CA root, before building any CA secret", async () => {
  const { runner, run } = fakeRunner((command, args) =>
    command === "mkcert" ? "  \n" : trustReply(command, args),
  );
  await expect(
    installLocalTrust(repository, runner, { platform: "linux" }),
  ).rejects.toThrow(new Error("mkcert did not return its CA root"));
  expect(run.mock.calls.some(([, args]) => args.includes("create"))).toBe(
    false,
  );
});

test("local trust refuses a managed environment before any command runs", async () => {
  vi.mocked(isLocalProvider).mockReturnValue(false);
  const { runner, run } = fakeRunner(trustReply);
  await expect(
    installLocalTrust(repository, runner, { platform: "linux" }),
  ).rejects.toThrow(
    new Error("local CA trust is only valid for a local k3d environment"),
  );
  expect(assertExpectedCluster).not.toHaveBeenCalled();
  expect(run).not.toHaveBeenCalled();
});

test("removing trust artifacts deletes only the temporary CA directory of the selected environment", async () => {
  await removeLocalTrustArtifacts(fakeRepository());
  expect(rm).toHaveBeenCalledWith("/tmp/kore-ca-local", {
    recursive: true,
    force: true,
  });
  expect(rm).toHaveBeenCalledTimes(1);
});
