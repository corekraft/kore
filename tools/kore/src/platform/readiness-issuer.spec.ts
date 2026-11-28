// Docs: infra/plans/14-test-tiers.md#step-2-pilots
import { beforeEach, expect, test, vi } from "vitest";
import { isLocalProvider, type Repository } from "../config/index.js";
import type { Runner } from "../runtime/index.js";
import {
  assertIssuerReady,
  namedForeignFailure,
  trustRemedy,
} from "./readiness-issuer.js";
import { foreignCertificateFailure } from "./foreign-certificate.js";

vi.mock("../config/index.js");
vi.mock("./foreign-certificate.js", () => ({
  foreignCertificatePrefix: "certificate/foreign-",
  foreignCertificateFailure: vi.fn(),
  foreignCertificateResources: vi.fn(),
}));

type Run = Runner["run"];

const BASE = ["--context", "k3d-kore-local", "--namespace", "kore-system"];
const CONTEXT = ["--context", "k3d-kore-local"];
const RESOURCE = "certificate/gateway-tls";
const REF = "--output";

const repository = {
  environment: { name: "local", kubeContext: "k3d-kore-local" },
} as unknown as Repository;

/**
 * A typed runner that answers each kubectl call by its arguments: `replies`
 * maps the joined arguments to stdout, and a value that is an Error is thrown.
 */
function fakeRunner(replies: Record<string, string | Error>) {
  const run = vi.fn<Run>(async (_command, args) => {
    const reply = replies[args.join(" ")];
    if (reply === undefined) {
      throw new Error(`unexpected kubectl call: ${args.join(" ")}`);
    }
    if (reply instanceof Error) {
      throw reply;
    }
    return { stdout: reply, stderr: "", code: 0 };
  });
  return { runner: { run } as Runner, run };
}

const readRef = [
  ...BASE,
  "get",
  RESOURCE,
  REF,
  "jsonpath={.spec.issuerRef.kind}/{.spec.issuerRef.name}",
].join(" ");
const readIssuer = [
  ...CONTEXT,
  "get",
  "clusterissuer/kore-local-ca",
  REF,
  "jsonpath={.spec.ca.secretName}",
].join(" ");
const readSecret = [
  ...CONTEXT,
  "--namespace",
  "cert-manager",
  "get",
  "secret/kore-local-ca-key-pair",
  REF,
  "name",
].join(" ");

beforeEach(() => {
  vi.mocked(isLocalProvider).mockReturnValue(true);
});

test("the local remedy names the trust install command for the environment", () => {
  expect(trustRemedy(repository)).toBe(
    "Run: kore trust install --environment local",
  );
});

test("a remote environment's remedy asks for the issuer and CA Secret to be created", () => {
  vi.mocked(isLocalProvider).mockReturnValue(false);

  expect(trustRemedy(repository)).toBe(
    "Create the ClusterIssuer and its CA Secret for this environment",
  );
});

test("a Certificate whose issuer is not a ClusterIssuer is not checked further", async () => {
  const { runner, run } = fakeRunner({
    [readRef]: "Issuer/team-ca",
  });

  await expect(
    assertIssuerReady(repository, runner, BASE, RESOURCE),
  ).resolves.toBeUndefined();

  expect(run).toHaveBeenCalledTimes(1);
});

test("a Certificate with no issuer reference at all is not checked further", async () => {
  const { runner, run } = fakeRunner({ [readRef]: "" });

  await expect(
    assertIssuerReady(repository, runner, BASE, RESOURCE),
  ).resolves.toBeUndefined();

  expect(run).toHaveBeenCalledTimes(1);
});

test("a missing ClusterIssuer fails naming it and the trust install that creates it", async () => {
  const { runner } = fakeRunner({
    [readRef]: "ClusterIssuer/kore-local-ca",
    [readIssuer]: new Error(
      'clusterissuers.cert-manager.io "kore-local-ca" not found',
    ),
  });

  await expect(
    assertIssuerReady(repository, runner, BASE, RESOURCE),
  ).rejects.toThrow(
    "ClusterIssuer kore-local-ca is missing, so certificate/gateway-tls cannot be issued. Run: kore trust install --environment local",
  );
});

test("a ClusterIssuer with no CA Secret name is not checked for a Secret", async () => {
  const { runner, run } = fakeRunner({
    [readRef]: "ClusterIssuer/kore-local-ca",
    [readIssuer]: "",
  });

  await expect(
    assertIssuerReady(repository, runner, BASE, RESOURCE),
  ).resolves.toBeUndefined();

  expect(run).toHaveBeenCalledTimes(2);
});

test("a ClusterIssuer whose CA Secret is missing fails naming the Secret in cert-manager", async () => {
  const { runner } = fakeRunner({
    [readRef]: "ClusterIssuer/kore-local-ca",
    [readIssuer]: "kore-local-ca-key-pair",
    [readSecret]: new Error('secrets "kore-local-ca-key-pair" not found'),
  });

  await expect(
    assertIssuerReady(repository, runner, BASE, RESOURCE),
  ).rejects.toThrow(
    "CA Secret cert-manager/kore-local-ca-key-pair for ClusterIssuer kore-local-ca is missing. Run: kore trust install --environment local",
  );
});

test("a ClusterIssuer whose CA Secret exists passes", async () => {
  const { runner, run } = fakeRunner({
    [readRef]: "ClusterIssuer/kore-local-ca",
    [readIssuer]: "kore-local-ca-key-pair",
    [readSecret]: "secret/kore-local-ca-key-pair",
  });

  await expect(
    assertIssuerReady(repository, runner, BASE, RESOURCE),
  ).resolves.toBeUndefined();

  expect(run).toHaveBeenCalledTimes(3);
});

test("a read that fails for a reason other than NotFound is rethrown, not reported as a missing issuer", async () => {
  const { runner } = fakeRunner({
    [readRef]: "ClusterIssuer/kore-local-ca",
    [readIssuer]: new Error("error: the server is unreachable"),
  });

  await expect(
    assertIssuerReady(repository, runner, BASE, RESOURCE),
  ).rejects.toThrow("the server is unreachable");
});

const FOREIGN = "certificate/foreign-pay-example-net-fe743658";
const NAMED = "foreign name pay.example.net is not proven: the cause";

test("a timed-out wait on a foreign name's Certificate is replaced by the named cause and its fix", async () => {
  vi.mocked(foreignCertificateFailure).mockResolvedValue(NAMED);
  const { runner } = fakeRunner({});
  const names = ["pay.example.net"];
  const timeout = new Error(
    `error: timed out waiting for the condition on certificates/${FOREIGN.slice("certificate/".length)}`,
  );

  await expect(
    namedForeignFailure(
      {
        repository: { foreignNames: names } as unknown as Repository,
        runner,
        base: BASE,
      },
      FOREIGN,
      timeout,
    ),
  ).rejects.toThrow(NAMED);
  expect(vi.mocked(foreignCertificateFailure).mock.calls).toEqual([
    [runner, BASE, FOREIGN, names],
  ]);
});

test("a timed-out wait on a platform Certificate returns, so the caller rethrows it, and is never named as a foreign name", async () => {
  const timeout = new Error("error: timed out waiting for the condition");
  await expect(
    namedForeignFailure(
      { repository, runner: fakeRunner({}).runner, base: BASE },
      RESOURCE,
      timeout,
    ),
  ).resolves.toBeUndefined();
  expect(vi.mocked(foreignCertificateFailure)).not.toHaveBeenCalled();
});

test("a foreign name's wait that fails for a reason other than a timeout, such as an unreachable cluster, returns so the caller rethrows it", async () => {
  const unreachable = new Error("error: the server is unreachable");
  await expect(
    namedForeignFailure(
      {
        repository: {
          foreignNames: ["pay.example.net"],
        } as unknown as Repository,
        runner: fakeRunner({}).runner,
        base: BASE,
      },
      FOREIGN,
      unreachable,
    ),
  ).resolves.toBeUndefined();
  expect(vi.mocked(foreignCertificateFailure)).not.toHaveBeenCalled();
});
